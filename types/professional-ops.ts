import type { Branch } from '@/types/dallmayrerp';

export type WorkType = 'request' | 'task' | 'approval' | 'inspection' | 'maintenance' | 'incident';
export type WorkStatus = 'new' | 'triaged' | 'assigned' | 'in_progress' | 'blocked' | 'waiting_approval' | 'completed' | 'cancelled';
export type WorkPriority = 'low' | 'medium' | 'high' | 'critical';
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export type WorkItemRecord = {
  id: string;
  work_number: string;
  title: string;
  description: string | null;
  work_type: WorkType;
  department: string;
  branch: Branch;
  status: WorkStatus;
  priority: WorkPriority;
  requested_by: string | null;
  assigned_to: string | null;
  customer_id: string | null;
  site_id: string | null;
  machine_id: string | null;
  stock_item_id: string | null;
  due_at: string | null;
  sla_due_at: string | null;
  approval_required: boolean;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssignableUser = {
  user_id: string;
  display_name: string;
  role: string;
  branch: Branch;
};

export type MachineLifecycleRecord = {
  id: string;
  branch: Branch;
  customer_id: string | null;
  site_id: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  machine_name: string | null;
  model: string | null;
  status: string;
  condition: 'good' | 'fair' | 'poor' | 'critical' | 'unknown';
  criticality: 'low' | 'medium' | 'high' | 'critical';
  installed_at: string | null;
  warranty_expires_at: string | null;
  last_audit_at: string | null;
  next_audit_at: string | null;
  current_custodian: string | null;
  custody_status: 'available' | 'assigned' | 'checked_out' | 'in_service' | 'retired';
  created_at: string;
  updated_at: string;
};
