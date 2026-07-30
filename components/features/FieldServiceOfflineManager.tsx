'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  FIELD_QUEUE_CHANGED_EVENT,
  type FieldOutcome,
  type FieldQueueItem,
  type FieldTaskType,
  enqueueFieldCompletion,
  getFieldDraft,
  listFieldQueue,
  removeFieldDraft,
  removeFieldQueueItem,
  resetFailedFieldQueue,
  saveFieldDraft,
  updateFieldQueueItem,
} from '@/lib/offline/field-service-queue';
import { getSupabaseClient } from '@/lib/supabase/client';

const MOBILE_QUERY = '(max-width: 760px)';
const validOutcomes = new Set<FieldOutcome>(['completed', 'follow_up_required', 'parts_required', 'customer_unavailable']);

function taskTypeForPath(pathname: string): FieldTaskType {
  return pathname.startsWith('/road-tech') ? 'road_technician' : 'technician';
}

function cleanJobNumber(value: string | null | undefined) {
  return value?.replace(/^Complete\s+/i, '').replace(/\s+/g, ' ').trim() ?? '';
}

function jobNumberFromCard(card: Element | null) {
  return cleanJobNumber(card?.querySelector<HTMLElement>('.field-job-card-top strong')?.textContent);
}

function jobNumberFromForm(form: HTMLFormElement) {
  const workspace = form.closest('.field-execution');
  return cleanJobNumber(workspace?.querySelector<HTMLElement>('.field-execution-header h2')?.textContent);
}

