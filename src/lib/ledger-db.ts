import type { Settings, Transaction } from "@/types";

export type SyncStatus = "synced" | "pending" | "conflict";
export type LocalTransaction = Transaction & { syncStatus: SyncStatus };
export type QueueAction =
  | "add_transaction"
  | "update_transaction"
  | "delete_transaction"
  | "update_settings";

export interface SyncOperation {
  id: string;
  action: QueueAction;
  transactionId?: string;
  data: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  conflict?: boolean;
  remoteTransaction?: Transaction | null;
}

export interface LedgerSnapshot {
  transactions: LocalTransaction[];
  settings: Settings;
  pendingCount: number;
  conflictCount: number;
  conflicts: SyncOperation[];
}

const DATABASE_NAME = "my-ledger";
const DATABASE_VERSION = 1;
const TRANSACTIONS = "transactions";
const QUEUE = "syncQueue";
const META = "meta";
const CHANGE_EVENT = "my-ledger-change";
const DEFAULT_SETTINGS: Settings = {
  opening_balance: 0,
  currency: "PKR",
  app_name: "My Ledger",
  theme: "system",
};

let databasePromise: Promise<IDBDatabase> | undefined;
let channel: BroadcastChannel | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Local storage is unavailable in this browser"));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(TRANSACTIONS)) {
        database.createObjectStore(TRANSACTIONS, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(QUEUE)) {
        const queue = database.createObjectStore(QUEUE, { keyPath: "id" });
        queue.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains(META)) {
        database.createObjectStore(META, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error || new Error("Unable to open local ledger storage"));
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error("Close other My Ledger tabs to update local storage"));
    };
  });
  return databasePromise;
}

function emitChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    channel ??= new BroadcastChannel(DATABASE_NAME);
    channel.postMessage("changed");
  }
}

function queueOperation(
  action: QueueAction,
  data: Record<string, unknown>,
  transactionId?: string,
): SyncOperation {
  return {
    id: crypto.randomUUID(),
    action,
    transactionId,
    data,
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Local database request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Local database transaction was aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("Local database transaction failed"));
  });
}

export async function readSnapshot(): Promise<LedgerSnapshot> {
  const database = await openDatabase();
  const transaction = database.transaction([TRANSACTIONS, QUEUE, META], "readonly");
  const localTransactions = await requestResult(
    transaction.objectStore(TRANSACTIONS).getAll() as IDBRequest<LocalTransaction[]>,
  );
  const queue = await requestResult(
    transaction.objectStore(QUEUE).getAll() as IDBRequest<SyncOperation[]>,
  );
  const settingsRecord = await requestResult(
    transaction.objectStore(META).get("settings") as IDBRequest<{ key: string; value: Settings } | undefined>,
  );
  await transactionDone(transaction);
  const transactions = localTransactions
    .filter((item) => !item.deleted)
    .sort((left, right) => Date.parse(right.transaction_date) - Date.parse(left.transaction_date));
  return {
    transactions,
    settings: settingsRecord?.value || DEFAULT_SETTINGS,
    pendingCount: queue.filter((operation) => !operation.conflict).length,
    conflictCount: queue.filter((operation) => operation.conflict).length,
    conflicts: queue.filter((operation) => operation.conflict),
  };
}

export async function saveTransaction(
  transaction: Transaction,
  action: "add_transaction" | "update_transaction",
): Promise<void> {
  const database = await openDatabase();
  const dbTransaction = database.transaction([TRANSACTIONS, QUEUE], "readwrite");
  const transactions = dbTransaction.objectStore(TRANSACTIONS);
  const queue = dbTransaction.objectStore(QUEUE);

  if (action === "update_transaction") {
    const existing = (await requestResult(
      transactions.get(transaction.id) as IDBRequest<LocalTransaction | undefined>,
    ));
    if (!existing) throw new Error("This transaction is no longer available on this device");
    if (existing.deleted) throw new Error("This transaction is already queued for deletion");

    const pendingAdd = await findQueued(queue, transaction.id, "add_transaction");
    if (pendingAdd) {
      pendingAdd.data = { ...transaction };
      queue.put(pendingAdd);
    } else {
      const pendingUpdate = await findQueued(queue, transaction.id, "update_transaction");
      if (pendingUpdate) {
        pendingUpdate.data = {
          ...transaction,
          expected_updated_at: pendingUpdate.data.expected_updated_at,
        };
        queue.put(pendingUpdate);
      } else {
        queue.put(queueOperation(
          "update_transaction",
          { ...transaction, expected_updated_at: existing.updated_at },
          transaction.id,
        ));
      }
    }
  } else {
    queue.put(queueOperation("add_transaction", { ...transaction }, transaction.id));
  }

  transactions.put({ ...transaction, syncStatus: "pending" } satisfies LocalTransaction);
  await transactionDone(dbTransaction);
  emitChange();
}

