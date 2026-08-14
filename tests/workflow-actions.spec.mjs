import { expect, test } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseOrigin = 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const authUserId = '10000000-0000-4000-8000-000000000001';
const businessUserId = '20000000-0000-4000-8000-000000000001';
const technicianId = '30000000-0000-4000-8000-000000000001';

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return {
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

function createState() {
  return {
    calls: [],
    serviceJobs: [{
      id: 'service-1',
      job_number: 'SVC-001',
      incident_number: 'INC-001',
      branch: 'jhb',
      customer_id: 'customer-1',
      customer_code_snapshot: 'AC-001',
      customer_name_snapshot: 'Acme Coffee',
      site_id: null,
      machine_id: null,
      assigned_to: null,
      priority: 'high',
      status: 'new',
      summary: 'Boiler not heating',
      description: 'Boiler not heating',
      complaint_details: 'Boiler not heating',
      due_at: null,
      completed_at: null,
      reported_at: '2026-08-14T06:00:00.000Z',
      call_logged_by: businessUserId,
      contact_name: null,
      telephone: null,
      fax: null,
      mobile: null,
      contact_email: null,
      address_snapshot: null,
      service_type: 'Technical',
      service_code: 'TC',
      site_location: null,
      call_type: 'By Phone',
      call_reason: 'Customer request',
      category: 'Customer request',
      sub_category: null,
      group_3: null,
      work_order_number: null,
      assignment_notes: null,
      closed_by: null,
      closed_at: null,
      closing_remarks: null,
      parts_extra: false,
      performance_report_required: false,
      visits_chargeable: false,
      quotation_required: false,
      ticket_reference: null,
      ticket_case_number: null,
      reference_date_1: null,
      reference_date_2: null,
      created_at: '2026-08-14T06:00:00.000Z',
      customers: { customer_name: 'Acme Coffee' },
      machines: null,
    }],
    deliveryOrders: [{
      id: 'delivery-1',
      order_number: 'DLV-001',
      branch: 'jhb',
      customer_name: 'Acme Coffee',
      delivery_address: '1 Main Road',
      status: 'draft',
      created_at: '2026-08-14T06:00:00.000Z',
      dispatched_at: null,
      delivered_at: null,
      closed_at: null,
    }],
    purchaseOrders: [{
      id: 'po-1',
      po_number: 'PO-001',
      supplier_name: 'Coffee Parts SA',
      branch: 'jhb',
      status: 'submitted',
      approval_required: true,
      approval_status: 'pending',
      estimated_total: 12500,
      submitted_at: '2026-08-14T06:00:00.000Z',
      approved_at: null,
      expected_date: '2026-08-20',
      created_at: '2026-08-14T05:00:00.000Z',
    }],
  };
}

function makeToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: authUserId,
    email: 'admin@example.com',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 7200,
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

async function installAuthenticatedSupabaseMock(page, state) {
  const token = makeToken();
  const session = {
    access_token: token,
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    user: {
      id: authUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'admin@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };

  await page.addInitScript((storedSession) => {
    window.localStorage.setItem('dallmayrerp-auth-persistence', 'device');
    window.localStorage.setItem('dallmayrerp-supabase-auth', JSON.stringify(storedSession));
  }, session);

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'OPTIONS') {
      await route.fulfill(jsonResponse(null, 204));
      return;
    }

    let body = null;
    if (method !== 'GET' && method !== 'HEAD') {
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
    }
    state.calls.push({ method, path: url.pathname, body });

    if (url.pathname === '/auth/v1/user') {
      await route.fulfill(jsonResponse(session.user));
      return;
    }
    if (url.pathname.startsWith('/auth/v1/token')) {
      await route.fulfill(jsonResponse(session));
      return;
    }

    if (url.pathname === '/rest/v1/users') {
      await route.fulfill(jsonResponse({
        id: businessUserId,
        auth_user_id: authUserId,
        email: 'admin@example.com',
        is_active: true,
        access_note: null,
        access_updated_by: null,
        access_updated_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }));
      return;
    }
    if (url.pathname === '/rest/v1/user_details') {
      await route.fulfill(jsonResponse({
        id: 'details-1',
        user_id: businessUserId,
        first_name: 'Test',
        last_name: 'Administrator',
        phone_number: '0110000000',
        birthday: '1990-01-01',
        role: 'admin',
        branch: 'national',
        emergency_contact_name: 'Test Contact',
        emergency_contact_phone: '0820000000',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }));
      return;
    }

    if (url.pathname === '/rest/v1/service_jobs') {
      await route.fulfill(jsonResponse(state.serviceJobs));
      return;
    }
    if (url.pathname === '/rest/v1/delivery_orders') {
      await route.fulfill(jsonResponse(state.deliveryOrders));
      return;
    }
    if (url.pathname === '/rest/v1/purchase_orders') {
      await route.fulfill(jsonResponse(state.purchaseOrders));
      return;
    }
    if (url.pathname === '/rest/v1/stock_replenishment_suggestions') {
      await route.fulfill(jsonResponse([]));
      return;
    }
    if (url.pathname === '/rest/v1/customers') {
      await route.fulfill(jsonResponse([{
        id: 'customer-1',
        customer_name: 'Acme Coffee',
        branch: 'jhb',
        customer_code: 'AC-001',
        phone: '0111234567',
        email: 'ops@acme.test',
        address: '1 Main Road',
        status: 'active',
      }]));
      return;
    }
    if (url.pathname === '/rest/v1/customer_sites' || url.pathname === '/rest/v1/machines') {
      await route.fulfill(jsonResponse([]));
      return;
    }
    if (url.pathname === '/rest/v1/warehouses') {
      await route.fulfill(jsonResponse([{ id: 'warehouse-1', branch: 'jhb', warehouse_name: 'JHB Main' }]));
      return;
    }
    if (url.pathname === '/rest/v1/stock_locations') {
      await route.fulfill(jsonResponse([{ id: 'location-1', warehouse_id: 'warehouse-1', location_code: 'A-01', description: 'Main shelf' }]));
      return;
    }

    if (url.pathname === '/rest/v1/rpc/claim_current_app_user') {
      await route.fulfill(jsonResponse(null));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/list_assignable_technicians') {
      await route.fulfill(jsonResponse([{
        user_id: technicianId,
        display_name: 'Tech One',
        role: 'technician',
        branch: 'jhb',
      }]));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/create_service_call_log') {
      const created = {
        ...state.serviceJobs[0],
        id: 'service-created',
        job_number: 'SVC-NEW',
        incident_number: 'INC-NEW',
        customer_name_snapshot: 'Acme Coffee',
        complaint_details: body.p_complaint_details,
        summary: body.p_complaint_details,
        assigned_to: body.p_assigned_to,
        priority: body.p_priority,
        status: body.p_assigned_to ? 'assigned' : 'new',
      };
      state.serviceJobs.unshift(created);
      await route.fulfill(jsonResponse([{ job_number: created.job_number, incident_number: created.incident_number }]));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/assign_service_job') {
      const job = state.serviceJobs.find((item) => item.id === body.job_id);
      if (job) { job.assigned_to = body.assignee_id; if (job.status === 'new') job.status = 'assigned'; }
      await route.fulfill(jsonResponse(null));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/transition_service_job') {
      const job = state.serviceJobs.find((item) => item.id === body.job_id);
      if (job) job.status = body.new_status;
      await route.fulfill(jsonResponse(null));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/transition_delivery_order') {
      const order = state.deliveryOrders.find((item) => item.id === body.order_id);
      if (order) {
        order.status = body.new_status;
        if (body.new_status === 'dispatched') order.dispatched_at = '2026-08-14T07:00:00.000Z';
        if (body.new_status === 'delivered') order.delivered_at = '2026-08-14T08:00:00.000Z';
        if (body.new_status === 'closed') order.closed_at = '2026-08-14T09:00:00.000Z';
      }
      await route.fulfill(jsonResponse(null));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/resolve_stock_barcode') {
      await route.fulfill(jsonResponse([{
        id: 'stock-1',
        stock_name: 'Coffee Beans 1kg',
        item_barcode: 'BEAN-001',
        box_barcode: 'BEAN-BOX',
        matched_unit: 'item',
        item_quantity: 10,
        box_quantity: 2,
        items_per_box: 5,
        reorder_level: 4,
        warehouse_location: 'A-01',
        default_location_id: 'location-1',
        unit_cost: 120,
      }]));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/apply_stock_transaction') {
      await route.fulfill(jsonResponse({ item_quantity: 12, box_quantity: 2 }));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/review_purchase_order') {
      const order = state.purchaseOrders.find((item) => item.id === body.p_purchase_order_id);
      if (order) order.approval_status = body.p_approve ? 'approved' : 'rejected';
      await route.fulfill(jsonResponse(null));
      return;
    }

    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      await route.fulfill(jsonResponse([]));
      return;
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      await route.fulfill(jsonResponse([]));
      return;
    }

    await route.fulfill(jsonResponse({}));
  });
}

