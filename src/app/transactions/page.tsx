"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, MoreHorizontal, Search } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { TransactionForm } from "@/components/forms/TransactionForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLedger } from "@/hooks/useLedger";
import { resolveTransactionConflict } from "@/lib/ledger-db";
import { scheduleSync } from "@/lib/ledger-sync";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { LocalTransaction } from "@/lib/ledger-db";
import type { Transaction } from "@/types";
import { toast, Toaster } from "sonner";

export default function TransactionsPage() {
  const ledger = useLedger();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [pageSize, setPageSize] = useState(50);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [now, setNow] = useState<Date>();

  useEffect(() => {
    let timer: number;
    const updateNow = () => {
      const current = new Date();
      setNow(current);
      const nextMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime();
      timer = window.setTimeout(updateNow, nextMidnight - current.getTime() + 50);
    };
    void Promise.resolve().then(updateNow);
    return () => window.clearTimeout(timer);
  }, []);

  const filtered = useMemo(() => ledger.transactions.filter((item) => {
    if (filter !== "all" && item.type !== filter) return false;
    const haystack = [item.source_destination, item.category, item.description].join(" ").toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (!now) return true;
    const date = new Date(item.transaction_date);
    if (dateFilter === "today") return date.toDateString() === now.toDateString();
    if (dateFilter === "month") return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    if (dateFilter === "week") {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      return date >= start && date <= now;
    }
    return true;
  }), [ledger.transactions, filter, search, dateFilter, now]);

  async function deleteTransaction(item: Transaction) {
    if (!window.confirm("Delete this transaction? It will be removed from your balance and kept as an audit record in Google Sheets.")) return;
    try {
      await ledger.deleteTransaction(item.id);
      toast.success(navigator.onLine ? "Deleted on this device · syncing" : "Deleted on this device · will sync when online");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete transaction on this device");
    }
  }

  async function settleConflict(id: string, keepLocal: boolean) {
    if (!keepLocal && !window.confirm("Replace your local change with the version in Google Sheets?")) return;
    try {
      await resolveTransactionConflict(id, keepLocal);
      if (keepLocal) scheduleSync();
      toast.success(keepLocal ? "Local version kept; syncing your reviewed change" : "Google Sheets version restored");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to resolve sync conflict");
    }
  }

  return <>
    <Toaster position="top-center" />
    <AppHeader
      name={ledger.settings.app_name}
      online={ledger.online}
      pendingCount={ledger.pendingCount}
      conflictCount={ledger.conflictCount}
      syncing={ledger.syncing}
      syncError={ledger.lastSyncError}
      ready={!ledger.loadingLocal}
    />
    <main className="mx-auto min-h-dvh max-w-5xl px-4 pb-24 pt-6 sm:pb-10">
      <div className="mb-5">
        <p className="text-xs text-zinc-500">Ledger</p>
        <h1 className="text-2xl font-semibold">Transactions</h1>
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {[["all", "All"], ["income", "Income"], ["expense", "Expenses"]].map(([value, label]) =>
          <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>{label}</Button>)}
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-zinc-400" />
          <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions" />
        </div>
        <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="h-11 rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <option value="all">All dates</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option>
        </select>
      </div>

      {ledger.conflicts.length > 0 && <section aria-label="Sync conflicts" className="mb-4 space-y-3">
        {ledger.conflicts.map((conflict) => {
          const localTitle = String(conflict.data.source_destination || conflict.data.category || "Transaction");
          return <div key={conflict.id} className="rounded-lg border border-red-200 bg-red-50/60 p-4 dark:border-red-950 dark:bg-red-950/20">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">Review change: {localTitle}</p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{conflict.lastError || "This record changed in Google Sheets."} Your local change is preserved.</p>
            {conflict.remoteTransaction && <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
              Google Sheets version: {conflict.remoteTransaction.source_destination || conflict.remoteTransaction.category || "Transaction"} · {formatCurrency(conflict.remoteTransaction.amount)}
            </p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void settleConflict(conflict.id, true)}>
                {conflict.action === "add_transaction" ? "Save mine as new" : "Keep mine"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void settleConflict(conflict.id, false)}>
                {conflict.remoteTransaction ? "Use Sheets version" : "Discard local change"}
              </Button>
            </div>
          </div>;
        })}
      </section>}

      {ledger.loadingLocal
        ? <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        : filtered.length
          ? <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {filtered.slice(0, pageSize).map((item) => {
              return <div key={item.id}>
                <TransactionRow
                  item={item}
                  onEdit={() => setEditing(item)}
                  onDelete={() => void deleteTransaction(item)}
                />
              </div>;
            })}
          </div>
          : <div className="rounded-lg border border-dashed border-zinc-200 px-5 py-12 text-center">
            <p className="font-medium">No transactions found</p>
            <p className="mt-1 text-sm text-zinc-500">Try changing your filters.</p>
          </div>}
      {!ledger.loadingLocal && filtered.length > pageSize && <Button
        variant="outline"
        className="mt-4 w-full"
        onClick={() => setPageSize((size) => size + 50)}
      >Load 50 more</Button>}
    </main>
    {editing && <TransactionForm
      open
      onOpenChange={(open) => { if (!open) setEditing(null); }}
      type={editing.type}
      transaction={editing}
      onSaved={() => undefined}
      onAdd={(transaction) => ledger.addTransaction(transaction)}
      onUpdate={(transaction) => ledger.updateTransaction(transaction)}
    />}
  </>;
}

function TransactionRow({ item, onEdit, onDelete }: { item: LocalTransaction; onEdit: () => void; onDelete: () => void }) {
  const income = item.type === "income";
  return <div className="flex items-center gap-3 px-3 py-3.5">
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${income ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
      {income ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{item.source_destination || item.category || "Transaction"}</p>
      <p className="truncate text-xs text-zinc-500">{item.description || formatDate(item.transaction_date)}</p>
    </div>
    <div className="text-right">
      <p className={`text-sm font-semibold ${income ? "text-emerald-600" : "text-red-600"}`}>
        {income ? "+ " : "− "}{formatCurrency(item.amount).replace("Rs. ", "")}
      </p>
      <p className="mt-0.5 text-xs text-zinc-400">{formatDate(item.transaction_date)}</p>
      {item.syncStatus !== "synced" && <p className={`mt-0.5 text-[10px] ${item.syncStatus === "conflict" ? "text-red-600" : "text-amber-600"}`}>
        {item.syncStatus === "conflict" ? "Needs review" : "Pending sync"}
      </p>}
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Transaction actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem className="text-red-600" onClick={onDelete}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
