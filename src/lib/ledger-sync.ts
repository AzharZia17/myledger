import { ApiError, apiRequest } from "@/lib/api";
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
  hasLoadedRemote: boolean;
}

const STATE_EVENT = "my-ledger-sync-state";
let state: SyncState = { online: true, syncing: false, lastError: null, hasLoadedRemote: false };
let syncInFlight: Promise<void> | undefined;
let refreshInFlight: Promise<void> | undefined;
let lastRefreshAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let snapshotActionUnsupported = false;
const SNAPSHOT_REFRESH_INTERVAL = 60_000;

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

async function fetchLegacySnapshot(): Promise<{ transactions: Transaction[]; settings: Settings }> {
  const [transactionResult, settings] = await Promise.all([
    apiRequest<{ transactions: Transaction[] }>("get_transactions"),
    apiRequest<Settings>("get_settings"),
  ]);
  if (!Array.isArray(transactionResult?.transactions)) {
    throw new Error("Google Sheets returned an invalid transaction list");
  }
  if (!settings || typeof settings.opening_balance !== "number" || !Number.isFinite(settings.opening_balance)) {
    throw new Error("Google Sheets returned invalid ledger settings");
  }
  return { transactions: transactionResult.transactions, settings };
}

async function fetchSnapshot(): Promise<{ transactions: Transaction[]; settings: Settings }> {
  if (snapshotActionUnsupported) return fetchLegacySnapshot();
  try {
    const snapshot = await apiRequest<{ transactions: Transaction[]; settings: Settings }>("get_snapshot");
    if (!Array.isArray(snapshot?.transactions)
      || !snapshot.settings
      || typeof snapshot.settings.opening_balance !== "number"
      || !Number.isFinite(snapshot.settings.opening_balance)) {
      throw new Error("Google Sheets returned an invalid ledger snapshot");
    }
    return snapshot;
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "INVALID_ACTION") throw error;
    snapshotActionUnsupported = true;
    console.warn("[ledger-sync] Apps Script does not support get_snapshot; using legacy read actions");
    return fetchLegacySnapshot();
  }
}

export async function refreshFromServer(force = false): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) {
    publishState({ online: false });
    return;
  }
  if (!force && Date.now() - lastRefreshAt < 60_000) return;
  if (refreshInFlight) return refreshInFlight;
  publishState({ online: true, syncing: true });
  refreshInFlight = (async () => {
    try {
      if (syncInFlight) await syncInFlight;
      const snapshot = await fetchSnapshot();
      await mergeRemoteSnapshot(snapshot.transactions, snapshot.settings);
      lastRefreshAt = Date.now();
      publishState({ online: true, lastError: null, hasLoadedRemote: true });
    } catch (error) {
      console.error("[ledger-sync] Failed to load ledger snapshot from Google Sheets", error);
      publishState({
        online: navigator.onLine,
        lastError: error instanceof Error ? error.message : "Unable to refresh ledger",
      });
    } finally {
      refreshInFlight = undefined;
      publishState({ syncing: false });
    }
  })();
  return refreshInFlight;
}

export function syncPendingOperations(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) {
    publishState({ online: false });
    return Promise.resolve();
  }
  if (refreshInFlight) return refreshInFlight.then(() => syncPendingOperations());
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
    void syncPendingOperations().finally(() => refreshFromServer(true));
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      void refreshFromServer().finally(() => syncPendingOperations());
    }
  };
  const onOffline = () => publishState({ online: false });
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  const refreshTimer = window.setInterval(onVisible, SNAPSHOT_REFRESH_INTERVAL);
  publishState({ online: navigator.onLine });
  if (navigator.onLine) void refreshFromServer().finally(() => syncPendingOperations());
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(refreshTimer);
  };
}

export function scheduleSync() {
  void syncPendingOperations();
}
