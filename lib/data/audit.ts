import type { SupabaseClient } from '@supabase/supabase-js';
import type { Branch, BusinessRole } from '@/types/dallmayrerp';

export type AuditEntityType =
  | 'user'
  | 'stock'
  | 'inventory'
  | 'delivery_order'
  | 'service_job'
  | 'task_closure'
  | 'document'
  | 'machine'
  | 'route'
  | 'campaign'
  | 'system';

export type AuditEventInput = {
  actorUserId: string | null | undefined;
  actorRole: BusinessRole | string | null | undefined;
  branch: Branch | string | null | undefined;
  entityType: AuditEntityType;
  entityId?: string | null;
  action: string;
  summary: string;
  beforePayload?: Record<string, unknown> | null;
  afterPayload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordAuditEvent(client: SupabaseClient, input: AuditEventInput) {
  if (!input.actorUserId) return;

  const { error } = await client.from('audit_events').insert({
    actor_user_id: input.actorUserId,
    actor_role: input.actorRole ?? null,
    branch: input.branch ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    action: input.action,
    summary: input.summary,
    before_payload: input.beforePayload ?? null,
    after_payload: input.afterPayload ?? null,
    metadata: input.metadata ?? null,
  });

  if (error) {
    console.warn('Audit event could not be recorded', error.message);
  }
}
