import { SupabaseClient } from '@supabase/supabase-js';

export async function countRows(client: SupabaseClient, table: string) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function safeCountRows(client: SupabaseClient, table: string) {
  try {
    return await countRows(client, table);
  } catch {
    return 0;
  }
}

export async function countRawCustomers(client: SupabaseClient) {
  const [jhb, cpt, kzn] = await Promise.all([
    safeCountRows(client, 'customer_master_jhb'),
    safeCountRows(client, 'customer_master_cpt'),
    safeCountRows(client, 'customer_master_kzn'),
  ]);
  return { jhb, cpt, kzn, total: jhb + cpt + kzn };
}

export async function countRawContracts(client: SupabaseClient) {
  const [jhb, cpt, kzn] = await Promise.all([
    safeCountRows(client, 'contract_agreement_jhb'),
    safeCountRows(client, 'contract_agreement_cpt'),
    safeCountRows(client, 'contract_agreement_kzn'),
  ]);
  return { jhb, cpt, kzn, total: jhb + cpt + kzn };
}

export async function countRawServiceCalls(client: SupabaseClient) {
  const [jhb, kzn, cptPreventive] = await Promise.all([
    safeCountRows(client, 'service_call_log_jhb'),
    safeCountRows(client, 'service_call_log_kzn'),
    safeCountRows(client, 'preventive_service_log_cpt'),
  ]);
  return { jhb, kzn, cptPreventive, total: jhb + kzn + cptPreventive };
}
