'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import { displayProfileName } from '@/types/dallmayrerp';
import type { ServicePriority } from '@/types/enterprise-records';

export type TechnicianOption = {
  user_id: string;
  display_name: string;
  role: string;
  branch: Branch;
};

type SiteOption = {
  id: string;
  site_name: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
};

type MachineOption = {
  id: string;
  machine_name: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  site_id: string | null;
};

type CallLogForm = {
  branch: Branch;
  reportedAt: string;
  contactName: string;
  telephone: string;
  fax: string;
  mobile: string;
  contactEmail: string;
  address: string;
  serviceType: string;
  serviceCode: string;
  complaintDetails: string;
  siteLocation: string;
  callType: string;
  callReason: string;
  category: string;
  subCategory: string;
  group3: string;
  assignedTo: string;
  followUpAt: string;
  workOrderNumber: string;
  priority: ServicePriority;
  assignmentNotes: string;
  partsExtra: boolean;
  performanceReportRequired: boolean;
  visitsChargeable: boolean;
  quotationRequired: boolean;
  ticketReference: string;
  ticketCaseNumber: string;
  referenceDate1: string;
  referenceDate2: string;
};

const branchLabels: Record<Branch, string> = {
  jhb: 'Johannesburg',
  cpt: 'Cape Town',
  kzn: 'KwaZulu-Natal',
  national: 'National',
};

const priorities: ServicePriority[] = ['low', 'medium', 'high', 'critical'];
const serviceTypes = ['Technical', 'Breakdown', 'Calibration', 'Preventive Maintenance', 'Installation', 'Assessment / Quote', 'Other'];
const callTypes = ['By Phone', 'By Email', 'WhatsApp', 'Customer Portal', 'Walk-in', 'Internal', 'Other'];

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function initialForm(branch: Branch): CallLogForm {
  return {
    branch,
    reportedAt: localDateTimeValue(),
    contactName: '',
    telephone: '',
    fax: '',
    mobile: '',
    contactEmail: '',
    address: '',
    serviceType: 'Technical',
    serviceCode: 'TC',
    complaintDetails: '',
    siteLocation: '',
    callType: 'By Phone',
    callReason: '',
    category: '',
    subCategory: '',
    group3: '',
    assignedTo: '',
    followUpAt: '',
    workOrderNumber: '',
    priority: 'medium',
    assignmentNotes: '',
    partsExtra: false,
    performanceReportRequired: false,
    visitsChargeable: false,
    quotationRequired: false,
    ticketReference: '',
    ticketCaseNumber: '',
    referenceDate1: '',
    referenceDate2: '',
  };
}

function optionalText(value: string) {
  return value.trim() || null;
}

