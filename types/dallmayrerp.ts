export type BusinessRole =
  | 'admin'
  | 'operations'
  | 'sales'
  | 'finance'
  | 'marketing'
  | 'executive'
  | 'warehouse_staff'
  | 'technician'
  | 'road_technician';

export type Department =
  | 'administration'
  | 'operations'
  | 'sales'
  | 'finance'
  | 'marketing'
  | 'executive'
  | 'warehouse'
  | 'technical'
  | 'field_service';

export type Branch = 'jhb' | 'cpt' | 'kzn' | 'national';

export interface BusinessUser {
  id: string;
  auth_user_id: string | null;
  employee_code: string | null;
  first_name: string;
  last_name: string;
  full_name: string | null;
  email: string;
  phone_number: string | null;
  birthday: string | null;
  role: BusinessRole;
  department: Department;
  branch: Branch | null;
  job_title: string | null;
  manager_id: string | null;
  employment_status: 'active' | 'inactive' | 'on_leave' | 'terminated';
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockItem {
  id: string;
  stock_name: string;
  item_barcode: string;
  box_barcode: string | null;
  item_quantity: number;
  box_quantity: number;
  items_per_box: number | null;
  category: string | null;
  supplier_name: string | null;
  warehouse_location: string | null;
  reorder_level: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface KpiCardData {
  label: string;
  value: number | string;
  helper?: string;
}
