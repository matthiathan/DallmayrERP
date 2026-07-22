'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import { displayProfileName } from '@/types/dallmayrerp';
import type { ServicePriority } from '@/types/enterprise-records';

type TriggerType = 'calendar' | 'meter' | 'hybrid';

type TechnicianOption = {
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
  branch: Branch;
  meter_value: number;
  meter_unit: string;
};

type CustomerDefaults = {
  customer_id: string;
  branch: Branch;
  customer_code: string | null;
  customer_name: string;
  contact_name: string | null;
  telephone: string | null;
  fax: string | null;
  mobile: string | null;
  contact_email: string | null;
  address: string | null;
  site_location: string | null;
  category: string | null;
  sub_category: string | null;
  group_3: string | null;
};

type MaintenanceForm = {
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
  triggerType: TriggerType;
  intervalDays: number;
  intervalMeter: number;
  nextDueMeter: string;
  estimatedMinutes: number;
  checklistText: string;
};

const branchLabels: Record<Branch, string> = {
  jhb: 'Johannesburg',
  cpt: 'Cape Town',
  kzn: 'KwaZulu-Natal',
  national: 'National',
};

const priorities: ServicePriority[] = ['low', 'medium', 'high', 'critical'];
const serviceTypes = ['Preventive Maintenance', 'Calibration', 'Technical', 'Assessment / Quote', 'Installation', 'Other'];
const callTypes = ['By Phone', 'By Email', 'WhatsApp', 'Customer Portal', 'Walk-in', 'Internal', 'Other'];
const defaultChecklist = 'Inspect machine condition\nClean and test components\nRecord meter reading\nConfirm machine is operational';

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function initialForm(branch: Branch): MaintenanceForm {
  const firstMonthlyDate = new Date();
  firstMonthlyDate.setDate(firstMonthlyDate.getDate() + 30);
  return {
    branch,
    reportedAt: localDateTimeValue(),
    contactName: '',
    telephone: '',
    fax: '',
    mobile: '',
    contactEmail: '',
    address: '',
    serviceType: 'Preventive Maintenance',
    serviceCode: 'PM',
    complaintDetails: '',
    siteLocation: '',
    callType: 'Internal',
    callReason: 'Planned maintenance',
    category: 'Preventive Maintenance',
    subCategory: '',
    group3: '',
    assignedTo: '',
    followUpAt: localDateTimeValue(firstMonthlyDate),
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
    triggerType: 'calendar',
    intervalDays: 30,
    intervalMeter: 250,
    nextDueMeter: '',
    estimatedMinutes: 60,
    checklistText: defaultChecklist,
  };
}

function fallbackDefaults(customer: CustomerOption): CustomerDefaults {
  return {
    customer_id: customer.id,
    branch: customer.branch,
    customer_code: customer.customer_code,
    customer_name: customer.customer_name,
    contact_name: null,
    telephone: customer.phone,
    fax: null,
    mobile: null,
    contact_email: customer.email,
    address: customer.address,
    site_location: null,
    category: null,
    sub_category: null,
    group_3: null,
  };
}

function optionalText(value: string) {
  return value.trim() || null;
}

