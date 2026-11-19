"use client";

import { useCallback, useEffect, useState } from "react";
import {
  calculateDashboard,
  deleteTransactionLocally,
  readSnapshot,
  saveSettingsLocally,
  saveTransaction,
  subscribeToLedgerChanges,
  type LedgerSnapshot,
} from "@/lib/ledger-db";
import {
  getSyncState,
  refreshFromServer,
  scheduleSync,
  startSyncCoordinator,
  subscribeToSyncState,
  type SyncState,
} from "@/lib/ledger-sync";
import type { Settings, Transaction } from "@/types";

const EMPTY_SNAPSHOT: LedgerSnapshot = {
  transactions: [],
  settings: { opening_balance: 0, currency: "PKR", app_name: "My Ledger", theme: "system" },
  pendingCount: 0,
  conflictCount: 0,
  conflicts: [],
};

export function useLedger() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>(getSyncState);
  const [todayKey, setTodayKey] = useState<string>();

  useEffect(() => {
    let active = true;
    const updateSnapshot = () => {
      void readSnapshot().then((value) => {
        if (active) {
          setSnapshot(value);
          setLoadingLocal(false);
        }
      }).catch(() => {
        if (active) setLoadingLocal(false);
      });
    };
    const stopLedgerSubscription = subscribeToLedgerChanges(updateSnapshot);
    const stopSyncSubscription = subscribeToSyncState(setSyncState);
    const stopSyncCoordinator = startSyncCoordinator();
    void Promise.resolve().then(updateSnapshot);
    return () => {
      active = false;
      stopLedgerSubscription();
      stopSyncSubscription();
      stopSyncCoordinator();
    };
  }, []);

  useEffect(() => {
    const updateToday = () => {
      const now = new Date();
      setTodayKey(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
      timer = window.setTimeout(updateToday, nextMidnight - now.getTime() + 50);
    };
    let timer: number;
    void Promise.resolve().then(updateToday);
    return () => window.clearTimeout(timer);
  }, []);

  const addTransaction = useCallback(async (transaction: Transaction) => {
    await saveTransaction(transaction, "add_transaction");
    scheduleSync();
  }, []);
  const updateTransaction = useCallback(async (transaction: Transaction) => {
    await saveTransaction(transaction, "update_transaction");
    scheduleSync();
  }, []);
  const deleteTransaction = useCallback(async (id: string) => {
    await deleteTransactionLocally(id);
    scheduleSync();
  }, []);
  const updateSettings = useCallback(async (settings: Settings) => {
    await saveSettingsLocally(settings);
    scheduleSync();
  }, []);

  const refreshRemote = useCallback(() => refreshFromServer(true), []);
  const dashboard = calculateDashboard(snapshot, todayKey);
  const loadingRemote = syncState.online && !syncState.hasLoadedRemote && !syncState.lastError;

  return {
    ...snapshot,
    dashboard,
    loadingLocal,
    loadingRemote,
    online: syncState.online,
    syncing: syncState.syncing,
    lastSyncError: syncState.lastError,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    updateSettings,
    refreshRemote,
  };
}
