'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

export type AuditEventRow = {
  id: string;
  actor_role: string | null;
  branch: string | null;
  entity_type: string;
  action: string;
  summary: string | null;
  created_at: string;
};

export function AdminActivityLog() {
  const [rows, setRows] = useState<AuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadActivity() {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient()
      .from('audit_events')
      .select('id, actor_role, branch, entity_type, action, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    setRows((data ?? []) as AuditEventRow[]);
    setLoading(false);
  }

  useEffect(() => {
    loadActivity();
  }, []);

  return (
    <div className="grid">
      {error ? <div className="error">{error}</div> : null}
      <div className="card">
        <h2>Enterprise activity trail</h2>
        <p>Latest auditable events across user administration, stock, orders, service jobs, task closures, documents and system activity.</p>
        <button className="button secondary" onClick={loadActivity} type="button">Refresh activity</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Role</th><th>Branch</th><th>Entity</th><th>Action</th><th>Summary</th></tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={6}>Loading activity...</td></tr> : null}
            {!loading && rows.length === 0 ? <tr><td colSpan={6}>No audit events recorded yet.</td></tr> : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{row.actor_role ?? '-'}</td>
                <td>{row.branch ?? '-'}</td>
                <td>{row.entity_type}</td>
                <td>{row.action}</td>
                <td>{row.summary ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
