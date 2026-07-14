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

export type Branch = 'jhb' | 'cpt' | 'kzn' | 'national';

export interface BusinessUser {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface UserDetails {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  birthday: string | null;
  role: BusinessRole;
  branch: Branch;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
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
    && details?.phone_number?.trim()
    && details?.birthday
    && details?.emergency_contact_name?.trim()
    && details?.emergency_contact_phone?.trim(),
  );
}

export function displayDetailsName(details: UserDetails | null, fallbackEmail: string) {
  const joined = [details?.first_name, details?.last_name].filter(Boolean).join(' ').trim();
  return joined || fallbackEmail;
}

export function displayProfileName(profile: BusinessProfile | null) {
  if (!profile) return 'Unknown user';
  return displayDetailsName(profile.details, profile.user.email);
}