export async function deleteTransactionLocally(id: string): Promise<void> {
  const database = await openDatabase();
  const dbTransaction = database.transaction([TRANSACTIONS, QUEUE], "readwrite");
  const transactions = dbTransaction.objectStore(TRANSACTIONS);
  const queue = dbTransaction.objectStore(QUEUE);
  const existing = await requestResult(transactions.get(id) as IDBRequest<LocalTransaction | undefined>);
  if (!existing) throw new Error("This transaction is no longer available on this device");

  const pendingAdd = await findQueued(queue, id, "add_transaction");
  if (pendingAdd) {
    queue.delete(pendingAdd.id);
    for (const operation of await requestResult(queue.getAll() as IDBRequest<SyncOperation[]>)) {
      if (operation.transactionId === id) queue.delete(operation.id);
    }
    transactions.delete(id);
  } else {
    const pendingDelete = await findQueued(queue, id, "delete_transaction");
    if (!pendingDelete) {
      queue.put(queueOperation(
        "delete_transaction",
        { id, expected_updated_at: existing.updated_at },
        id,
      ));
    }
    transactions.put({ ...existing, deleted: true, syncStatus: "pending" });
  }

  await transactionDone(dbTransaction);
  emitChange();
}

export async function saveSettingsLocally(settings: Settings): Promise<void> {
  const database = await openDatabase();
  const dbTransaction = database.transaction([META, QUEUE], "readwrite");
  const meta = dbTransaction.objectStore(META);
  const queue = dbTransaction.objectStore(QUEUE);
  const oldSettings = await requestResult(
    meta.get("settings") as IDBRequest<{ key: string; value: Settings } | undefined>,
  );
  const existing = await requestResult(queue.getAll() as IDBRequest<SyncOperation[]>);
  const pendingSettings = existing.find((operation) => operation.action === "update_settings");
  if (pendingSettings) {
    pendingSettings.data = { ...settings };
    queue.put(pendingSettings);
  } else {
    queue.put(queueOperation("update_settings", {
      ...settings,
      expected_settings: oldSettings?.value || DEFAULT_SETTINGS,
    }));
  }
  meta.put({ key: "settings", value: settings });
  await transactionDone(dbTransaction);
  emitChange();
}

async function findQueued(
  store: IDBObjectStore,
  transactionId: string,
  action: QueueAction,
): Promise<SyncOperation | undefined> {
  const operations = await requestResult(store.getAll() as IDBRequest<SyncOperation[]>);
  return operations.find((operation) => operation.transactionId === transactionId && operation.action === action);
}

export async function pendingOperations(): Promise<SyncOperation[]> {
  const database = await openDatabase();
  const transaction = database.transaction(QUEUE, "readonly");
  const operations = await requestResult(
    transaction.objectStore(QUEUE).getAll() as IDBRequest<SyncOperation[]>,
  );
  await transactionDone(transaction);
  return operations.sort((left, right) => left.createdAt - right.createdAt);
}

