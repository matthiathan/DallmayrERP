(() => {
  'use strict';

  const config = window.__DALLMAYRERP_NATIVE_CONFIG__ ?? {};
  const supabaseUrl = typeof config.supabaseUrl === 'string' ? config.supabaseUrl.replace(/\/+$/, '') : '';
  const anonKey = typeof config.anonKey === 'string' ? config.anonKey.trim() : '';
  const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
  const SESSION_KEY = 'dallmayrerp-field-session-v1';
  const PROFILE_KEY = 'dallmayrerp-field-profile-v1';
  const DB_NAME = 'dallmayrerp-field-v1';
  const DB_VERSION = 1;
  const ACTIVE_STATUSES = new Set(['assigned', 'in_progress']);
  const HIGH_PRIORITIES = new Set(['high', 'critical', 'urgent']);
  const ALLOWED_ROLES = new Set(['technician', 'road_technician']);

  const state = {
    session: null,
    profile: null,
    jobs: [],
    selectedJobId: '',
    filter: 'all',
    scanner: null,
    scannerActive: false,
    syncing: false,
  };

  const dom = {
    authView: document.getElementById('authView'),
    workspaceView: document.getElementById('workspaceView'),
    runtimeMessage: document.getElementById('runtimeMessage'),
    workspaceMessage: document.getElementById('workspaceMessage'),
    connectionBadge: document.getElementById('connectionBadge'),
    syncBadge: document.getElementById('syncBadge'),
    loginForm: document.getElementById('loginForm'),
    loginButton: document.getElementById('loginButton'),
    emailInput: document.getElementById('emailInput'),
    passwordInput: document.getElementById('passwordInput'),
    userName: document.getElementById('userName'),
    userContext: document.getElementById('userContext'),
    refreshButton: document.getElementById('refreshButton'),
    syncButton: document.getElementById('syncButton'),
    signOutButton: document.getElementById('signOutButton'),
    metricOpen: document.getElementById('metricOpen'),
    metricOverdue: document.getElementById('metricOverdue'),
    metricProgress: document.getElementById('metricProgress'),
    metricPending: document.getElementById('metricPending'),
    cacheStatus: document.getElementById('cacheStatus'),
    queueFilters: document.getElementById('queueFilters'),
    jobList: document.getElementById('jobList'),
    emptySelection: document.getElementById('emptySelection'),
    closureForm: document.getElementById('closureForm'),
    jobHeading: document.getElementById('jobHeading'),
    jobSummary: document.getElementById('jobSummary'),
    jobDetails: document.getElementById('jobDetails'),
    startScanButton: document.getElementById('startScanButton'),
    stopScanButton: document.getElementById('stopScanButton'),
    machineCodeInput: document.getElementById('machineCodeInput'),
    scanPhotoInput: document.getElementById('scanPhotoInput'),
    machineMatch: document.getElementById('machineMatch'),
    notesInput: document.getElementById('notesInput'),
    closurePhotoInput: document.getElementById('closurePhotoInput'),
    photoMeta: document.getElementById('photoMeta'),
    submitState: document.getElementById('submitState'),
    completeButton: document.getElementById('completeButton'),
    pendingList: document.getElementById('pendingList'),
  };

  function setMessage(target, message, type = 'info') {
    if (!target) return;
    target.textContent = message || '';
    target.className = message ? `message ${type === 'info' ? '' : type}`.trim() : 'message hidden';
  }

  function setBusy(button, busy, busyLabel, readyLabel) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : readyLabel;
  }

  function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normaliseCode(value) {
    return cleanText(value).replace(/^\uFEFF/, '').toLowerCase();
  }

  function isNetworkError(error) {
    return !navigator.onLine || error instanceof TypeError || /network|failed to fetch|load failed/i.test(String(error?.message ?? error ?? ''));
  }

  function readJsonStorage(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeJsonStorage(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function clearStorage(key) {
    window.localStorage.removeItem(key);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('jobCaches')) db.createObjectStore('jobCaches', { keyPath: 'userId' });
        if (!db.objectStoreNames.contains('closures')) db.createObjectStore('closures', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open the field offline store.'));
    });
  }

  async function dbOperation(storeName, mode, operation) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let request;
      try {
        request = operation(store);
      } catch (error) {
        db.close();
        reject(error);
        return;
      }
      transaction.oncomplete = () => {
        db.close();
        resolve(request?.result);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? request?.error ?? new Error('Offline store operation failed.'));
      };
      transaction.onabort = transaction.onerror;
    });
  }

  const dbPut = (storeName, value) => dbOperation(storeName, 'readwrite', (store) => store.put(value));
  const dbGet = (storeName, key) => dbOperation(storeName, 'readonly', (store) => store.get(key));
  const dbDelete = (storeName, key) => dbOperation(storeName, 'readwrite', (store) => store.delete(key));
  const dbGetAll = (storeName) => dbOperation(storeName, 'readonly', (store) => store.getAll());

  function saveSession(sessionPayload) {
    const session = {
      accessToken: sessionPayload.access_token,
      refreshToken: sessionPayload.refresh_token,
      expiresAt: Date.now() + Number(sessionPayload.expires_in ?? 3600) * 1000,
      user: sessionPayload.user ?? state.session?.user ?? null,
    };
    state.session = session;
    writeJsonStorage(SESSION_KEY, session);
    return session;
  }

  async function authRequest(path, body) {
    const response = await fetch(`${supabaseUrl}${path}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error_description || payload.msg || payload.message || `Authentication failed (${response.status}).`);
    return payload;
  }

  async function signIn(email, password) {
    return saveSession(await authRequest('/auth/v1/token?grant_type=password', { email, password }));
  }

  async function refreshSession() {
    if (!state.session?.refreshToken) throw new Error('Your saved session cannot be refreshed. Sign in again.');
    return saveSession(await authRequest('/auth/v1/token?grant_type=refresh_token', { refresh_token: state.session.refreshToken }));
  }

  async function ensureAccessToken() {
    if (!state.session?.accessToken) throw new Error('Sign in to continue.');
    if (state.session.expiresAt > Date.now() + 60_000) return state.session.accessToken;
    if (!navigator.onLine) return state.session.accessToken;
    const refreshed = await refreshSession();
    return refreshed.accessToken;
  }

  async function apiFetch(path, options = {}, retry = true) {
    const accessToken = await ensureAccessToken();
    const headers = new Headers(options.headers ?? {});
    headers.set('apikey', anonKey);
    headers.set('Authorization', `Bearer ${accessToken}`);
    const response = await fetch(`${supabaseUrl}${path}`, { ...options, headers });
    if (response.status === 401 && retry && state.session?.refreshToken) {
      await refreshSession();
      return apiFetch(path, options, false);
    }
    return response;
  }

  async function responseError(response, fallback) {
    const payload = await response.json().catch(() => ({}));
    return new Error(payload.message || payload.error_description || payload.error || `${fallback} (${response.status}).`);
  }

  async function postJson(path, body) {
    const response = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await responseError(response, 'Request failed');
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  }

  async function getRows(table, params) {
    const response = await apiFetch(`/rest/v1/${table}?${params.toString()}`);
    if (!response.ok) throw await responseError(response, `Could not load ${table}`);
    return response.json();
  }

  async function loadOnlineProfile() {
    await postJson('/rest/v1/rpc/claim_current_app_user', {});
    const authUserId = state.session?.user?.id;
    if (!authUserId) throw new Error('The Supabase session does not contain a user identifier.');

    const userParams = new URLSearchParams({
      select: 'id,email,is_active,access_note,auth_user_id',
      auth_user_id: `eq.${authUserId}`,
      limit: '1',
    });
    const users = await getRows('users', userParams);
    const businessUser = users[0];
    if (!businessUser) throw new Error('No DallmayrERP access record is linked to this account.');
    if (businessUser.is_active === false) throw new Error('This DallmayrERP account has been suspended.');

    const detailParams = new URLSearchParams({
      select: 'user_id,role,branch,first_name,last_name',
      user_id: `eq.${businessUser.id}`,
      limit: '1',
    });
    const detailsRows = await getRows('user_details', detailParams);
    const details = detailsRows[0];
    if (!details) throw new Error('No role and branch assignment was found for this account.');
    if (!ALLOWED_ROLES.has(details.role)) throw new Error('This Android field client is limited to technician and road-technician accounts.');

    const profile = {
      authUserId,
      businessUser,
      details,
      lastAuthorizedAt: Date.now(),
    };
    state.profile = profile;
    writeJsonStorage(PROFILE_KEY, profile);
    return profile;
  }

  function loadOfflineProfile() {
    const profile = readJsonStorage(PROFILE_KEY);
    if (!profile || profile.authUserId !== state.session?.user?.id) return null;
    if (!profile.lastAuthorizedAt || Date.now() - profile.lastAuthorizedAt > PROFILE_TTL_MS) return null;
    if (!ALLOWED_ROLES.has(profile.details?.role) || profile.businessUser?.is_active === false) return null;
    state.profile = profile;
    return profile;
  }

  function profileName() {
    const details = state.profile?.details;
    const fullName = [details?.first_name, details?.last_name].map(cleanText).filter(Boolean).join(' ');
    return fullName || state.profile?.businessUser?.email || 'Field technician';
  }

  function selectedJob() {
    return state.jobs.find((job) => job.id === state.selectedJobId) ?? null;
  }

  function firstRelation(value) {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }

  function machineCodes(job) {
    const machine = firstRelation(job?.machines);
    if (!machine) return [];
    return [machine.machine_barcode, machine.serial_number, machine.asset_tag].map(normaliseCode).filter(Boolean);
  }

  function machineMatches(job, code) {
    const clean = normaliseCode(code);
    return Boolean(clean && machineCodes(job).includes(clean));
  }

  function isOverdue(job) {
    const due = job?.due_at ? new Date(job.due_at).getTime() : NaN;
    return Number.isFinite(due) && due < Date.now();
  }

  function isHighPriority(job) {
    return HIGH_PRIORITIES.has(normaliseCode(job?.priority));
  }

  function formatDate(value) {
    if (!value) return 'No due date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Due date unavailable';
    return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function roleLabel(role) {
    return role === 'road_technician' ? 'Road Technician' : 'Technician';
  }

  async function cacheJobs(jobs) {
    if (!state.profile?.businessUser?.id) return;
    await dbPut('jobCaches', {
      userId: state.profile.businessUser.id,
      updatedAt: Date.now(),
      jobs,
    });
  }

  async function loadCachedJobs() {
    if (!state.profile?.businessUser?.id) return null;
    const cached = await dbGet('jobCaches', state.profile.businessUser.id);
    if (!cached?.jobs) return null;
    state.jobs = cached.jobs;
    dom.cacheStatus.textContent = `Offline cache from ${new Date(cached.updatedAt).toLocaleString('en-ZA')}`;
    return cached;
  }

  async function loadOnlineJobs() {
    const userId = state.profile?.businessUser?.id;
    if (!userId) throw new Error('No business user is available.');
    const params = new URLSearchParams({
      select: 'id,job_number,incident_number,branch,status,priority,summary,complaint_details,due_at,customer_name_snapshot,address_snapshot,customer_id,site_id,machine_id,customers(customer_name,address),customer_sites(site_name,address),machines(id,branch,machine_name,model,serial_number,machine_barcode,asset_tag,status)',
      assigned_to: `eq.${userId}`,
      status: 'in.(assigned,in_progress)',
      order: 'due_at.asc.nullslast',
      limit: '100',
    });
    const jobs = await getRows('service_jobs', params);
    state.jobs = jobs;
    await cacheJobs(jobs);
    dom.cacheStatus.textContent = `Live queue refreshed ${new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`;
    return jobs;
  }

  async function refreshJobs({ quiet = false } = {}) {
    if (!state.profile) return;
    dom.refreshButton.disabled = true;
    try {
      if (!navigator.onLine) {
        const cached = await loadCachedJobs();
        if (!cached && !quiet) setMessage(dom.workspaceMessage, 'No cached jobs are available yet. Connect once and refresh the queue before going offline.', 'warning');
      } else {
        try {
          await loadOnlineJobs();
          if (!quiet) setMessage(dom.workspaceMessage, 'Assigned jobs refreshed and cached for offline field use.', 'success');
        } catch (error) {
          if (!isNetworkError(error)) throw error;
          const cached = await loadCachedJobs();
          if (!cached) throw error;
          if (!quiet) setMessage(dom.workspaceMessage, 'Connectivity dropped during refresh. Showing the last cached field queue.', 'warning');
        }
      }
      if (state.selectedJobId && !state.jobs.some((job) => job.id === state.selectedJobId)) state.selectedJobId = '';
      renderWorkspace();
    } catch (error) {
      if (!quiet) setMessage(dom.workspaceMessage, error.message || 'Could not load assigned jobs.', 'error');
    } finally {
      dom.refreshButton.disabled = false;
    }
  }

  async function pendingClosures() {
    const userId = state.profile?.businessUser?.id;
    const all = await dbGetAll('closures');
    return (all ?? [])
      .filter((closure) => closure.userId === userId)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  async function updatePendingMetrics() {
    const closures = await pendingClosures();
    const pending = closures.filter((closure) => closure.syncState !== 'synced').length;
    dom.metricPending.textContent = String(pending);
    dom.syncBadge.textContent = `${pending} pending`;
    dom.syncBadge.className = `status-badge ${pending ? 'offline' : 'muted'}`;
    renderPendingList(closures);
    return closures;
  }

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderJobList() {
    dom.jobList.replaceChildren();
    const filtered = state.jobs.filter((job) => {
      if (state.filter === 'overdue') return isOverdue(job);
      if (state.filter === 'in_progress') return job.status === 'in_progress';
      if (state.filter === 'high_priority') return isHighPriority(job);
      return true;
    });

    if (!filtered.length) {
      const empty = makeElement('p', 'pending-empty', state.jobs.length ? 'No jobs match this filter.' : 'No assigned or in-progress jobs are cached.');
      dom.jobList.append(empty);
      return;
    }

    filtered.forEach((job) => {
      const machine = firstRelation(job.machines);
      const customer = firstRelation(job.customers);
      const site = firstRelation(job.customer_sites);
      const button = makeElement('button', `job-card${job.id === state.selectedJobId ? ' selected' : ''}${isOverdue(job) ? ' overdue' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', job.id === state.selectedJobId ? 'true' : 'false');
      button.addEventListener('click', () => selectJob(job.id));

      const top = makeElement('div', 'job-card-top');
      const number = makeElement('strong', '', job.job_number || 'Service job');
      const status = makeElement('span', 'job-state', String(job.status || '').replace(/_/g, ' '));
      top.append(number, status);

      const title = makeElement('span', 'job-card-title', job.summary || 'Service work');
      const location = makeElement(
        'span',
        'job-card-location',
        `${job.customer_name_snapshot || customer?.customer_name || 'Customer not set'} · ${site?.site_name || site?.address || job.address_snapshot || customer?.address || 'Site not set'}`,
      );
      const machineName = makeElement(
        'span',
        'job-card-machine',
        machine?.machine_name || machine?.model || machine?.serial_number || machine?.machine_barcode || 'Machine not linked',
      );
      const meta = makeElement('div', 'job-card-meta');
      meta.append(makeElement('span', '', formatDate(job.due_at)), makeElement('span', '', `${job.priority || 'normal'} priority`));
      button.append(top, title, location, machineName, meta);
      dom.jobList.append(button);
    });
  }

  function appendDetail(label, value) {
    const wrapper = makeElement('div');
    wrapper.append(makeElement('dt', '', label), makeElement('dd', '', value));
    dom.jobDetails.append(wrapper);
  }

  function renderSelectedJob() {
    const job = selectedJob();
    dom.emptySelection.classList.toggle('hidden', Boolean(job));
    dom.closureForm.classList.toggle('hidden', !job);
    if (!job) return;

    const machine = firstRelation(job.machines);
    const customer = firstRelation(job.customers);
    const site = firstRelation(job.customer_sites);
    dom.jobHeading.textContent = `Complete ${job.job_number || 'service job'}`;
    dom.jobSummary.textContent = job.complaint_details || job.summary || 'No complaint details were captured.';
    dom.jobDetails.replaceChildren();
    appendDetail('Customer', job.customer_name_snapshot || customer?.customer_name || 'Customer not set');
    appendDetail('Site', site?.site_name || site?.address || job.address_snapshot || customer?.address || 'Site not set');
    appendDetail('Machine', machine?.machine_name || machine?.model || machine?.serial_number || machine?.machine_barcode || 'Machine not linked');
    appendDetail('Due', formatDate(job.due_at));
    appendDetail('Priority', job.priority || 'normal');
    appendDetail('Branch', String(job.branch || '').toUpperCase() || 'Not set');
    updateMachineMatch();
  }

  function renderMetrics() {
    dom.metricOpen.textContent = String(state.jobs.length);
    dom.metricOverdue.textContent = String(state.jobs.filter(isOverdue).length);
    dom.metricProgress.textContent = String(state.jobs.filter((job) => job.status === 'in_progress').length);
  }

  function renderWorkspace() {
    renderMetrics();
    renderJobList();
    renderSelectedJob();
    void updatePendingMetrics();
  }

  function selectJob(jobId) {
    state.selectedJobId = jobId;
    dom.machineCodeInput.value = '';
    dom.notesInput.value = '';
    dom.closurePhotoInput.value = '';
    dom.photoMeta.classList.add('hidden');
    dom.photoMeta.textContent = '';
    const completed = document.querySelector('input[name="outcome"][value="completed"]');
    if (completed) completed.checked = true;
    void stopScanner();
    renderWorkspace();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateMachineMatch() {
    const job = selectedJob();
    const hasMachine = Boolean(firstRelation(job?.machines));
    const codes = machineCodes(job);
    const value = dom.machineCodeInput.value;
    const matches = machineMatches(job, value);

    dom.machineMatch.className = 'match-state';
    if (!job || !hasMachine) {
      dom.machineMatch.textContent = 'This job has no linked machine. Operations must correct the assignment before closure.';
      dom.machineMatch.classList.add('mismatch');
    } else if (!codes.length) {
      dom.machineMatch.textContent = 'The linked machine has no barcode, serial number or asset tag. Operations must update the machine record.';
      dom.machineMatch.classList.add('mismatch');
    } else if (!cleanText(value)) {
      dom.machineMatch.textContent = 'Waiting for a machine scan.';
    } else if (matches) {
      dom.machineMatch.textContent = 'Machine verified. The closure can be saved.';
      dom.machineMatch.classList.add('match');
    } else {
      dom.machineMatch.textContent = 'This code does not match the assigned machine. Check the machine and scan again.';
      dom.machineMatch.classList.add('mismatch');
    }

    dom.completeButton.disabled = !matches;
    dom.submitState.textContent = matches ? 'Ready to save on this device' : 'Machine verification required';
  }

  function acceptedScan(rawValue) {
    const clean = cleanText(rawValue).replace(/^\uFEFF/, '');
    if (!clean) return;
    dom.machineCodeInput.value = clean;
    updateMachineMatch();
  }

  async function stopScanner() {
    if (!state.scanner) {
      state.scannerActive = false;
      dom.stopScanButton.disabled = true;
      dom.startScanButton.disabled = false;
      return;
    }
    try {
      if (state.scannerActive) await state.scanner.stop();
    } catch {
      // Scanner may already be stopped by the WebView.
    }
    try {
      await state.scanner.clear();
    } catch {
      // Ignore cleanup errors after WebView camera teardown.
    }
    state.scanner = null;
    state.scannerActive = false;
    dom.stopScanButton.disabled = true;
    dom.startScanButton.disabled = false;
  }

  async function startScanner() {
    if (state.scannerActive) return;
    if (!window.Html5Qrcode) {
      setMessage(dom.workspaceMessage, 'The packaged barcode scanner is unavailable. Run npm run mobile:prepare before building the Android app.', 'error');
      return;
    }
    dom.startScanButton.disabled = true;
    try {
      const formats = window.Html5QrcodeSupportedFormats;
      const formatList = formats
        ? [formats.QR_CODE, formats.CODE_39, formats.CODE_93, formats.CODE_128, formats.EAN_13, formats.EAN_8, formats.UPC_A, formats.UPC_E, formats.DATA_MATRIX, formats.PDF_417]
        : undefined;
      state.scanner = new window.Html5Qrcode('reader', { formatsToSupport: formatList, verbose: false });
      await state.scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (width, height) => ({
            width: Math.min(Math.floor(width * 0.9), 520),
            height: Math.min(Math.floor(height * 0.45), 240),
          }),
          aspectRatio: 1.777778,
          disableFlip: true,
        },
        async (decodedText) => {
          acceptedScan(decodedText);
          await stopScanner();
        },
        () => undefined,
      );
      state.scannerActive = true;
      dom.stopScanButton.disabled = false;
      setMessage(dom.workspaceMessage, 'Camera active. Scan the machine assigned to this job.', 'info');
    } catch (error) {
      await stopScanner();
      setMessage(dom.workspaceMessage, error.message || 'The camera scanner could not start. Use manual entry or scan from a photo.', 'error');
    }
  }

  async function scanPhoto(file) {
    if (!file) return;
    if (!window.Html5Qrcode) {
      setMessage(dom.workspaceMessage, 'The packaged barcode scanner is unavailable.', 'error');
      return;
    }
    await stopScanner();
    try {
      state.scanner = new window.Html5Qrcode('reader', { verbose: false });
      const decoded = await state.scanner.scanFile(file, false);
      acceptedScan(decoded);
      await state.scanner.clear();
      state.scanner = null;
      setMessage(dom.workspaceMessage, 'Machine code read from the selected photo.', 'success');
    } catch (error) {
      state.scanner = null;
      setMessage(dom.workspaceMessage, error.message || 'No supported barcode was found in that photo.', 'warning');
    } finally {
      dom.scanPhotoInput.value = '';
    }
  }

  function randomId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function queueClosure() {
    const job = selectedJob();
    if (!job || !state.profile?.businessUser?.id) throw new Error('Select an assigned job first.');
    const code = cleanText(dom.machineCodeInput.value);
    if (!machineMatches(job, code)) throw new Error('The machine must be verified before the closure can be saved.');

    const photo = dom.closurePhotoInput.files?.[0] ?? null;
    const outcome = document.querySelector('input[name="outcome"]:checked')?.value || 'completed';
    const closure = {
      id: randomId(),
      userId: state.profile.businessUser.id,
      jobId: job.id,
      jobNumber: job.job_number,
      taskType: state.profile.details.role === 'road_technician' ? 'road_technician' : 'technician',
      machineCode: code,
      outcome,
      notes: cleanText(dom.notesInput.value) || null,
      photoBlob: photo ?? null,
      photoName: photo?.name ?? null,
      photoType: photo?.type || 'image/jpeg',
      createdAt: Date.now(),
      syncState: 'pending',
      attempts: 0,
      lastError: null,
    };
    await dbPut('closures', closure);

    state.jobs = state.jobs.filter((candidate) => candidate.id !== job.id);
    state.selectedJobId = '';
    await cacheJobs(state.jobs);
    dom.machineCodeInput.value = '';
    dom.notesInput.value = '';
    dom.closurePhotoInput.value = '';
    dom.photoMeta.classList.add('hidden');
    await stopScanner();
    renderWorkspace();
    return closure;
  }

  function safeFileName(value) {
    return cleanText(value || 'closure.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  async function serverJob(jobId) {
    const params = new URLSearchParams({
      select: 'id,status,assigned_to',
      id: `eq.${jobId}`,
      limit: '1',
    });
    const rows = await getRows('service_jobs', params);
    return rows[0] ?? null;
  }

  async function uploadClosurePhoto(closure) {
    if (!closure.photoBlob) return null;
    const path = `${closure.taskType}/${closure.userId}/${closure.jobId}/${closure.id}-${safeFileName(closure.photoName)}`;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await apiFetch(`/storage/v1/object/dallmayrerp-task-photos/${encodedPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': closure.photoType || 'image/jpeg',
        'x-upsert': 'false',
      },
      body: closure.photoBlob,
    });
    if (!response.ok && response.status !== 409) throw await responseError(response, 'Closure photo upload failed');
    return path;
  }

  async function syncClosure(closure) {
    if (!navigator.onLine) return false;
    const liveJob = await serverJob(closure.jobId);
    if (!liveJob) {
      closure.syncState = 'needs_review';
      closure.lastError = 'The server job is no longer visible to this account. Review the assignment before retrying.';
      closure.attempts += 1;
      await dbPut('closures', closure);
      return false;
    }
    if (liveJob.assigned_to !== closure.userId || !ACTIVE_STATUSES.has(liveJob.status)) {
      closure.syncState = 'needs_review';
      closure.lastError = `The server job is now ${liveJob.status || 'unavailable'} or assigned to another user.`;
      closure.attempts += 1;
      await dbPut('closures', closure);
      return false;
    }

    try {
      const photoPath = await uploadClosurePhoto(closure);
      await postJson('/rest/v1/rpc/complete_assigned_service_job', {
        p_service_job_id: closure.jobId,
        p_machine_code: closure.machineCode,
        p_outcome: closure.outcome,
        p_notes: closure.notes,
        p_photo_bucket: photoPath ? 'dallmayrerp-task-photos' : null,
        p_photo_path: photoPath,
      });
      await dbDelete('closures', closure.id);
      return true;
    } catch (error) {
      if (isNetworkError(error)) {
        closure.syncState = 'pending';
        closure.lastError = 'Connectivity was lost during sync. The closure remains safely queued.';
      } else {
        closure.syncState = 'needs_review';
        closure.lastError = error.message || 'The server rejected this closure.';
      }
      closure.attempts += 1;
      await dbPut('closures', closure);
      return false;
    }
  }

  async function syncQueue({ includeReview = false, quiet = false } = {}) {
    if (!state.profile || state.syncing) return;
    if (!navigator.onLine) {
      if (!quiet) setMessage(dom.workspaceMessage, 'Offline. Pending closures will sync automatically when connectivity returns.', 'warning');
      return;
    }
    state.syncing = true;
    setBusy(dom.syncButton, true, 'Syncing…', 'Sync pending');
    try {
      const closures = await pendingClosures();
      const candidates = closures.filter((closure) => closure.syncState === 'pending' || (includeReview && closure.syncState === 'needs_review'));
      let synced = 0;
      for (const closure of candidates) {
        if (includeReview && closure.syncState === 'needs_review') {
          closure.syncState = 'pending';
          closure.lastError = null;
          await dbPut('closures', closure);
        }
        if (await syncClosure(closure)) synced += 1;
        if (!navigator.onLine) break;
      }
      await updatePendingMetrics();
      if (synced > 0) await refreshJobs({ quiet: true });
      if (!quiet) {
        if (synced > 0) setMessage(dom.workspaceMessage, `${synced} queued closure${synced === 1 ? '' : 's'} synced successfully.`, 'success');
        else if (candidates.length > 0) setMessage(dom.workspaceMessage, 'Pending closure sync needs review. See the offline outbox for details.', 'warning');
        else setMessage(dom.workspaceMessage, 'No pending closures need syncing.', 'info');
      }
    } catch (error) {
      if (!quiet) setMessage(dom.workspaceMessage, error.message || 'Pending closure sync failed.', isNetworkError(error) ? 'warning' : 'error');
    } finally {
      state.syncing = false;
      setBusy(dom.syncButton, false, 'Syncing…', 'Sync pending');
      updateConnectionState();
    }
  }

  function renderPendingList(closures) {
    dom.pendingList.replaceChildren();
    if (!closures.length) {
      dom.pendingList.append(makeElement('p', 'pending-empty', 'No closures are waiting on this device.'));
      return;
    }
    closures.forEach((closure) => {
      const item = makeElement('article', `pending-item ${closure.syncState || 'pending'}`);
      const copy = makeElement('div');
      copy.append(
        makeElement('strong', '', `${closure.jobNumber || 'Service job'} · ${closure.syncState === 'needs_review' ? 'Needs review' : 'Pending sync'}`),
        makeElement('p', '', closure.lastError || `Saved ${new Date(closure.createdAt).toLocaleString('en-ZA')} · ${closure.outcome.replace(/_/g, ' ')}`),
      );
      item.append(copy);
      if (closure.syncState === 'needs_review') {
        const retry = makeElement('button', 'button secondary', 'Retry');
        retry.type = 'button';
        retry.disabled = !navigator.onLine;
        retry.addEventListener('click', async () => {
          closure.syncState = 'pending';
          closure.lastError = null;
          await dbPut('closures', closure);
          await syncQueue({ quiet: false });
        });
        item.append(retry);
      }
      dom.pendingList.append(item);
    });
  }

  function updateConnectionState() {
    const online = navigator.onLine;
    dom.connectionBadge.textContent = online ? 'Online' : 'Offline';
    dom.connectionBadge.className = `status-badge ${online ? 'online' : 'offline'}`;
    dom.refreshButton.disabled = !state.profile;
    dom.syncButton.disabled = !state.profile || !online || state.syncing;
  }

  async function enterWorkspace(profile, { offline = false } = {}) {
    state.profile = profile;
    dom.authView.classList.add('hidden');
    dom.workspaceView.classList.remove('hidden');
    dom.userName.textContent = profileName();
    dom.userContext.textContent = `${roleLabel(profile.details.role)} · ${String(profile.details.branch || '').toUpperCase()} branch${offline ? ' · offline authorization cache' : ''}`;
    setMessage(dom.runtimeMessage, '', 'info');
    updateConnectionState();

    if (offline) {
      const cached = await loadCachedJobs();
      if (!cached) setMessage(dom.workspaceMessage, 'You are offline and this device has no cached job queue yet.', 'warning');
      renderWorkspace();
      return;
    }

    await refreshJobs({ quiet: true });
    await syncQueue({ quiet: true });
  }

  async function initialiseAuthenticatedState() {
    state.session = readJsonStorage(SESSION_KEY);
    if (!state.session?.accessToken || !state.session?.user?.id) return false;

    if (!navigator.onLine) {
      const cached = loadOfflineProfile();
      if (!cached) return false;
      await enterWorkspace(cached, { offline: true });
      return true;
    }

    try {
      const profile = await loadOnlineProfile();
      await enterWorkspace(profile);
      return true;
    } catch (error) {
      if (isNetworkError(error)) {
        const cached = loadOfflineProfile();
        if (cached) {
          await enterWorkspace(cached, { offline: true });
          return true;
        }
      }
      clearStorage(SESSION_KEY);
      state.session = null;
      setMessage(dom.runtimeMessage, error.message || 'Your saved field session could not be restored. Sign in again.', 'warning');
      return false;
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (!supabaseUrl || !anonKey || anonKey.includes('__DALLMAYRERP')) return;
    setBusy(dom.loginButton, true, 'Signing in…', 'Sign in');
    setMessage(dom.runtimeMessage, '', 'info');
    try {
      await signIn(cleanText(dom.emailInput.value), dom.passwordInput.value);
      const profile = await loadOnlineProfile();
      dom.passwordInput.value = '';
      await enterWorkspace(profile);
    } catch (error) {
      setMessage(dom.runtimeMessage, error.message || 'Sign in failed.', isNetworkError(error) ? 'warning' : 'error');
    } finally {
      setBusy(dom.loginButton, false, 'Signing in…', 'Sign in');
    }
  }

  async function handleSignOut() {
    const closures = await pendingClosures();
    if (closures.length) {
      setMessage(dom.workspaceMessage, 'Sync or resolve pending closures before signing out so field evidence is not stranded on this device.', 'warning');
      return;
    }
    await stopScanner();
    if (state.profile?.businessUser?.id) await dbDelete('jobCaches', state.profile.businessUser.id);
    clearStorage(SESSION_KEY);
    clearStorage(PROFILE_KEY);
    state.session = null;
    state.profile = null;
    state.jobs = [];
    state.selectedJobId = '';
    dom.workspaceView.classList.add('hidden');
    dom.authView.classList.remove('hidden');
    setMessage(dom.workspaceMessage, '', 'info');
  }

  async function handleClosureSubmit(event) {
    event.preventDefault();
    dom.completeButton.disabled = true;
    try {
      const closure = await queueClosure();
      setMessage(
        dom.workspaceMessage,
        navigator.onLine
          ? `${closure.jobNumber} saved safely on this device. Syncing with DallmayrERP now.`
          : `${closure.jobNumber} saved offline. It will sync automatically when connectivity returns.`,
        navigator.onLine ? 'success' : 'warning',
      );
      if (navigator.onLine) await syncQueue({ quiet: true });
    } catch (error) {
      setMessage(dom.workspaceMessage, error.message || 'The closure could not be saved on this device.', 'error');
      updateMachineMatch();
    }
  }

  function bindEvents() {
    dom.loginForm.addEventListener('submit', handleLogin);
    dom.refreshButton.addEventListener('click', () => refreshJobs());
    dom.syncButton.addEventListener('click', () => syncQueue({ includeReview: false }));
    dom.signOutButton.addEventListener('click', handleSignOut);
    dom.machineCodeInput.addEventListener('input', updateMachineMatch);
    dom.startScanButton.addEventListener('click', startScanner);
    dom.stopScanButton.addEventListener('click', stopScanner);
    dom.scanPhotoInput.addEventListener('change', (event) => scanPhoto(event.target.files?.[0] ?? null));
    dom.closurePhotoInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0] ?? null;
      dom.photoMeta.textContent = file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB will be stored in the offline outbox until sync.` : '';
      dom.photoMeta.classList.toggle('hidden', !file);
    });
    dom.closureForm.addEventListener('submit', handleClosureSubmit);
    dom.queueFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      state.filter = button.dataset.filter || 'all';
      dom.queueFilters.querySelectorAll('[data-filter]').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
      renderJobList();
    });
    window.addEventListener('online', async () => {
      updateConnectionState();
      if (state.profile) {
        setMessage(dom.workspaceMessage, 'Connectivity restored. Syncing the offline outbox and refreshing assigned work.', 'success');
        await syncQueue({ quiet: true });
        await refreshJobs({ quiet: true });
      }
    });
    window.addEventListener('offline', () => {
      updateConnectionState();
      if (state.profile) setMessage(dom.workspaceMessage, 'Offline mode active. Cached jobs, scanning and local closure capture remain available.', 'warning');
    });
    window.addEventListener('beforeunload', () => {
      void stopScanner();
    });
  }

  async function main() {
    bindEvents();
    updateConnectionState();

    if (!supabaseUrl || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) || !anonKey || anonKey.includes('__DALLMAYRERP')) {
      dom.loginButton.disabled = true;
      setMessage(dom.runtimeMessage, 'Native runtime configuration is missing. Set NEXT_PUBLIC_SUPABASE_ANON_KEY and run npm run mobile:prepare before syncing the Android project.', 'error');
      return;
    }

    const restored = await initialiseAuthenticatedState();
    if (!restored) {
      dom.authView.classList.remove('hidden');
      dom.workspaceView.classList.add('hidden');
    }
  }

  void main();
})();