function lastRpcCall(state, name) {
  return [...state.calls].reverse().find((call) => call.path === `/rest/v1/rpc/${name}`);
}

test('service workflow creates, assigns and completes a requested service job', async ({ page }) => {
  const state = createState();
  await installAuthenticatedSupabaseMock(page, state);
  await page.goto(`${baseURL}/operations/service-jobs`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Service operations' })).toBeVisible();

  await page.getByText('New service call', { exact: true }).click();
  const customer = page.getByRole('combobox', { name: 'Customer *' });
  await customer.fill('Acme');
  await expect(page.getByRole('option', { name: /Acme Coffee/ })).toBeVisible();
  await page.getByRole('option', { name: /Acme Coffee/ }).click();
  await page.getByLabel('Complaint details *').fill('Group head leaking under load');
  await page.getByRole('button', { name: 'Create requested service call' }).click();
  await expect(page.getByRole('status')).toContainText(/INC-NEW.*SVC-NEW/);
  expect(lastRpcCall(state, 'create_service_call_log')?.body).toMatchObject({
    p_customer_id: 'customer-1',
    p_branch: 'jhb',
    p_complaint_details: 'Group head leaking under load',
  });

  const original = page.locator('.monday-service-job-card').filter({ hasText: 'SVC-001' });
  await original.getByLabel('Technician').selectOption(technicianId);
  await expect.poll(() => state.serviceJobs.find((job) => job.id === 'service-1')?.status).toBe('assigned');
  expect(lastRpcCall(state, 'assign_service_job')?.body).toEqual({ job_id: 'service-1', assignee_id: technicianId });

  await original.getByLabel('Next status').selectOption('in_progress');
  await expect.poll(() => state.serviceJobs.find((job) => job.id === 'service-1')?.status).toBe('in_progress');
  const refreshed = page.locator('.monday-service-job-card').filter({ hasText: 'SVC-001' });
  await refreshed.getByLabel('Next status').selectOption('completed');
  await expect.poll(() => state.serviceJobs.find((job) => job.id === 'service-1')?.status).toBe('completed');
  expect(state.calls.filter((call) => call.path === '/rest/v1/rpc/transition_service_job').map((call) => call.body.new_status)).toEqual(['in_progress', 'completed']);
});

test('delivery workflow advances through picked, dispatched and delivered stages', async ({ page }) => {
  const state = createState();
  await installAuthenticatedSupabaseMock(page, state);
  await page.goto(`${baseURL}/operations/deliveries`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Delivery execution' })).toBeVisible();

  for (const status of ['picked', 'dispatched', 'delivered']) {
    const card = page.locator('article.card').filter({ hasText: 'DLV-001' });
    await card.getByLabel('Next status').selectOption(status);
    await expect.poll(() => state.deliveryOrders[0].status).toBe(status);
  }

  expect(state.calls.filter((call) => call.path === '/rest/v1/rpc/transition_delivery_order').map((call) => call.body.new_status)).toEqual(['picked', 'dispatched', 'delivered']);
  await expect(page.locator('article.card').filter({ hasText: 'DLV-001' })).toContainText(/Delivered/);
});

test('stock workflow resolves a barcode and posts an audited receipt payload', async ({ page }) => {
  const state = createState();
  await installAuthenticatedSupabaseMock(page, state);
  await page.goto(`${baseURL}/warehouse/stock`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Scan and transact stock' })).toBeVisible();

  await page.getByLabel('Manual code entry').fill('BEAN-001');
  await expect(page.getByText(/Coffee Beans 1kg found/)).toBeVisible();
  await page.getByLabel('Quantity').fill('2');
  await page.getByLabel('Reference').fill('PO-TEST-001');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByText(/New balance: 12 item\(s\), 2 box\(es\)/)).toBeVisible();

  expect(lastRpcCall(state, 'apply_stock_transaction')?.body).toMatchObject({
    p_stock_item_id: 'stock-1',
    p_movement_type: 'received',
    p_quantity: 2,
    p_quantity_unit: 'item',
    p_branch: 'jhb',
    p_destination_location_id: 'location-1',
    p_reference_type: 'manual',
    p_barcode: 'BEAN-001',
  });
});

test('purchase approval workflow records reviewer notes and approval intent', async ({ page }) => {
  const state = createState();
  await installAuthenticatedSupabaseMock(page, state);
  await page.goto(`${baseURL}/warehouse/purchasing/approvals`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Purchase approvals' })).toBeVisible();

  const order = page.locator('.minimal-list-item').filter({ hasText: 'PO-001' });
  await order.getByLabel('Review note').fill('Budget and supplier lead time confirmed');
  await order.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('PO-001 approved.')).toBeVisible();

  expect(lastRpcCall(state, 'review_purchase_order')?.body).toEqual({
    p_purchase_order_id: 'po-1',
    p_approve: true,
    p_notes: 'Budget and supplier lead time confirmed',
  });
  assertApprovalState(state);
});

function assertApprovalState(state) {
  expect(state.purchaseOrders[0].approval_status).toBe('approved');
}
