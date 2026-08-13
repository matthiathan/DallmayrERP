'use client';

export type FieldTaskType = 'technician' | 'road_technician';
export type FieldOutcome = 'completed' | 'follow_up_required' | 'parts_required' | 'customer_unavailable';
export type FieldQueueStatus = 'pending' | 'syncing' | 'failed';

export type FieldWorkDraft = {
  id: string;
  userId: string;
  jobNumber: string;
  taskType: FieldTaskType;
  machineCode: string;
  outcome: FieldOutcome;
  notes: string;
  updatedAt: string;
};

export type FieldQueueItem = {
  id: string;
  userId: string;
  jobNumber: string;
  taskType: FieldTaskType;
  machineCode: string;
  outcome: FieldOutcome;
  notes: string;
  photo: Blob | null;
  photoName: string | null;
  photoType: string | null;
  createdAt: string;
  updatedAt: string;
  status: FieldQueueStatus;
  lastError: string | null;
};

const DATABASE_NAME = 'dallmayrerp-field-work-v1';
const DATABASE_VERSION = 1;
const DRAFT_STORE = 'drafts';
const QUEUE_STORE = 'queue';
export const FIELD_QUEUE_CHANGED_EVENT = 'dallmayr-field-queue-changed';

let databasePromise: Promise<IDBDatabase> | null = null;

function requireBrowser() {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    throw new Error('Offline field work is not supported by this browser.');
  }
}

function clearDatabaseReference(database?: IDBDatabase) {
  if (database) database.close();
  databasePromise = null;
}

function openDatabase() {
  requireBrowser();
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      databasePromise = null;
      reject(error);
    };

    request.onerror = () => fail(request.error ?? new Error('The offline field-work database could not be opened.'));
    request.onblocked = () => fail(new Error('The offline field-work database is blocked by another open DallmayrERP tab. Close the other tab and try again.'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        const drafts = database.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
        drafts.createIndex('userId', 'userId', { unique: false });
      }
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        const queue = database.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        queue.createIndex('userId', 'userId', { unique: false });
        queue.createIndex('status', 'status', { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => clearDatabaseReference(database);
      resolve(database);
    };
  });

  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The offline field-work operation failed.'));
  });
}

function transactionResult(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('The offline field-work transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('The offline field-work transaction was cancelled.'));
  });
}

async function executeStoreRequest<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, mode);
  const completion = transactionResult(transaction);
  const result = await requestResult(action(transaction.objectStore(storeName)));
  await completion;
  return result;
}

async function storeRequest<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  try {
    return await executeStoreRequest(storeName, mode, action);
  } catch (error) {
    if (error instanceof DOMException && ['InvalidStateError', 'TransactionInactiveError', 'AbortError'].includes(error.name)) {
      clearDatabaseReference();
      return executeStoreRequest(storeName, mode, action);
    }
    throw error;
  }
}

function recordId(userId: string, jobNumber: string) {
  return `${userId}:${jobNumber.trim().toUpperCase()}`;
}

export function announceFieldQueueChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FIELD_QUEUE_CHANGED_EVENT));
}

export async function saveFieldDraft(input: Omit<FieldWorkDraft, 'id' | 'updatedAt'>) {
  const draft: FieldWorkDraft = {
    ...input,
    id: recordId(input.userId, input.jobNumber),
    updatedAt: new Date().toISOString(),
  };
  await storeRequest(DRAFT_STORE, 'readwrite', (store) => store.put(draft));
  return draft;
}

export async function getFieldDraft(userId: string, jobNumber: string) {
  return storeRequest<FieldWorkDraft | undefined>(DRAFT_STORE, 'readonly', (store) => store.get(recordId(userId, jobNumber)));
}

export async function removeFieldDraft(userId: string, jobNumber: string) {
  await storeRequest(DRAFT_STORE, 'readwrite', (store) => store.delete(recordId(userId, jobNumber)));
}

export async function enqueueFieldCompletion(input: Omit<FieldQueueItem, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'lastError'>) {
  const now = new Date().toISOString();
  const id = recordId(input.userId, input.jobNumber);
  const existing = await storeRequest<FieldQueueItem | undefined>(QUEUE_STORE, 'readonly', (store) => store.get(id));
  const item: FieldQueueItem = {
    ...input,
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: 'pending',
    lastError: null,
  };
  await storeRequest(QUEUE_STORE, 'readwrite', (store) => store.put(item));
  announceFieldQueueChange();
  return item;
}

export async function listFieldQueue(userId: string) {
  const items = await storeRequest<FieldQueueItem[]>(QUEUE_STORE, 'readonly', (store) => store.getAll());
  return items
    .filter((item) => item.userId === userId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function updateFieldQueueItem(id: string, changes: Partial<Pick<FieldQueueItem, 'status' | 'lastError'>>) {
  const current = await storeRequest<FieldQueueItem | undefined>(QUEUE_STORE, 'readonly', (store) => store.get(id));
  if (!current) return null;
  const next: FieldQueueItem = {
    ...current,
    ...changes,
    updatedAt: new Date().toISOString(),
  };
  await storeRequest(QUEUE_STORE, 'readwrite', (store) => store.put(next));
  announceFieldQueueChange();
  return next;
}

export async function removeFieldQueueItem(id: string) {
  await storeRequest(QUEUE_STORE, 'readwrite', (store) => store.delete(id));
  announceFieldQueueChange();
}

export async function resetFailedFieldQueue(userId: string) {
  const items = await listFieldQueue(userId);
  await Promise.all(items
    .filter((item) => item.status === 'failed')
    .map((item) => updateFieldQueueItem(item.id, { status: 'pending', lastError: null })));
  announceFieldQueueChange();
}
