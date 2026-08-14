import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const stagedPath = path.join(root, 'sql', 'staged_service_delivery_workflow_hardening.sql');
const serviceBoardPath = path.join(root, 'components', 'features', 'EnterpriseServiceJobBoard.tsx');
const deliveryBoardPath = path.join(root, 'components', 'features', 'EnterpriseDeliveryBoard.tsx');

function fail(message) {
  console.error(`Service/delivery workflow contract check failed: ${message}`);
  process.exitCode = 1;
}

function requireText(name, source, values) {
  for (const value of values) {
    if (!source.includes(value)) fail(`${name} is missing contract: ${value}`);
  }
}

if (!fs.existsSync(stagedPath)) {
  fail('staged SQL contract is missing.');
  process.exit(1);
}

const sql = fs.readFileSync(stagedPath, 'utf8');
const serviceBoard = fs.readFileSync(serviceBoardPath, 'utf8');
const deliveryBoard = fs.readFileSync(deliveryBoardPath, 'utf8');

requireText('staged SQL', sql, [
  'STAGED CONTRACT FOR ISSUE #139 — NOT A PRODUCTION MIGRATION',
  'create or replace function public.assign_service_job(job_id uuid, assignee_id uuid)',
  'create or replace function public.transition_service_job(job_id uuid, new_status text)',
  'create or replace function public.close_service_job(job_id uuid, remarks text default null)',
  'create or replace function public.transition_delivery_order(order_id uuid, new_status text)',
  "security definer\nset search_path = ''",
  "v_actor_role not in ('admin', 'operations')",
  "v_actor_branch <> 'national'",
  'v_job_branch <> v_actor_branch',
  'u.is_active = true',
  "d.role in ('technician', 'road_technician')",
  "v_assignee_branch not in (v_job_branch, 'national')",
  "v_old_status not in ('new', 'assigned', 'in_progress')",
  'if assignee_id is null then',
  "v_old_status = 'in_progress'",
  "when assignee_id is null then 'new'",
  "(v_old_status = 'new' and new_status in ('assigned', 'cancelled'))",
  "(v_old_status = 'assigned' and new_status in ('in_progress', 'cancelled'))",
  "(v_old_status = 'in_progress' and new_status in ('completed', 'cancelled'))",
  "(v_old_status = 'completed' and new_status = 'verified')",
  "new_status in ('assigned', 'in_progress', 'completed')",
  'Assign a technician before moving this service job to %',
  "v_old_status <> 'verified'",
  "(v_old_status = 'draft' and new_status in ('picked', 'cancelled'))",
  "(v_old_status = 'picked' and new_status in ('dispatched', 'cancelled'))",
  "(v_old_status = 'dispatched' and new_status in ('delivered', 'cancelled'))",
  "(v_old_status = 'delivered' and new_status = 'closed')",
  "v_actor_role = 'warehouse_staff'",
  "v_valid_transition := v_old_status = 'draft' and new_status = 'picked'",
  "v_actor_role = 'road_technician'",
  'before_payload',
  'after_payload',
  'revoke all on function public.assign_service_job(uuid, uuid) from PUBLIC;',
  'revoke execute on function public.assign_service_job(uuid, uuid) from anon;',
  'grant execute on function public.assign_service_job(uuid, uuid) to authenticated, service_role;',
]);

for (const functionName of [
  'assign_service_job',
  'transition_service_job',
  'close_service_job',
  'transition_delivery_order',
]) {
  const definition = new RegExp(`create or replace function public\\.${functionName}\\b[\\s\\S]*?\\$function\\$;`, 'i').exec(sql)?.[0] ?? '';
  if (!definition.includes("set search_path = ''")) {
    fail(`${functionName} must use an empty hardened search_path.`);
  }
  if (!definition.includes('security definer')) {
    fail(`${functionName} must retain SECURITY DEFINER with internal authorization checks.`);
  }
}

for (const forbidden of [
  /\balter\s+table\b/i,
  /\bcreate\s+table\b/i,
  /\bdrop\s+table\b/i,
  /\bcreate\s+policy\b/i,
  /\bdrop\s+policy\b/i,
  /\bcreate\s+extension\b/i,
]) {
  if (forbidden.test(sql)) {
    fail(`staged SQL must remain function-only and contains forbidden DDL: ${forbidden}`);
  }
}

requireText('service board', serviceBoard, [
  "new: ['new', 'assigned', 'cancelled']",
  "assigned: ['assigned', 'in_progress', 'cancelled']",
  "in_progress: ['in_progress', 'completed', 'cancelled']",
  "completed: ['completed', 'verified']",
  "verified: ['verified', 'closed']",
  "rpc('close_service_job'",
  "rpc('transition_service_job'",
  "rpc('assign_service_job'",
]);

requireText('delivery board', deliveryBoard, [
  "draft: ['draft', 'picked', 'cancelled']",
  "picked: ['picked', 'dispatched', 'cancelled']",
  "dispatched: ['dispatched', 'delivered', 'cancelled']",
  "delivered: ['delivered', 'closed']",
  "rpc('transition_delivery_order'",
]);

if (process.exitCode) process.exit(process.exitCode);
console.log('Service/delivery workflow contract check passed: staged RPCs enforce branch scope, active/compatible technicians, terminal protection, safe unassignment, explicit transition matrices, audit payloads and restricted execution.');