function optionalDateTime(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function machineLabel(machine: MachineOption) {
  const name = machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed machine';
  const identifier = machine.serial_number ?? machine.machine_barcode ?? 'No serial or barcode';
  return `${name} — ${identifier}`;
}

export function CompleteMaintenancePlanCreateForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const { businessProfile, userDetails } = useAuth();
  const defaultBranch = userDetails?.branch ?? 'jhb';
  const customerLoadRef = useRef(0);
  const [form, setForm] = useState<MaintenanceForm>(() => initialForm(defaultBranch));
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [customerDefaults, setCustomerDefaults] = useState<CustomerDefaults | null>(null);
  const [siteId, setSiteId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [loadingTechnicians, setLoadingTechnicians] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getSupabaseClient().rpc('list_assignable_technicians').then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message);
      else setTechnicians((data ?? []) as TechnicianOption[]);
      setLoadingTechnicians(false);
    });
  }, []);

  const allowedBranches = useMemo<Branch[]>(() => {
    if (userDetails?.role === 'operations' && userDetails.branch !== 'national') return [userDetails.branch];
    return ['jhb', 'cpt', 'kzn', 'national'];
  }, [userDetails?.branch, userDetails?.role]);

  const visibleMachines = useMemo(
    () => siteId ? machines.filter((machine) => !machine.site_id || machine.site_id === siteId) : machines,
    [machines, siteId],
  );

  const visibleTechnicians = useMemo(
    () => form.branch === 'national'
      ? technicians
      : technicians.filter((technician) => technician.branch === form.branch || technician.branch === 'national'),
    [form.branch, technicians],
  );

  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.id === machineId) ?? null,
    [machineId, machines],
  );

  const loggerName = displayProfileName(businessProfile);

  function clearCustomerFields() {
    setForm((current) => ({
      ...current,
      branch: userDetails?.branch ?? current.branch,
      contactName: '',
      telephone: '',
      fax: '',
      mobile: '',
      contactEmail: '',
      address: '',
      siteLocation: '',
      category: 'Preventive Maintenance',
      subCategory: '',
      group3: '',
      assignedTo: '',
    }));
  }

  async function applyCustomer(customer: CustomerOption | null) {
    const requestId = ++customerLoadRef.current;
    setError(null);
    setMessage(null);
    setLoadingCustomer(false);
    setCustomerId(customer?.id ?? null);
    setCustomerName(customer?.customer_name ?? '');
    setCustomerCode(customer?.customer_code ?? '');
    setCustomerDefaults(null);
    setSiteId('');
    setMachineId('');
    setSites([]);
    setMachines([]);

    if (!customer) {
      clearCustomerFields();
      return;
    }

    if (userDetails?.role === 'operations'
      && userDetails.branch !== 'national'
      && customer.branch !== userDetails.branch) {
      setCustomerId(null);
      setCustomerName('');
      setCustomerCode('');
      clearCustomerFields();
      setError(`Select a customer in ${branchLabels[userDetails.branch]}. Your Operations access is branch restricted.`);
      return;
    }

    const initialDefaults = fallbackDefaults(customer);
    setCustomerDefaults(initialDefaults);
    setForm((current) => ({
      ...current,
      branch: customer.branch,
      contactName: '',
      telephone: initialDefaults.telephone ?? '',
      fax: '',
      mobile: '',
      contactEmail: initialDefaults.contact_email ?? '',
      address: initialDefaults.address ?? '',
      siteLocation: '',
      category: 'Preventive Maintenance',
      subCategory: '',
      group3: '',
      assignedTo: '',
    }));

    setLoadingCustomer(true);
    const client = getSupabaseClient();
    const [defaultsResult, siteResult, machineResult] = await Promise.all([
      client.rpc('get_customer_form_defaults', { p_customer_id: customer.id }),
      client.from('customer_sites')
        .select('id, site_name, address, contact_name, contact_phone')
        .eq('customer_id', customer.id)
        .eq('status', 'active')
        .order('site_name'),
      client.from('machines')
        .select('id, machine_name, serial_number, machine_barcode, site_id, branch, meter_value, meter_unit')
        .eq('customer_id', customer.id)
        .not('status', 'eq', 'retired')
        .order('machine_name'),
    ]);

    if (requestId !== customerLoadRef.current) return;

    const defaults = ((defaultsResult.data ?? [])[0] as CustomerDefaults | undefined) ?? initialDefaults;
    const siteRows = (siteResult.data ?? []) as SiteOption[];
    const machineRows = (machineResult.data ?? []) as MachineOption[];
    const onlySite = siteRows.length === 1 ? siteRows[0] : null;
    const matchingMachines = onlySite
      ? machineRows.filter((machine) => !machine.site_id || machine.site_id === onlySite.id)
      : machineRows;
    const onlyMachine = matchingMachines.length === 1 ? matchingMachines[0] : null;

    setCustomerDefaults(defaults);
    setCustomerName(defaults.customer_name || customer.customer_name);
    setCustomerCode(defaults.customer_code ?? customer.customer_code ?? '');
    setSites(siteRows);
    setMachines(machineRows);
    setSiteId(onlySite?.id ?? '');
    setMachineId(onlyMachine?.id ?? '');
    setForm((current) => ({
      ...current,
      branch: defaults.branch,
      contactName: onlySite?.contact_name ?? defaults.contact_name ?? '',
      telephone: onlySite?.contact_phone ?? defaults.telephone ?? '',
      fax: defaults.fax ?? '',
      mobile: defaults.mobile ?? '',
      contactEmail: defaults.contact_email ?? '',
      address: onlySite?.address ?? defaults.address ?? '',
      siteLocation: onlySite?.site_name ?? defaults.site_location ?? '',
      category: defaults.category ?? 'Preventive Maintenance',
      subCategory: defaults.sub_category ?? '',
      group3: defaults.group_3 ?? '',
      assignedTo: '',
    }));

    const loadError = defaultsResult.error ?? siteResult.error ?? machineResult.error;
    if (loadError) {
      setError(`Customer selected, but some linked details could not be loaded: ${loadError.message}`);
    }
    setLoadingCustomer(false);
  }

  function selectSite(nextSiteId: string) {
    setSiteId(nextSiteId);
    const site = sites.find((item) => item.id === nextSiteId) ?? null;
    setForm((current) => ({
      ...current,
      siteLocation: site?.site_name ?? customerDefaults?.site_location ?? '',
      address: site?.address ?? customerDefaults?.address ?? '',
      contactName: site?.contact_name ?? customerDefaults?.contact_name ?? '',
      telephone: site?.contact_phone ?? customerDefaults?.telephone ?? '',
      fax: customerDefaults?.fax ?? current.fax,
      mobile: customerDefaults?.mobile ?? current.mobile,
      contactEmail: customerDefaults?.contact_email ?? current.contactEmail,
    }));

    const candidates = nextSiteId
      ? machines.filter((machine) => !machine.site_id || machine.site_id === nextSiteId)
      : machines;
    const selected = machines.find((machine) => machine.id === machineId);
    const selectedStillValid = !selected?.site_id || !nextSiteId || selected.site_id === nextSiteId;
    if (!selectedStillValid) {
      setMachineId(candidates.length === 1 ? candidates[0].id : '');
    } else if (!machineId && candidates.length === 1) {
      setMachineId(candidates[0].id);
    }
  }

  function resetForm() {
    customerLoadRef.current += 1;
    setForm(initialForm(userDetails?.branch ?? 'jhb'));
    setCustomerId(null);
    setCustomerName('');
    setCustomerCode('');
    setCustomerDefaults(null);
    setSiteId('');
    setMachineId('');
    setSites([]);
    setMachines([]);
    setLoadingCustomer(false);
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!customerId) {
      setError('Select a customer from the search results before creating the maintenance plan.');
      return;
    }
    if (!machineId) {
      setError('Select the machine covered by this maintenance plan.');
      return;
    }
    if (!form.category.trim()) {
      setError('Category is required.');
      return;
    }
    if (form.triggerType !== 'meter' && !form.followUpAt) {
      setError('Follow up on is required for calendar and hybrid maintenance plans.');
      return;
    }
    if (form.triggerType !== 'calendar' && (!form.nextDueMeter || Number(form.nextDueMeter) < 0)) {
      setError('Enter the first due meter for meter and hybrid maintenance plans.');
      return;
    }

    const checklist = form.checklistText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((label, index) => ({ label, required: true, sort_order: index }));

    const payload = {
      customer_id: customerId,
      site_id: siteId || null,
      machine_id: machineId,
      branch: form.branch,
      reported_at: new Date(form.reportedAt).toISOString(),
      contact_name: optionalText(form.contactName),
      telephone: optionalText(form.telephone),
      fax: optionalText(form.fax),
      mobile: optionalText(form.mobile),
      contact_email: optionalText(form.contactEmail),
      address_snapshot: optionalText(form.address),
      service_type: form.serviceType,
      service_code: optionalText(form.serviceCode),
      complaint_details: form.complaintDetails.trim(),
      site_location: optionalText(form.siteLocation),
      call_type: optionalText(form.callType),
      call_reason: optionalText(form.callReason),
      category: form.category.trim(),
      sub_category: optionalText(form.subCategory),
      group_3: optionalText(form.group3),
      assigned_to: form.assignedTo || null,
      follow_up_at: optionalDateTime(form.followUpAt),
      work_order_number: optionalText(form.workOrderNumber),
      priority: form.priority,
      assignment_notes: optionalText(form.assignmentNotes),
      parts_extra: form.partsExtra,
      performance_report_required: form.performanceReportRequired,
      visits_chargeable: form.visitsChargeable,
      quotation_required: form.quotationRequired,
      ticket_reference: optionalText(form.ticketReference),
      ticket_case_number: optionalText(form.ticketCaseNumber),
      reference_date_1: form.referenceDate1 || null,
      reference_date_2: form.referenceDate2 || null,
      trigger_type: form.triggerType,
      interval_days: form.triggerType === 'meter' ? null : form.intervalDays,
      interval_meter: form.triggerType === 'calendar' ? null : form.intervalMeter,
      next_due_meter: form.triggerType === 'calendar' ? null : Number(form.nextDueMeter),
      estimated_minutes: form.estimatedMinutes,
      checklist_template: checklist,
    };

    setSaving(true);
    const { data, error: createError } = await getSupabaseClient().rpc('create_complete_maintenance_plan', {
      p_payload: payload,
    });
    setSaving(false);

    if (createError) {
      setError(createError.message);
      return;
    }

    const created = Array.isArray(data)
      ? data[0] as { plan_number?: string; incident_number?: string } | undefined
      : undefined;
    setMessage(`Maintenance plan ${created?.plan_number ?? ''} created for incident ${created?.incident_number ?? ''}.`);
    resetForm();
    await onCreated();
  }

  return (
    <section className="neo-card call-log-create-card maintenance-plan-create-card">
      <div className="minimal-panel-header call-log-create-header">
        <div>
          <span className="minimal-kicker">Preventive maintenance</span>
          <h2>New maintenance plan</h2>
          <p>Capture the complete customer, service, assignment, requirements and recurrence information.</p>
        </div>
        <div className="call-log-form-status"><span>Initial status</span><strong>Active plan</strong></div>
      </div>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <form className="call-log-form" onSubmit={createPlan}>
        <fieldset aria-busy={loadingCustomer} className="call-log-section call-log-section-wide">
          <legend>Incident and customer information</legend>
          <div className="call-log-grid call-log-grid-4">
            <label>Incident ID<input disabled value="Assigned automatically" /></label>
            <label>Reported at<input required type="datetime-local" value={form.reportedAt} onChange={(event) => setForm((current) => ({ ...current, reportedAt: event.target.value }))} /></label>
            <label>Call logged by<input disabled value={loggerName} /></label>
            <label>Division
              <select value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value as Branch, assignedTo: '' }))}>
                {allowedBranches.map((branch) => <option key={branch} value={branch}>{branch.toUpperCase()} — {branchLabels[branch]}</option>)}
              </select>
            </label>
          </div>

          <div className="call-log-grid call-log-grid-customer">
            <CustomerSelect label="Customer *" onSelect={applyCustomer} required value={customerName} />
            <label>Customer code<input disabled value={customerCode || 'Select a customer'} /></label>
            <label>Contact<input value={form.contactName} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} /></label>
          </div>
          <small className="field-note">
            {loadingCustomer
              ? 'Loading customer master, contact, site and machine details…'
              : customerId
                ? 'Customer fields were populated automatically. Selecting a site applies its contact and address details.'
                : 'Select a customer to populate all available customer information automatically.'}
          </small>

          <div className="call-log-grid call-log-grid-4">
            <label>Telephone<input inputMode="tel" value={form.telephone} onChange={(event) => setForm((current) => ({ ...current, telephone: event.target.value }))} /></label>
            <label>Fax<input inputMode="tel" value={form.fax} onChange={(event) => setForm((current) => ({ ...current, fax: event.target.value }))} /></label>
            <label>Mobile<input inputMode="tel" value={form.mobile} onChange={(event) => setForm((current) => ({ ...current, mobile: event.target.value }))} /></label>
            <label>Email<input type="email" value={form.contactEmail} onChange={(event) => setForm((current) => ({ ...current, contactEmail: event.target.value }))} /></label>
          </div>
          <label>Address<textarea rows={3} value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} /></label>
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
              <label>SC #<input value={form.serviceCode} onChange={(event) => setForm((current) => ({ ...current, serviceCode: event.target.value }))} /></label>
            </div>
            <label>Complaint details *<textarea required rows={5} value={form.complaintDetails} onChange={(event) => setForm((current) => ({ ...current, complaintDetails: event.target.value }))} /></label>
            <div className="call-log-grid call-log-grid-2">
              <label>Customer site
                <select disabled={loadingCustomer || !customerId} value={siteId} onChange={(event) => selectSite(event.target.value)}>
                  <option value="">{sites.length ? 'No site selected' : 'No active customer sites'}</option>
                  {sites.map((site) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
                </select>
              </label>
              <label>Machine *
                <select disabled={loadingCustomer || !customerId} required value={machineId} onChange={(event) => setMachineId(event.target.value)}>
                  <option value="">{visibleMachines.length ? 'Select machine' : 'No active customer machines'}</option>
                  {visibleMachines.map((machine) => <option key={machine.id} value={machine.id}>{machineLabel(machine)}</option>)}
                </select>
                {selectedMachine ? <small className="field-note">Current meter: {selectedMachine.meter_value} {selectedMachine.meter_unit}</small> : null}
              </label>
              <label>Site location<input value={form.siteLocation} onChange={(event) => setForm((current) => ({ ...current, siteLocation: event.target.value }))} /></label>
              <label>Call type
                <select value={form.callType} onChange={(event) => setForm((current) => ({ ...current, callType: event.target.value }))}>
                  {callTypes.map((callType) => <option key={callType}>{callType}</option>)}
                </select>
              </label>
              <label>Call reason<input value={form.callReason} onChange={(event) => setForm((current) => ({ ...current, callReason: event.target.value }))} /></label>
              <label>Category *<input required value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} /></label>
              <label>Sub category<input value={form.subCategory} onChange={(event) => setForm((current) => ({ ...current, subCategory: event.target.value }))} /></label>
              <label>Group 3<input value={form.group3} onChange={(event) => setForm((current) => ({ ...current, group3: event.target.value }))} /></label>
            </div>
          </fieldset>
        </div>

        <div className="call-log-column">
          <fieldset className="call-log-section">
            <legend>Assignment information</legend>
            <div className="call-log-grid call-log-grid-2">
              <label>Assigned to
                <select disabled={loadingTechnicians} value={form.assignedTo} onChange={(event) => setForm((current) => ({ ...current, assignedTo: event.target.value }))}>
                  <option value="">{loadingTechnicians ? 'Loading technicians…' : 'Unassigned'}</option>
                  {visibleTechnicians.map((technician) => <option key={technician.user_id} value={technician.user_id}>{technician.display_name || technician.role} — {technician.branch.toUpperCase()}</option>)}
                </select>
              </label>
              <label>Follow up on *<input type="datetime-local" value={form.followUpAt} onChange={(event) => setForm((current) => ({ ...current, followUpAt: event.target.value }))} /></label>
              <label>WO #<input value={form.workOrderNumber} onChange={(event) => setForm((current) => ({ ...current, workOrderNumber: event.target.value }))} /></label>
              <label>Priority
                <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as ServicePriority }))}>
                  {priorities.map((priority) => <option key={priority}>{priority}</option>)}
                </select>
              </label>
            </div>
            <label>Notes, if any<textarea rows={3} value={form.assignmentNotes} onChange={(event) => setForm((current) => ({ ...current, assignmentNotes: event.target.value }))} /></label>
          </fieldset>

          <fieldset className="call-log-section maintenance-schedule-section">
            <legend>Maintenance schedule</legend>
            <div className="call-log-grid call-log-grid-2">
              <label>Trigger
                <select value={form.triggerType} onChange={(event) => setForm((current) => ({ ...current, triggerType: event.target.value as TriggerType }))}>
                  <option value="calendar">Calendar</option><option value="meter">Meter</option><option value="hybrid">Calendar or meter</option>
                </select>
              </label>
              {form.triggerType !== 'meter' ? <label>Interval days<input min="1" type="number" value={form.intervalDays} onChange={(event) => setForm((current) => ({ ...current, intervalDays: Number(event.target.value) }))} /></label> : null}
              {form.triggerType !== 'calendar' ? <label>Meter interval<input min="1" step="0.01" type="number" value={form.intervalMeter} onChange={(event) => setForm((current) => ({ ...current, intervalMeter: Number(event.target.value) }))} /></label> : null}
              {form.triggerType !== 'calendar' ? <label>First due meter<input min="0" step="0.01" type="number" value={form.nextDueMeter} onChange={(event) => setForm((current) => ({ ...current, nextDueMeter: event.target.value }))} /></label> : null}
              <label>Estimated minutes<input min="1" type="number" value={form.estimatedMinutes} onChange={(event) => setForm((current) => ({ ...current, estimatedMinutes: Number(event.target.value) }))} /></label>
            </div>
            <label>Checklist steps, one per line<textarea rows={5} value={form.checklistText} onChange={(event) => setForm((current) => ({ ...current, checklistText: event.target.value }))} /></label>
            <small className="field-note">Follow up on is the first calendar due date. After work is generated, the ERP advances the date or meter automatically.</small>
          </fieldset>

          <fieldset className="call-log-section call-log-closing-section">
            <legend>Closing information</legend>
            <div className="call-log-grid call-log-grid-2">
              <label>Status<input disabled value="Active maintenance plan" /></label>
              <label>Closed by<input disabled value="Not closed" /></label>
              <label>Closed at<input disabled value="—" /></label>
            </div>
            <label>Remarks<textarea disabled rows={2} value="Entered when the maintenance plan is formally closed." /></label>
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
              <label>Ticket<input value={form.ticketReference} onChange={(event) => setForm((current) => ({ ...current, ticketReference: event.target.value }))} /></label>
              <label>Ticket C. #<input placeholder="Defaults to generated Incident ID" value={form.ticketCaseNumber} onChange={(event) => setForm((current) => ({ ...current, ticketCaseNumber: event.target.value }))} /></label>
              <label>Ref 1 date<input type="date" value={form.referenceDate1} onChange={(event) => setForm((current) => ({ ...current, referenceDate1: event.target.value }))} /></label>
              <label>Ref 2 date<input type="date" value={form.referenceDate2} onChange={(event) => setForm((current) => ({ ...current, referenceDate2: event.target.value }))} /></label>
            </div>
          </fieldset>
        </div>

        <div className="call-log-submit-row call-log-section-wide">
          <div><strong>Incident ID and plan number</strong><span>The ERP generates both identifiers and activates the recurring plan on save.</span></div>
          <button className="button pulse-button" disabled={saving || loadingCustomer || !customerId || !machineId || !form.complaintDetails.trim() || !form.category.trim()} type="submit">
            {saving ? 'Creating maintenance plan…' : loadingCustomer ? 'Loading customer details…' : 'Create maintenance plan'}
          </button>
        </div>
      </form>
    </section>
  );
}