function optionalDateTime(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function ServiceCallLogCreateForm({
  technicians,
  onCreated,
}: {
  technicians: TechnicianOption[];
  onCreated: () => Promise<void>;
}) {
  const { businessProfile, userDetails } = useAuth();
  const defaultBranch = userDetails?.branch ?? 'jhb';
  const [form, setForm] = useState<CallLogForm>(() => initialForm(defaultBranch));
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [siteId, setSiteId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const allowedBranches = useMemo<Branch[]>(() => {
    if (userDetails?.role === 'operations' && userDetails.branch !== 'national') return [userDetails.branch];
    return ['jhb', 'cpt', 'kzn', 'national'];
  }, [userDetails?.branch, userDetails?.role]);

  const visibleMachines = useMemo(
    () => siteId ? machines.filter((machine) => !machine.site_id || machine.site_id === siteId) : machines,
    [machines, siteId],
  );

  const initialStatus = form.assignedTo ? 'Assigned' : 'New';
  const loggerName = displayProfileName(businessProfile);

  async function applyCustomer(customer: CustomerOption | null) {
    setError(null);
    setCustomerId(customer?.id ?? null);
    setCustomerName(customer?.customer_name ?? '');
    setCustomerCode(customer?.customer_code ?? '');
    setSiteId('');
    setMachineId('');
    setSites([]);
    setMachines([]);

    if (!customer) return;

    if (userDetails?.role === 'operations'
      && userDetails.branch !== 'national'
      && customer.branch !== userDetails.branch) {
      setCustomerId(null);
      setCustomerName('');
      setCustomerCode('');
      setError(`Select a customer in ${branchLabels[userDetails.branch]}. Your Operations access is branch restricted.`);
      return;
    }

    setForm((current) => ({
      ...current,
      branch: customer.branch,
      telephone: customer.phone ?? '',
      contactEmail: customer.email ?? '',
      address: customer.address ?? '',
    }));

    const client = getSupabaseClient();
    const [siteResult, machineResult] = await Promise.all([
      client
        .from('customer_sites')
        .select('id, site_name, address, contact_name, contact_phone')
        .eq('customer_id', customer.id)
        .order('site_name'),
      client
        .from('machines')
        .select('id, machine_name, serial_number, machine_barcode, site_id')
        .eq('customer_id', customer.id)
        .order('machine_name'),
    ]);

    if (siteResult.error || machineResult.error) {
      setError(siteResult.error?.message ?? machineResult.error?.message ?? 'Could not load customer sites and machines.');
      return;
    }

    setSites((siteResult.data ?? []) as SiteOption[]);
    setMachines((machineResult.data ?? []) as MachineOption[]);
  }

  function selectSite(nextSiteId: string) {
    setSiteId(nextSiteId);
    const site = sites.find((item) => item.id === nextSiteId);
    if (!site) return;

    setForm((current) => ({
      ...current,
      siteLocation: site.site_name,
      address: site.address ?? current.address,
      contactName: site.contact_name ?? current.contactName,
      telephone: site.contact_phone ?? current.telephone,
    }));

    const selectedMachine = machines.find((machine) => machine.id === machineId);
    if (selectedMachine?.site_id && selectedMachine.site_id !== nextSiteId) setMachineId('');
  }

  function resetForm() {
    const branch = userDetails?.branch ?? 'jhb';
    setForm(initialForm(branch));
    setCustomerId(null);
    setCustomerName('');
    setCustomerCode('');
    setSiteId('');
    setMachineId('');
    setSites([]);
    setMachines([]);
  }

  async function createCallLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!customerId) {
      setError('Select a customer from the search results before creating the call log.');
      return;
    }

    if (!form.category.trim()) {
      setError('Category is required.');
      return;
    }

    setSaving(true);
    const { data, error: createError } = await getSupabaseClient().rpc('create_service_call_log', {
      p_customer_id: customerId,
      p_branch: form.branch,
      p_service_type: form.serviceType,
      p_complaint_details: form.complaintDetails.trim(),
      p_site_id: siteId || null,
      p_machine_id: machineId || null,
      p_assigned_to: form.assignedTo || null,
      p_priority: form.priority,
      p_reported_at: new Date(form.reportedAt).toISOString(),
      p_contact_name: optionalText(form.contactName),
      p_telephone: optionalText(form.telephone),
      p_fax: optionalText(form.fax),
      p_mobile: optionalText(form.mobile),
      p_contact_email: optionalText(form.contactEmail),
      p_address_snapshot: optionalText(form.address),
      p_service_code: optionalText(form.serviceCode),
      p_site_location: optionalText(form.siteLocation),
      p_call_type: optionalText(form.callType),
      p_call_reason: optionalText(form.callReason),
      p_category: form.category.trim(),
      p_sub_category: optionalText(form.subCategory),
      p_group_3: optionalText(form.group3),
      p_follow_up_at: optionalDateTime(form.followUpAt),
      p_work_order_number: optionalText(form.workOrderNumber),
      p_assignment_notes: optionalText(form.assignmentNotes),
      p_parts_extra: form.partsExtra,
      p_performance_report_required: form.performanceReportRequired,
      p_visits_chargeable: form.visitsChargeable,
      p_quotation_required: form.quotationRequired,
      p_ticket_reference: optionalText(form.ticketReference),
      p_ticket_case_number: optionalText(form.ticketCaseNumber),
      p_reference_date_1: form.referenceDate1 || null,
      p_reference_date_2: form.referenceDate2 || null,
    });
    setSaving(false);

    if (createError) {
      setError(createError.message);
      return;
    }

    const created = Array.isArray(data) ? data[0] as { job_number?: string; incident_number?: string } | undefined : undefined;
    setMessage(`Call log ${created?.incident_number ?? ''} created${created?.job_number ? ` as ${created.job_number}` : ''}.`);
    resetForm();
    await onCreated();
  }

  return (
    <section className="neo-card call-log-create-card">
      <div className="minimal-panel-header call-log-create-header">
        <div>
          <span className="minimal-kicker">Scheduled call log</span>
          <h2>Create service call log</h2>
          <p>Capture the complete incident, customer contact, classification, assignment, closing and ticket information.</p>
        </div>
        <div className="call-log-form-status">
          <span>Initial status</span>
          <strong>{initialStatus}</strong>
        </div>
      </div>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <form className="call-log-form" onSubmit={createCallLog}>
        <fieldset className="call-log-section call-log-section-wide">
          <legend>Incident and customer information</legend>
          <div className="call-log-grid call-log-grid-4">
            <label>Incident ID
              <input disabled value="Assigned automatically" />
            </label>
            <label>Reported at
              <input required type="datetime-local" value={form.reportedAt} onChange={(event) => setForm((current) => ({ ...current, reportedAt: event.target.value }))} />
            </label>
            <label>Call logged by
              <input disabled value={loggerName} />
            </label>
            <label>Division
              <select value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value as Branch }))}>
                {allowedBranches.map((branch) => <option key={branch} value={branch}>{branch.toUpperCase()} — {branchLabels[branch]}</option>)}
              </select>
            </label>
          </div>

          <div className="call-log-grid call-log-grid-customer">
            <CustomerSelect label="Customer *" onSelect={applyCustomer} required value={customerName} />
            <label>Customer code
              <input disabled value={customerCode || 'Select a customer'} />
            </label>
            <label>Contact
              <input value={form.contactName} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} />
            </label>
          </div>

          <div className="call-log-grid call-log-grid-4">
            <label>Telephone
              <input inputMode="tel" value={form.telephone} onChange={(event) => setForm((current) => ({ ...current, telephone: event.target.value }))} />
            </label>
            <label>Fax
              <input inputMode="tel" value={form.fax} onChange={(event) => setForm((current) => ({ ...current, fax: event.target.value }))} />
            </label>
            <label>Mobile
              <input inputMode="tel" value={form.mobile} onChange={(event) => setForm((current) => ({ ...current, mobile: event.target.value }))} />
            </label>
            <label>Email
              <input type="email" value={form.contactEmail} onChange={(event) => setForm((current) => ({ ...current, contactEmail: event.target.value }))} />
            </label>
          </div>

          <label>Address
            <textarea rows={3} value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
          </label>
        </fieldset>

        <div className="call-log-column">
          <fieldset className="call-log-section">
            <legend>Call classification</legend>
            <div className="call-log-grid call-log-grid-2">
              <label>Service type *
                <select required value={form.serviceType} onChange={(event) => setForm((current) => ({ ...current, serviceType: event.target.value }))}>
                  {serviceTypes.map((serviceType) => <option key={serviceType}>{serviceType}</option>)}
                </select>
              </label>
              <label>SC #
                <input value={form.serviceCode} onChange={(event) => setForm((current) => ({ ...current, serviceCode: event.target.value }))} />
              </label>
            </div>

            <label>Complaint details *
              <textarea required rows={5} value={form.complaintDetails} onChange={(event) => setForm((current) => ({ ...current, complaintDetails: event.target.value }))} />
            </label>

            <div className="call-log-grid call-log-grid-2">
              <label>Customer site
                <select value={siteId} onChange={(event) => selectSite(event.target.value)}>
                  <option value="">No site selected</option>
                  {sites.map((site) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
                </select>
              </label>
              <label>Machine
                <select value={machineId} onChange={(event) => setMachineId(event.target.value)}>
                  <option value="">No machine selected</option>
                  {visibleMachines.map((machine) => (
                    <option key={machine.id} value={machine.id}>{machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed machine'}</option>
                  ))}
                </select>
              </label>
              <label>Site location
                <input value={form.siteLocation} onChange={(event) => setForm((current) => ({ ...current, siteLocation: event.target.value }))} />
              </label>
              <label>Call type
                <select value={form.callType} onChange={(event) => setForm((current) => ({ ...current, callType: event.target.value }))}>
                  {callTypes.map((callType) => <option key={callType}>{callType}</option>)}
                </select>
              </label>
              <label>Call reason
                <input value={form.callReason} onChange={(event) => setForm((current) => ({ ...current, callReason: event.target.value }))} />
              </label>
              <label>Category *
                <input required value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} />
              </label>
              <label>Sub category
                <input value={form.subCategory} onChange={(event) => setForm((current) => ({ ...current, subCategory: event.target.value }))} />
              </label>
              <label>Group 3
                <input value={form.group3} onChange={(event) => setForm((current) => ({ ...current, group3: event.target.value }))} />
              </label>
            </div>
          </fieldset>
        </div>

        <div className="call-log-column">
          <fieldset className="call-log-section">
            <legend>Assignment information</legend>
            <div className="call-log-grid call-log-grid-2">
              <label>Assigned to
                <select value={form.assignedTo} onChange={(event) => setForm((current) => ({ ...current, assignedTo: event.target.value }))}>
                  <option value="">Unassigned</option>
                  {technicians.map((technician) => (
                    <option key={technician.user_id} value={technician.user_id}>{technician.display_name || technician.role} — {technician.branch.toUpperCase()}</option>
                  ))}
                </select>
              </label>
              <label>Follow up on
                <input type="datetime-local" value={form.followUpAt} onChange={(event) => setForm((current) => ({ ...current, followUpAt: event.target.value }))} />
              </label>
              <label>WO #
                <input value={form.workOrderNumber} onChange={(event) => setForm((current) => ({ ...current, workOrderNumber: event.target.value }))} />
              </label>
              <label>Priority
                <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as ServicePriority }))}>
                  {priorities.map((priority) => <option key={priority}>{priority}</option>)}
                </select>
              </label>
            </div>
            <label>Notes, if any
              <textarea rows={3} value={form.assignmentNotes} onChange={(event) => setForm((current) => ({ ...current, assignmentNotes: event.target.value }))} />
            </label>
          </fieldset>

          <fieldset className="call-log-section call-log-closing-section">
            <legend>Closing information</legend>
            <div className="call-log-grid call-log-grid-2">
              <label>Status
                <input disabled value={initialStatus} />
              </label>
              <label>Closed by
                <input disabled value="Not closed" />
              </label>
              <label>Closed at
                <input disabled value="—" />
              </label>
            </div>
            <label>Remarks
              <textarea disabled rows={2} value="Entered when a verified call log is closed." />
            </label>
          </fieldset>

          <fieldset className="call-log-section">
            <legend>Other requirements</legend>
            <div className="call-log-requirements">
              <label><input checked={form.partsExtra} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, partsExtra: event.target.checked }))} />Parts extra</label>
              <label><input checked={form.performanceReportRequired} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, performanceReportRequired: event.target.checked }))} />Performance report required</label>
              <label><input checked={form.visitsChargeable} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, visitsChargeable: event.target.checked }))} />Visits are chargeable</label>
              <label><input checked={form.quotationRequired} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, quotationRequired: event.target.checked }))} />Quotation required</label>
            </div>

            <div className="call-log-grid call-log-grid-2">
              <label>Ticket
                <input value={form.ticketReference} onChange={(event) => setForm((current) => ({ ...current, ticketReference: event.target.value }))} />
              </label>
              <label>Ticket C. # *
                <input placeholder="Defaults to generated Incident ID" value={form.ticketCaseNumber} onChange={(event) => setForm((current) => ({ ...current, ticketCaseNumber: event.target.value }))} />
              </label>
              <label>Ref 1 date
                <input type="date" value={form.referenceDate1} onChange={(event) => setForm((current) => ({ ...current, referenceDate1: event.target.value }))} />
              </label>
              <label>Ref 2 date
                <input type="date" value={form.referenceDate2} onChange={(event) => setForm((current) => ({ ...current, referenceDate2: event.target.value }))} />
              </label>
            </div>
          </fieldset>
        </div>

        <div className="call-log-submit-row call-log-section-wide">
          <div>
            <strong>Incident ID and Ticket C. #</strong>
            <span>A sequential Incident ID is generated on save. Ticket C. # uses that ID when left blank.</span>
          </div>
          <button className="button pulse-button" disabled={saving || !customerId || !form.complaintDetails.trim() || !form.category.trim()} type="submit">
            {saving ? 'Creating call log…' : 'Create call log'}
          </button>
        </div>
      </form>
    </section>
  );
}
