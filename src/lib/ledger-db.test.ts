import "fake-indexeddb/auto";
import { describe, expect, it } from "bun:test";
import {
  calculateDashboard,
  markOperationFailed,
  markOperationSynced,
  mergeRemoteSnapshot,
  pendingOperations,
  readSnapshot,
  resolveTransactionConflict,
  saveSettingsLocally,
  saveTransaction,
  deleteTransactionLocally,
} from "@/lib/ledger-db";
import type { Settings, Transaction } from "@/types";
import { formatCurrency } from "@/lib/utils";

Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true });

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: "income",
    amount: 5_000,
    category: "Salary",
    source_destination: "Work",
    description: "Test income",
    transaction_date: now,
    created_at: now,
    updated_at: now,
    deleted: false,
    ...overrides,
  };
}

describe("offline ledger persistence and synchronization", () => {
  it("keeps local edits durable, recalculates balance, and resolves stale edits without overwriting", async () => {
    const settings: Settings = {
      opening_balance: 10_000,
      currency: "PKR",
      app_name: "Test ledger",
      theme: "system",
    };
    await saveSettingsLocally(settings);
    const income = transaction();
    const expense = transaction({
      type: "expense",
      amount: 1_000,
      category: "Food",
      source_destination: "Cafe",
    });

    await saveTransaction(income, "add_transaction");
    const sendingAdd = (await pendingOperations()).find((operation) => operation.transactionId === income.id);
    expect(sendingAdd).toBeDefined();
    await saveTransaction({ ...income, amount: 6_000 }, "update_transaction");

    const addedOnServer = { ...income, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
    await markOperationSynced(sendingAdd!, { transaction: addedOnServer });
    const afterAdd = await readSnapshot();
    const localIncome = afterAdd.transactions.find((item) => item.id === income.id);
    expect(localIncome?.amount).toBe(6_000);
    expect(localIncome?.syncStatus).toBe("pending");
    const followUp = (await pendingOperations()).find((operation) => operation.transactionId === income.id);
    expect(followUp?.action).toBe("update_transaction");
    expect(followUp?.data.expected_updated_at).toBe(addedOnServer.updated_at);

    await markOperationSynced(followUp!, {
      transaction: { ...income, amount: 6_000, updated_at: "2026-01-02T00:00:00.000Z" },
    });
    await saveTransaction(expense, "add_transaction");
    const expenseAdd = (await pendingOperations()).find((operation) => operation.transactionId === expense.id);
    await markOperationSynced(expenseAdd!, { transaction: expense });
    expect(calculateDashboard(await readSnapshot()).balance).toBe(15_000);

    const overspend = transaction({ type: "expense", amount: 20_000, category: "Bills" });
    await saveTransaction(overspend, "add_transaction");
    expect(calculateDashboard(await readSnapshot()).balance).toBe(-5_000);
    expect(formatCurrency(calculateDashboard(await readSnapshot()).balance)).toBe("− Rs. 5,000");
    await deleteTransactionLocally(overspend.id);
    expect(calculateDashboard(await readSnapshot()).balance).toBe(15_000);
    expect((await pendingOperations()).some((operation) => operation.transactionId === overspend.id)).toBe(false);

    const currentIncome = (await readSnapshot()).transactions.find((item) => item.id === income.id)!;
    await saveTransaction({ ...currentIncome, amount: 7_000 }, "update_transaction");
    const update = (await pendingOperations()).find((operation) => operation.transactionId === income.id)!;
    const remoteVersion: Transaction = {
      ...income,
      amount: 6_500,
      updated_at: "2026-02-01T00:00:00.000Z",
    };
    await markOperationFailed(update, "Changed on another device", true, remoteVersion);
    const conflictSnapshot = await readSnapshot();
    expect(conflictSnapshot.conflictCount).toBe(1);
    expect(conflictSnapshot.transactions.find((item) => item.id === income.id)?.amount).toBe(7_000);

    await resolveTransactionConflict(update.id, true);
    const resolved = (await pendingOperations()).find((operation) => operation.transactionId === income.id)!;
    expect(resolved.conflict).toBe(false);
    expect(resolved.data.expected_updated_at).toBe(remoteVersion.updated_at);
    await markOperationSynced(resolved, {
      transaction: { ...income, amount: 7_000, updated_at: "2026-02-02T00:00:00.000Z" },
    });

    const finalSnapshot = await readSnapshot();
    expect(finalSnapshot.transactions.find((item) => item.id === income.id)?.syncStatus).toBe("synced");
    expect(calculateDashboard(finalSnapshot).balance).toBe(16_000);

    const remoteEdit = { ...income, amount: 6_500, updated_at: "2026-03-01T00:00:00.000Z" };
    const remoteAdd = transaction({ id: "created-on-another-device", amount: 250.5 });
    const pendingLocal = transaction({ id: "created-offline", amount: 42.25 });
    await saveTransaction(pendingLocal, "add_transaction");
    await mergeRemoteSnapshot([remoteEdit, remoteAdd], settings);
    await mergeRemoteSnapshot([remoteEdit, remoteAdd], settings);

    const reconciled = await readSnapshot();
    expect(reconciled.transactions.find((item) => item.id === income.id)?.amount).toBe(6_500);
    expect(reconciled.transactions.find((item) => item.id === remoteAdd.id)?.amount).toBe(250.5);
    expect(reconciled.transactions.filter((item) => item.id === remoteAdd.id)).toHaveLength(1);
    expect(reconciled.transactions.some((item) => item.id === expense.id)).toBe(false);
    expect(reconciled.transactions.find((item) => item.id === pendingLocal.id)?.syncStatus).toBe("pending");
  });
});
