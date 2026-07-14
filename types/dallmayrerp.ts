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

export interface UserDetails {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone_number: string | null;
  birthday: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  profile_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessUser {
  id: string;
  auth_user_id: string | null;
  employee_code: string | null;
  first_name: string | null;
  last_name: string | null;
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
  onboarding_required: boolean;
  profile_completed_at: string | null;
  last_login_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessProfile {
  user: BusinessUser;
  details: UserDetails | null;
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

export function isProfileComplete(details: UserDetails | null) {
  return Boolean(
    details?.first_name?.trim()
    && details?.last_name?.trim()
    && details?.phone_number?.trim(),
  );
}

export function displayProfileName(profile: BusinessProfile | null) {
  if (!profile) return 'Unknown user';
  const fullName = profile.details?.full_name?.trim();
  if (fullName) return fullName;
  const joined = [profile.details?.first_name, profile.details?.last_name].filter(Boolean).join(' ').trim();
  return joined || profile.user.email;
}

export function displayUserName(user: Pick<BusinessUser, 'first_name' | 'last_name' | 'full_name' | 'email'>) {
  const fromFullName = user.full_name?.trim();
  if (fromFullName) return fromFullName;

  const joined = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return joined || user.email;
}