function readDraftValues(form: HTMLFormElement) {
  const machineCode = form.querySelector<HTMLInputElement>('.live-scanner-box input:not([type="file"])')?.value.trim() ?? '';
  const selectedOutcome = form.querySelector<HTMLInputElement>('input[name="outcome"]:checked')?.value ?? 'completed';
  const outcome = validOutcomes.has(selectedOutcome as FieldOutcome) ? selectedOutcome as FieldOutcome : 'completed';
  const notes = form.querySelector<HTMLTextAreaElement>('.field-textarea-label textarea')?.value ?? '';
  return { machineCode, outcome, notes };
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function formatQueuedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Queued on this device';
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The queued field update could not be synchronized.';
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function FieldServiceOfflineManager() {
  const pathname = usePathname();
  const { businessUser, userDetails } = useAuth();
  const fieldRole = userDetails?.role === 'technician' || userDetails?.role === 'road_technician';
  const userId = businessUser?.id ?? '';
  const taskType = taskTypeForPath(pathname);
  const [online, setOnline] = useState(true);
  const [items, setItems] = useState<FieldQueueItem[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const syncingRef = useRef(false);
  const draftTimerRef = useRef<number | null>(null);
  const queuedJobNumbersRef = useRef(new Set<string>());
  const lastOnlineSubmissionRef = useRef('');

  const refreshQueue = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    try {
      const next = await listFieldQueue(userId);
      queuedJobNumbersRef.current = new Set(next.map((item) => item.jobNumber.toUpperCase()));
      setItems(next);
    } catch (error) {
      setToast(errorMessage(error));
    }
  }, [userId]);

  const markQueuedCards = useCallback(() => {
    document.querySelectorAll<HTMLElement>('.field-job-card').forEach((card) => {
      const jobNumber = jobNumberFromCard(card).toUpperCase();
      const queued = queuedJobNumbersRef.current.has(jobNumber);
      if (queued) {
        card.dataset.offlineQueued = 'true';
        card.setAttribute('aria-disabled', 'true');
      } else {
        delete card.dataset.offlineQueued;
        card.removeAttribute('aria-disabled');
      }
    });
  }, []);

  const synchronize = useCallback(async (includeFailed = false) => {
    if (!userId || syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;

    try {
      const queue = await listFieldQueue(userId);
      const candidates = queue.filter((item) => includeFailed || item.status !== 'failed');
      const client = getSupabaseClient();

      for (const item of candidates) {
        if (!navigator.onLine) break;
        await updateFieldQueueItem(item.id, { status: 'syncing', lastError: null });
        let uploadedPath: string | null = null;

        try {
          const { data: job, error: jobError } = await client
            .from('service_jobs')
            .select('id, job_number')
            .eq('assigned_to', userId)
            .eq('job_number', item.jobNumber)
            .in('status', ['assigned', 'in_progress'])
            .limit(1)
            .maybeSingle();

          if (jobError) throw jobError;
          if (!job) throw new Error('This job is no longer assigned, is already completed, or is outside your access scope.');

          if (item.photo) {
            const fileName = safeFileName(item.photoName ?? `closure-${item.jobNumber}.jpg`);
            uploadedPath = `${item.taskType}/${userId}/${job.id}/${Date.now()}-${fileName}`;
            const { error: uploadError } = await client.storage
              .from('dallmayrerp-task-photos')
              .upload(uploadedPath, item.photo, {
                contentType: item.photoType || item.photo.type || undefined,
                upsert: false,
              });
            if (uploadError) throw uploadError;
          }

          const { error: completionError } = await client.rpc('complete_assigned_service_job', {
            p_service_job_id: job.id,
            p_machine_code: item.machineCode,
            p_outcome: item.outcome,
            p_notes: item.notes.trim() || null,
            p_photo_bucket: uploadedPath ? 'dallmayrerp-task-photos' : null,
            p_photo_path: uploadedPath,
          });

          if (completionError) throw completionError;
          await removeFieldQueueItem(item.id);
          await removeFieldDraft(userId, item.jobNumber);
          setToast(`${item.jobNumber} synchronized successfully.`);
          document.querySelector<HTMLButtonElement>('.field-queue-refresh')?.click();
        } catch (error) {
          if (uploadedPath) {
            try {
              await client.storage.from('dallmayrerp-task-photos').remove([uploadedPath]);
            } catch {
              // The queue retains the original item and will report the primary synchronization error.
            }
          }
          if (!navigator.onLine) {
            await updateFieldQueueItem(item.id, { status: 'pending', lastError: 'Waiting for a connection.' });
            break;
          }
          await updateFieldQueueItem(item.id, { status: 'failed', lastError: errorMessage(error) });
        }
      }
    } catch (error) {
      setToast(errorMessage(error));
    } finally {
      syncingRef.current = false;
      await refreshQueue();
    }
  }, [refreshQueue, userId]);

  useEffect(() => {
    if (!fieldRole) return;
    const updateConnectivity = () => setOnline(navigator.onLine);
    updateConnectivity();
    void refreshQueue();

    const handleQueueChange = () => void refreshQueue();
    const handleOnline = () => {
      setOnline(true);
      void synchronize(false);
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener(FIELD_QUEUE_CHANGED_EVENT, handleQueueChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener(FIELD_QUEUE_CHANGED_EVENT, handleQueueChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fieldRole, refreshQueue, synchronize]);

  useEffect(() => {
    if (!fieldRole || !userId || !online || items.length === 0 || items.every((item) => item.status === 'failed')) return;
    void synchronize(false);
  }, [fieldRole, items, online, synchronize, userId]);

  useEffect(() => {
    if (!fieldRole || !userId) return;
    const media = window.matchMedia(MOBILE_QUERY);

    function scheduleDraftSave(form: HTMLFormElement) {
      if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = window.setTimeout(() => {
        const jobNumber = jobNumberFromForm(form);
        if (!jobNumber || queuedJobNumbersRef.current.has(jobNumber.toUpperCase())) return;
        const values = readDraftValues(form);
        if (!values.machineCode && !values.notes && values.outcome === 'completed') {
          void removeFieldDraft(userId, jobNumber).catch((error) => setToast(errorMessage(error)));
          return;
        }
        void saveFieldDraft({ userId, jobNumber, taskType, ...values }).catch((error) => setToast(errorMessage(error)));
      }, 350);
    }

    function handleFieldChange(event: Event) {
      if (!media.matches || !(event.target instanceof Element)) return;
      const form = event.target.closest<HTMLFormElement>('.field-completion-form');
      if (form) scheduleDraftSave(form);
    }

    function handleFieldClick(event: MouseEvent) {
      if (!media.matches || !(event.target instanceof Element)) return;
      const card = event.target.closest<HTMLElement>('.field-job-card');
      if (!card) return;
      const jobNumber = jobNumberFromCard(card);
      if (!jobNumber) return;

      if (queuedJobNumbersRef.current.has(jobNumber.toUpperCase())) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setToast(`${jobNumber} is already queued and will synchronize when online.`);
        return;
      }

      window.setTimeout(() => {
        void getFieldDraft(userId, jobNumber).then((draft) => {
          if (!draft) return;
          const form = document.querySelector<HTMLFormElement>('.field-completion-form');
          if (!form || jobNumberFromForm(form).toUpperCase() !== jobNumber.toUpperCase()) return;
          const machineInput = form.querySelector<HTMLInputElement>('.live-scanner-box input:not([type="file"])');
          const notesInput = form.querySelector<HTMLTextAreaElement>('.field-textarea-label textarea');
          if (machineInput) setNativeValue(machineInput, draft.machineCode);
          if (notesInput) setNativeValue(notesInput, draft.notes);
          form.querySelector<HTMLInputElement>(`input[name="outcome"][value="${draft.outcome}"]`)?.click();
          setToast(`Draft restored for ${jobNumber}.`);
        }).catch((error) => setToast(errorMessage(error)));
      }, 180);
    }

    function handleSubmit(event: Event) {
      if (!media.matches || !(event.target instanceof HTMLFormElement) || !event.target.matches('.field-completion-form')) return;
      const form = event.target;
      const jobNumber = jobNumberFromForm(form);
      if (!jobNumber) return;

      if (navigator.onLine) {
        lastOnlineSubmissionRef.current = jobNumber;
        return;
      }

      const submitButton = form.querySelector<HTMLButtonElement>('.field-submit-bar button[type="submit"]');
      if (submitButton?.disabled) return;
      const values = readDraftValues(form);
      const photoInput = form.querySelector<HTMLInputElement>('.field-photo-input input[type="file"]');
      const photo = photoInput?.files?.[0] ?? null;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      void enqueueFieldCompletion({
        userId,
        jobNumber,
        taskType,
        ...values,
        photo,
        photoName: photo?.name ?? null,
        photoType: photo?.type ?? null,
      }).then(async () => {
        await removeFieldDraft(userId, jobNumber);
        await refreshQueue();
        markQueuedCards();
        setToast(`${jobNumber} saved on this device. It will submit when connectivity returns.`);
        window.setTimeout(() => document.querySelector<HTMLButtonElement>('.mobile-workflow-back')?.click(), 80);
      }).catch((error) => setToast(errorMessage(error)));
    }

    const observer = new MutationObserver(() => {
      markQueuedCards();
      const success = document.querySelector<HTMLElement>('.field-service-workspace > .success');
      const submittedJob = lastOnlineSubmissionRef.current;
      if (success && submittedJob) {
        lastOnlineSubmissionRef.current = '';
        void removeFieldDraft(userId, submittedJob).catch((error) => setToast(errorMessage(error)));
      }
    });

    document.addEventListener('input', handleFieldChange, true);
    document.addEventListener('change', handleFieldChange, true);
    document.addEventListener('click', handleFieldClick, true);
    document.addEventListener('submit', handleSubmit, true);
    observer.observe(document.body, { childList: true, subtree: true });
    markQueuedCards();

    return () => {
      if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current);
      document.removeEventListener('input', handleFieldChange, true);
      document.removeEventListener('change', handleFieldChange, true);
      document.removeEventListener('click', handleFieldClick, true);
      document.removeEventListener('submit', handleSubmit, true);
      observer.disconnect();
    };
  }, [fieldRole, markQueuedCards, refreshQueue, taskType, userId]);

  useEffect(() => {
    markQueuedCards();
  }, [items, markQueuedCards, pathname]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const counts = useMemo(() => ({
    syncing: items.filter((item) => item.status === 'syncing').length,
    failed: items.filter((item) => item.status === 'failed').length,
  }), [items]);

  if (!fieldRole) return null;

  const indicatorLabel = !online
    ? `Offline${items.length ? ` · ${items.length} queued` : ''}`
    : counts.syncing
      ? `Synchronizing ${counts.syncing}`
      : counts.failed
        ? `${counts.failed} sync failed`
        : items.length
          ? `${items.length} waiting to sync`
          : 'Online';

  async function retryAll() {
    if (!userId) return;
    try {
      await resetFailedFieldQueue(userId);
      await refreshQueue();
      await synchronize(true);
    } catch (error) {
      setToast(errorMessage(error));
    }
  }

  return (
    <>
      <button
        aria-expanded={open}
        className={`field-offline-indicator ${online ? 'is-online' : 'is-offline'} ${counts.failed ? 'has-failure' : ''}`}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span aria-hidden="true" />
        <strong>{indicatorLabel}</strong>
      </button>

      {toast ? <div aria-live="polite" className="field-offline-toast" role="status">{toast}</div> : null}

      {open ? (
        <>
          <button aria-label="Close offline work queue" className="field-offline-backdrop" onClick={() => setOpen(false)} type="button" />
          <div aria-labelledby="field-offline-title" aria-modal="true" className="field-offline-sheet" ref={panelRef} role="dialog">
            <header>
              <div><span>Field work</span><h2 id="field-offline-title">Offline queue</h2><p>Validated completions remain on this device until the signed-in session can submit them.</p></div>
              <button aria-label="Close offline queue" onClick={() => setOpen(false)} ref={closeButtonRef} type="button">×</button>
            </header>

            <div className={`field-connectivity-state ${online ? 'is-online' : 'is-offline'}`}>
              <strong>{online ? 'Connected' : 'No connection'}</strong>
              <span>{online ? 'Pending work can synchronize now.' : 'You can continue capturing validated field work.'}</span>
            </div>

            {items.length === 0 ? (
              <div className="field-offline-empty"><strong>No queued completions</strong><p>Text drafts are restored automatically when you reopen a job.</p></div>
            ) : (
              <div className="field-offline-list">
                {items.map((item) => (
                  <article className={`field-offline-item status-${item.status}`} key={item.id}>
                    <div><span>{item.status.replace(/_/g, ' ')}</span><h3>{item.jobNumber}</h3><p>{formatQueuedAt(item.createdAt)}</p></div>
                    {item.lastError ? <div className="field-offline-error" role="alert">{item.lastError}</div> : null}
                    <dl><div><dt>Outcome</dt><dd>{item.outcome.replace(/_/g, ' ')}</dd></div><div><dt>Evidence</dt><dd>{item.photo ? item.photoName ?? 'Photo attached' : 'No photo'}</dd></div></dl>
                    <button className="button secondary" disabled={item.status === 'syncing'} onClick={() => void removeFieldQueueItem(item.id).then(refreshQueue)} type="button">Remove from device</button>
                  </article>
                ))}
              </div>
            )}

            <footer>
              <button className="button" disabled={!online || !items.length || counts.syncing > 0} onClick={() => void retryAll()} type="button">
                {counts.syncing ? 'Synchronizing…' : counts.failed ? 'Retry all' : 'Synchronize now'}
              </button>
              <button className="button secondary" onClick={() => setOpen(false)} type="button">Close</button>
            </footer>
          </div>
        </>
      ) : null}
    </>
  );
}