export async function markOperationSynced(
  operation: SyncOperation,
  responseData: unknown,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([TRANSACTIONS, QUEUE, META], "readwrite");
  const queue = transaction.objectStore(QUEUE);
  const transactions = transaction.objectStore(TRANSACTIONS);
  const meta = transaction.objectStore(META);
  const storedOperation = await requestResult(queue.get(operation.id) as IDBRequest<SyncOperation | undefined>);
  const response = responseData as {
    transaction?: Partial<Transaction>;
    settings?: Settings;
  } | null;
  const changedWhileSending = Boolean(
    storedOperation && JSON.stringify(storedOperation.data) !== JSON.stringify(operation.data),
  );
  if (!changedWhileSending) {
    queue.delete(operation.id);
  } else if (storedOperation && operation.action === "add_transaction" && response?.transaction?.updated_at) {
    queue.put({
      ...storedOperation,
      action: "update_transaction",
      data: { ...storedOperation.data, expected_updated_at: response.transaction.updated_at },
      attempts: 0,
      nextAttemptAt: 0,
      lastError: undefined,
    });
  } else if (storedOperation && response?.transaction?.updated_at && "expected_updated_at" in storedOperation.data) {
    queue.put({
      ...storedOperation,
      data: { ...storedOperation.data, expected_updated_at: response.transaction.updated_at },
      attempts: 0,
      nextAttemptAt: 0,
      lastError: undefined,
    });
  }

  const remaining = await requestResult(queue.getAll() as IDBRequest<SyncOperation[]>);
  const stillPending = remaining.some((item) => item.transactionId === operation.transactionId);
  if (operation.transactionId) {
    const local = await requestResult(
      transactions.get(operation.transactionId) as IDBRequest<LocalTransaction | undefined>,
    );
    if (local) {
      const remote = response?.transaction;
      if (remote?.updated_at) {
        for (const pending of remaining) {
          if (pending.transactionId !== operation.transactionId) continue;
          const expected = { ...pending.data };
          if ("expected_updated_at" in expected) {
            expected.expected_updated_at = remote.updated_at;
            queue.put({ ...pending, data: expected });
          }
        }
      }
      transactions.put({
        ...local,
        ...(changedWhileSending ? { updated_at: remote?.updated_at || local.updated_at } : remote || {}),
        syncStatus: stillPending ? "pending" : "synced",
      } satisfies LocalTransaction);
    }
  }
  if (operation.action === "update_settings" && response && !changedWhileSending) {
    const remoteSettings = response.settings || response as unknown as Settings;
    if (typeof remoteSettings.opening_balance === "number") {
      meta.put({ key: "settings", value: remoteSettings });
    }
  }
  await transactionDone(transaction);
  emitChange();
}

export async function markOperationFailed(
  operation: SyncOperation,
  message: string,
  conflict = false,
  remoteTransaction: Transaction | null = null,
): Promise<number> {
  const database = await openDatabase();
  const transaction = database.transaction([TRANSACTIONS, QUEUE], "readwrite");
  const queue = transaction.objectStore(QUEUE);
  const stored = await requestResult(queue.get(operation.id) as IDBRequest<SyncOperation | undefined>);
  const attempts = (stored?.attempts || 0) + 1;
  const delay = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempts - 1, 8));
  queue.put({
    ...(stored || operation),
    attempts,
    nextAttemptAt: conflict ? Number.MAX_SAFE_INTEGER : Date.now() + delay,
    lastError: message,
    conflict,
    remoteTransaction: conflict ? remoteTransaction : undefined,
  } satisfies SyncOperation);
  if (operation.transactionId) {
    const local = await requestResult(
      transaction.objectStore(TRANSACTIONS).get(operation.transactionId) as IDBRequest<LocalTransaction | undefined>,
    );
    if (local) transaction.objectStore(TRANSACTIONS).put({
      ...local,
      syncStatus: conflict ? "conflict" : "pending",
    } satisfies LocalTransaction);
  }
  await transactionDone(transaction);
  emitChange();
  return delay;
}

