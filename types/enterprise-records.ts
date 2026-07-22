import type { Branch } from '@/types/dallmayrerp';

export type CustomerRecord = {
  id: string;
  branch: Branch;
  customer_code: string | null;
  customer_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string | null;
};

export type MachineStatus = 'active' | 'inactive' | 'repair' | 'retired' | 'unknown';

export type MachineRecord = {
  id: string;
  branch: Branch;
  customer_id: string | null;
  site_id: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  machine_name: string | null;
  model: string | null;
  status: MachineStatus;
  created_at: string;
};

export type StockRecord = {
  id: string;
  stock_name: string;
  item_barcode: string;
  box_barcode: string | null;
  item_quantity: number;
  box_quantity: number;
  reorder_level: number;
  warehouse_location: string | null;
};

export type DeliveryStatus = 'draft' | 'picked' | 'dispatched' | 'delivered' | 'closed' | 'cancelled';

export type DeliveryOrderRecord = {
  id: string;
  order_number: string;
  branch: Branch;
  customer_name: string;
  delivery_address: string | null;
  status: DeliveryStatus;
  created_at: string;
  dispatched_at: string | null;
  delivered_at: string | null;
  closed_at: string | null;
};

export type ServiceJobStatus = 'new' | 'assigned' | 'in_progress' | 'completed' | 'verified' | 'closed' | 'cancelled';
export type ServicePriority = 'low' | 'medium' | 'high' | 'critical';

export type ServiceJobRecord = {
  id: string;
  job_number: string;
  incident_number: string;
  branch: Branch;
  customer_id: string | null;
  customer_code_snapshot: string | null;
  customer_name_snapshot: string | null;
  site_id: string | null;
  machine_id: string | null;
  assigned_to: string | null;
  priority: ServicePriority;
  status: ServiceJobStatus;
  summary: string;
  description: string | null;
  complaint_details: string;
  due_at: string | null;
  completed_at: string | null;
  reported_at: string;
  call_logged_by: string | null;
  contact_name: string | null;
  telephone: string | null;
  fax: string | null;
  mobile: string | null;
  contact_email: string | null;
  address_snapshot: string | null;
  service_type: string;
  service_code: string | null;
  site_location: string | null;
  call_type: string | null;
  call_reason: string | null;
  category: string | null;
  sub_category: string | null;
  group_3: string | null;
  work_order_number: string | null;
  assignment_notes: string | null;
  closed_by: string | null;
  closed_at: string | null;
  closing_remarks: string | null;
  parts_extra: boolean;
  performance_report_required: boolean;
  visits_chargeable: boolean;
  quotation_required: boolean;
  ticket_reference: string | null;
  ticket_case_number: string | null;
  reference_date_1: string | null;
  reference_date_2: string | null;
  created_at: string;
};
