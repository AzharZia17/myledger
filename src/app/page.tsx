"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Minus, Plus, RefreshCw } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { TransactionForm } from "@/components/forms/TransactionForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLedger } from "@/hooks/useLedger";
import type { LocalTransaction } from "@/lib/ledger-db";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { TransactionType } from "@/types";
import { Toaster } from "sonner";

export default function DashboardPage() {
  const ledger = useLedger();
  const [formType, setFormType] = useState<TransactionType | null>(null);
  const data = ledger.dashboard;

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
      {ledger.loadingLocal ? <DashboardSkeleton /> : <>
        <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-zinc-500">Current Balance</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{formatCurrency(data.balance)}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void ledger.refreshRemote()}
              disabled={ledger.syncing}
              aria-label="Refresh ledger from Google Sheets"
            >
              <RefreshCw className={`h-4 w-4 ${ledger.syncing ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button onClick={() => setFormType("income")} variant="outline" className="h-12 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-400">
              <Plus className="h-4 w-4" />Add Money
            </Button>
            <Button onClick={() => setFormType("expense")} variant="outline" className="h-12 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400">
              <Minus className="h-4 w-4" />Add Expense
            </Button>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-3 divide-x divide-zinc-200 rounded-lg border border-zinc-200 py-4 dark:divide-zinc-800 dark:border-zinc-800">
          <Summary label="Received today" value={formatCurrency(data.income_today)} positive />
          <Summary label="Spent today" value={formatCurrency(data.expense_today)} />
          <Summary label="Expenses month" value={formatCurrency(data.expense_month)} />
        </section>

        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Recent transactions</h2>
            <Link href="/transactions" className="text-sm text-zinc-500 hover:text-zinc-950">View all</Link>
          </div>
          {data.recent_transactions.length
            ? <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {data.recent_transactions.map((transaction) => <TransactionRow key={transaction.id} item={transaction} />)}
            </div>
            : <EmptyState onAddMoney={() => setFormType("income")} onAddExpense={() => setFormType("expense")} />}
        </section>
        {ledger.conflictCount > 0 && <p role="status" className="mt-4 text-sm text-red-600">
          {ledger.conflictCount} change{ledger.conflictCount === 1 ? "" : "s"} need review before syncing.{" "}
          <Link className="font-medium underline underline-offset-2" href="/transactions">Review</Link>
        </p>}
      </>}
    </main>
    {formType && <TransactionForm
      open
      onOpenChange={(open) => { if (!open) setFormType(null); }}
      type={formType}
      onSaved={() => undefined}
      onAdd={(transaction) => ledger.addTransaction(transaction)}
      onUpdate={(transaction) => ledger.updateTransaction(transaction)}
    />}
  </>;
}

function Summary({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return <div className="px-3">
    <p className="text-xs leading-4 text-zinc-500">{label}</p>
    <p className={`mt-1 text-sm font-semibold ${positive ? "text-emerald-600" : "text-zinc-900 dark:text-zinc-100"}`}>{value}</p>
  </div>;
}

function TransactionRow({ item }: { item: LocalTransaction }) {
  const income = item.type === "income";
  return <div className="flex items-center gap-3 px-3 py-3.5">
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${income ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
      {income ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{item.source_destination || (income ? "Income" : item.category || "Expense")}</p>
      <p className="truncate text-xs text-zinc-500">
        {item.description || formatDate(item.transaction_date)}
        {item.syncStatus !== "synced" && <span className={item.syncStatus === "conflict" ? "text-red-600" : "text-amber-600"}>
          {" · "}{item.syncStatus === "conflict" ? "Needs review" : "Pending sync"}
        </span>}
      </p>
    </div>
    <div className="text-right">
      <p className={`text-sm font-semibold ${income ? "text-emerald-600" : "text-red-600"}`}>
        {income ? "+ " : "− "}{formatCurrency(item.amount).replace("Rs. ", "")}
      </p>
      <p className="mt-0.5 text-xs text-zinc-400">{formatDate(item.transaction_date)}</p>
    </div>
  </div>;
}

function DashboardSkeleton() {
  return <div className="space-y-5" aria-label="Loading saved ledger">
    <Skeleton className="h-44 w-full" />
    <div className="grid grid-cols-3 gap-2"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
    <Skeleton className="h-64 w-full" />
  </div>;
}

function EmptyState({ onAddMoney, onAddExpense }: { onAddMoney: () => void; onAddExpense: () => void }) {
  return <div className="rounded-lg border border-dashed border-zinc-200 px-5 py-10 text-center">
    <h3 className="font-medium">No transactions yet</h3>
    <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">Add your first income or expense to start tracking your balance.</p>
    <div className="mt-5 flex justify-center gap-2">
      <Button onClick={onAddMoney} variant="outline">Add Money</Button>
      <Button onClick={onAddExpense}>Add Expense</Button>
    </div>
  </div>;
}