export async function resolveTransactionConflict(
  operationId: string,
  keepLocal: boolean,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([TRANSACTIONS, QUEUE], "readwrite");
  const transactions = transaction.objectStore(TRANSACTIONS);
  const queue = transaction.objectStore(QUEUE);
  const operation = await requestResult(queue.get(operationId) as IDBRequest<SyncOperation | undefined>);
  if (!operation?.transactionId) throw new Error("Sync conflict is no longer available");
  const transactionId = operation.transactionId;
  const queued = await requestResult(queue.getAll() as IDBRequest<SyncOperation[]>);
  const forTransaction = queued.filter((item) => item.transactionId === transactionId);
  const local = await requestResult(transactions.get(transactionId) as IDBRequest<LocalTransaction | undefined>);
  if (!local) throw new Error("Local transaction is no longer available");

  if (!keepLocal) {
    for (const item of forTransaction) queue.delete(item.id);
    if (operation.remoteTransaction) {
      transactions.put({ ...operation.remoteTransaction, syncStatus: "synced" } satisfies LocalTransaction);
    } else {
      transactions.delete(transactionId);
    }
  } else if (operation.action === "add_transaction" || !operation.remoteTransaction) {
    for (const item of forTransaction) queue.delete(item.id);
    transactions.delete(transactionId);
    const newTransaction: Transaction = {
      ...local,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted: false,
    };
    transactions.put({ ...newTransaction, syncStatus: "pending" } satisfies LocalTransaction);
    queue.put(queueOperation("add_transaction", { ...newTransaction }, newTransaction.id));
  } else {
    for (const item of forTransaction) {
      const data = { ...item.data };
      if ("expected_updated_at" in data) data.expected_updated_at = operation.remoteTransaction.updated_at;
      queue.put({ ...item, data, conflict: false, lastError: undefined, attempts: 0, nextAttemptAt: 0 });
    }
    transactions.put({ ...local, syncStatus: "pending" } satisfies LocalTransaction);
  }

  await transactionDone(transaction);
  emitChange();
}

export async function mergeRemoteSnapshot(
  remoteTransactions: Transaction[],
  settings: Settings,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([TRANSACTIONS, QUEUE, META], "readwrite");
  const transactionStore = transaction.objectStore(TRANSACTIONS);
  const queueStore = transaction.objectStore(QUEUE);
  const [localTransactions, queue] = await Promise.all([
    requestResult(transactionStore.getAll() as IDBRequest<LocalTransaction[]>),
    requestResult(queueStore.getAll() as IDBRequest<SyncOperation[]>),
  ]);
  const pendingIds = new Set(queue.map((operation) => operation.transactionId).filter(Boolean));
  for (const local of localTransactions) {
    if (!pendingIds.has(local.id)) transactionStore.delete(local.id);
  }
  for (const remote of remoteTransactions) {
    if (!pendingIds.has(remote.id)) {
      transactionStore.put({ ...remote, syncStatus: "synced" } satisfies LocalTransaction);
    }
  }
  if (!queue.some((operation) => operation.action === "update_settings")) {
    transaction.objectStore(META).put({ key: "settings", value: settings });
  }
  await transactionDone(transaction);
  emitChange();
}

export function calculateDashboard(snapshot: LedgerSnapshot, todayKey?: string) {
  const active = snapshot.transactions.filter((transaction) => !transaction.deleted);
  let balanceCents = Math.round(snapshot.settings.opening_balance * 100);
  let incomeToday = 0;
  let expenseToday = 0;
  let expenseMonth = 0;
  const monthKey = todayKey?.slice(0, 7);
  for (const transaction of active) {
    const cents = Math.round(transaction.amount * 100);
    const sign = transaction.type === "income" ? 1 : -1;
    balanceCents += sign * cents;
    const date = new Date(transaction.transaction_date);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (todayKey && dateKey === todayKey) {
      if (transaction.type === "income") incomeToday += cents;
      else expenseToday += cents;
    }
    if (monthKey && dateKey.slice(0, 7) === monthKey && transaction.type === "expense") expenseMonth += cents;
  }
  return {
    balance: balanceCents / 100,
    opening_balance: snapshot.settings.opening_balance,
    income_today: incomeToday / 100,
    expense_today: expenseToday / 100,
    expense_month: expenseMonth / 100,
    recent_transactions: active.slice(0, 10),
    settings: snapshot.settings,
  };
}

export function subscribeToLedgerChanges(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onChange = () => listener();
  window.addEventListener(CHANGE_EVENT, onChange);
  channel ??= typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(DATABASE_NAME) : undefined;
  if (channel) channel.addEventListener("message", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    channel?.removeEventListener("message", onChange);
  };
}
