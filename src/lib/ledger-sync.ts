import { apiRequest } from "@/lib/api";
import {
  markOperationFailed,
  markOperationSynced,
  mergeRemoteSnapshot,
  pendingOperations,
} from "@/lib/ledger-db";
import type { Settings, Transaction } from "@/types";

export interface SyncState {
  online: boolean;
  syncing: boolean;
  lastError: string | null;
}

const STATE_EVENT = "my-ledger-sync-state";
let state: SyncState = { online: true, syncing: false, lastError: null };
let syncInFlight: Promise<void> | undefined;
let refreshInFlight: Promise<void> | undefined;
let lastRefreshAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function publishState(next: Partial<SyncState>) {
  state = { ...state, ...next };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<SyncState>(STATE_EVENT, { detail: state }));
  }
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeToSyncState(listener: (state: SyncState) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onState = (event: Event) => listener((event as CustomEvent<SyncState>).detail);
  window.addEventListener(STATE_EVENT, onState);
  return () => window.removeEventListener(STATE_EVENT, onState);
}

export async function refreshFromServer(force = false): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) {
    publishState({ online: false });
    return;
  }
  if (!force && Date.now() - lastRefreshAt < 60_000) return;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const snapshot = await apiRequest<{
        transactions: Transaction[];
        settings: Settings;
      }>("get_snapshot");
      await mergeRemoteSnapshot(snapshot.transactions, snapshot.settings);
      lastRefreshAt = Date.now();
      publishState({ online: true, lastError: null });
      void syncPendingOperations();
    } catch (error) {
      publishState({
        online: navigator.onLine,
        lastError: error instanceof Error ? error.message : "Unable to refresh ledger",
      });
    } finally {
      refreshInFlight = undefined;
    }
  })();
  return refreshInFlight;
}

export function syncPendingOperations(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) {
    publishState({ online: false });
    return Promise.resolve();
  }
  if (syncInFlight) return syncInFlight;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  syncInFlight = drainQueue()
    .catch((error: unknown) => {
      publishState({ lastError: error instanceof Error ? error.message : "Local sync queue failed" });
    })
    .finally(() => {
      syncInFlight = undefined;
    });
  return syncInFlight;
}

async function drainQueue() {
  let nextDelay: number | undefined;
  const blockedTransactions = new Set<string>();

  try {
    const operations = await pendingOperations();
    if (!operations.some((operation) => !operation.conflict)) return;
    publishState({ online: true, syncing: true, lastError: null });
    for (const operation of operations) {
      if (operation.conflict || (operation.transactionId && blockedTransactions.has(operation.transactionId))) {
        continue;
      }
      if (operation.nextAttemptAt > Date.now()) {
        nextDelay = Math.min(nextDelay ?? Number.MAX_SAFE_INTEGER, operation.nextAttemptAt - Date.now());
        continue;
      }

      try {
        const result = await apiRequest<unknown>(operation.action, operation.data);
        await markOperationSynced(operation, result);
        publishState({ lastError: null });
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "";
        const isConflict = code === "CONFLICT" || code === "VALIDATION_ERROR" || code === "NOT_FOUND";
        const message = error instanceof Error ? error.message : "Sync failed";
        let remoteTransaction: Transaction | null = null;
        if (isConflict && operation.transactionId) {
          try {
            const snapshot = await apiRequest<{ transactions: Transaction[]; settings: Settings }>("get_snapshot");
            remoteTransaction = snapshot.transactions.find((item) => item.id === operation.transactionId) || null;
            await mergeRemoteSnapshot(snapshot.transactions, snapshot.settings);
          } catch {
            // The local operation remains durable and can be reviewed if the server is reachable later.
          }
        }
        const delay = await markOperationFailed(operation, message, isConflict, remoteTransaction);
        publishState({ lastError: message });
        if (operation.transactionId) blockedTransactions.add(operation.transactionId);
        if (!isConflict) nextDelay = Math.min(nextDelay ?? Number.MAX_SAFE_INTEGER, delay);
        if (!navigator.onLine) {
          publishState({ online: false });
          break;
        }
      }
    }
  } finally {
    publishState({ syncing: false });
    if (nextDelay !== undefined && navigator.onLine) {
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void syncPendingOperations();
      }, Math.max(250, nextDelay));
    }
  }
}

export function startSyncCoordinator() {
  if (typeof window === "undefined") return () => undefined;
  const onOnline = () => {
    publishState({ online: true, lastError: null });
    void refreshFromServer(true).finally(() => syncPendingOperations());
  };
  const onOffline = () => publishState({ online: false });
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  publishState({ online: navigator.onLine });
  if (navigator.onLine) void refreshFromServer().finally(() => syncPendingOperations());
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

export function scheduleSync() {
  void syncPendingOperations();
}
