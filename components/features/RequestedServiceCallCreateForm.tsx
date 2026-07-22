'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import type { ServicePriority } from '@/types/enterprise-records';

type TechnicianOption = {
  user_id: string;
  display_name: string;
  role: string;
  branch: Branch;
};

type SiteOption = { id: string; site_name: string; address: string | null };
type MachineOption = {
  id: string;
  machine_name: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  site_id: string | null;
};

const priorities: ServicePriority[] = ['low', 'medium', 'high', 'critical'];
const callTypes = ['By Phone', 'By Email', 'WhatsApp', 'Customer Portal', 'Walk-in', 'Internal', 'Other'];

function machineLabel(machine: MachineOption) {
  return machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed machine';
}

export function RequestedServiceCallCreateForm({
  technicians,
  onCreated,
}: {
  technicians: TechnicianOption[];
  onCreated: () => Promise<void>;
}) {
  const { userDetails } = useAuth();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [branch, setBranch] = useState<Branch>(userDetails?.branch ?? 'jhb');
  const [siteId, setSiteId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [assignedTo, setAssignedTo] = useState('');
  const [priority, setPriority] = useState<ServicePriority>('medium');
  const [callType, setCallType] = useState('By Phone');
  const [summary, setSummary] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visibleMachines = useMemo(
    () => siteId ? machines.filter((machine) => !machine.site_id || machine.site_id === siteId) : machines,
    [machines, siteId],
  );

  const visibleTechnicians = useMemo(
    () => branch === 'national'
      ? technicians
      : technicians.filter((technician) => technician.branch === branch || technician.branch === 'national'),
    [branch, technicians],
  );

  async function applyCustomer(customer: CustomerOption | null) {
    setError(null);
    setCustomerId(customer?.id ?? null);
    setCustomerName(customer?.customer_name ?? '');
    setSiteId('');
    setMachineId('');
    setSites([]);
    setMachines([]);
    setAssignedTo('');
    if (!customer) return;

    if (userDetails?.role === 'operations'
      && userDetails.branch !== 'national'
      && customer.branch !== userDetails.branch) {
      setCustomerId(null);
      setCustomerName('');
      setError('Select a customer in your assigned Operations branch.');
      return;
    }

    setBranch(customer.branch);
    const client = getSupabaseClient();
    const [siteResult, machineResult] = await Promise.all([
      client.from('customer_sites').select('id, site_name, address').eq('customer_id', customer.id).order('site_name'),
      client.from('machines')
        .select('id, machine_name, serial_number, machine_barcode, site_id')
        .eq('customer_id', customer.id)
        .not('status', 'eq', 'retired')
        .order('machine_name'),
    ]);

    if (siteResult.error || machineResult.error) {
      setError(siteResult.error?.message ?? machineResult.error?.message ?? 'Could not load customer sites and machines.');
      return;
    }
    setSites((siteResult.data ?? []) as SiteOption[]);
    setMachines((machineResult.data ?? []) as MachineOption[]);
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!customerId) {
      setError('Select a customer from the search results.');
      return;
    }
    if (!summary.trim()) {
      setError('Complaint details are required.');
      return;
    }

    setSaving(true);
    const { data, error: createError } = await getSupabaseClient().rpc('create_service_call_log', {
      p_customer_id: customerId,
      p_branch: branch,
      p_service_type: 'Technical',
      p_complaint_details: summary.trim(),
      p_site_id: siteId || null,
      p_machine_id: machineId || null,
      p_assigned_to: assignedTo || null,
      p_priority: priority,
      p_reported_at: new Date().toISOString(),
      p_contact_name: null,
      p_telephone: null,
      p_fax: null,
      p_mobile: null,
      p_contact_email: null,
      p_address_snapshot: null,
      p_service_code: 'TC',
      p_site_location: sites.find((site) => site.id === siteId)?.site_name ?? null,
      p_call_type: callType,
      p_call_reason: 'Customer request',
      p_category: 'Customer request',
      p_sub_category: null,
      p_group_3: null,
      p_follow_up_at: dueAt ? new Date(dueAt).toISOString() : null,
      p_work_order_number: null,
      p_assignment_notes: notes.trim() || null,
      p_parts_extra: false,
      p_performance_report_required: false,
      p_visits_chargeable: false,
      p_quotation_required: false,
      p_ticket_reference: null,
      p_ticket_case_number: null,
      p_reference_date_1: null,
      p_reference_date_2: null,
    });
    setSaving(false);

    if (createError) {
      setError(createError.message);
      return;
    }

    const created = Array.isArray(data)
      ? data[0] as { job_number?: string; incident_number?: string } | undefined
      : undefined;
    setMessage(`Requested service call ${created?.incident_number ?? ''} created${created?.job_number ? ` as ${created.job_number}` : ''}.`);
    setCustomerId(null);
    setCustomerName('');
    setSiteId('');
    setMachineId('');
    setSites([]);
    setMachines([]);
    setAssignedTo('');
    setPriority('medium');
    setCallType('By Phone');
    setSummary('');
    setDueAt('');
    setNotes('');
    await onCreated();
  }

  return (
    <section className="neo-card requested-service-create-card">
      <div className="minimal-panel-header">
        <div>
          <span className="minimal-kicker">Request-only customer</span>
          <h2>New requested service call</h2>
          <p>Use this compact form only for customers serviced on request. Recurring maintenance belongs under New maintenance plan.</p>
        </div>
      </div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}
      <form className="grid" onSubmit={createRequest}>
        <div className="form-grid">
          <CustomerSelect label="Customer *" onSelect={applyCustomer} required value={customerName} />
          <label>Site
            <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              <option value="">No site selected</option>
              {sites.map((site) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
            </select>
          </label>
          <label>Machine
            <select value={machineId} onChange={(event) => setMachineId(event.target.value)}>
              <option value="">No machine selected</option>
              {visibleMachines.map((machine) => <option key={machine.id} value={machine.id}>{machineLabel(machine)}</option>)}
            </select>
          </label>
          <label>Call type
            <select value={callType} onChange={(event) => setCallType(event.target.value)}>
              {callTypes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value as ServicePriority)}>
              {priorities.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Assigned technician
            <select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
              <option value="">Unassigned</option>
              {visibleTechnicians.map((technician) => <option key={technician.user_id} value={technician.user_id}>{technician.display_name || technician.role}</option>)}
            </select>
          </label>
          <label>Follow up on<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        </div>
        <label>Complaint details *<textarea required rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label>Assignment notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <button className="button" disabled={saving || !customerId || !summary.trim()} type="submit">{saving ? 'Creating request…' : 'Create requested service call'}</button>
      </form>
    </section>
  );
}
