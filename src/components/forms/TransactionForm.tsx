"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { localDateTimeValue } from "@/lib/utils";
import type { Transaction, TransactionType } from "@/types";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: TransactionType;
  transaction?: Transaction;
  onSaved: () => void;
  onAdd: (transaction: Transaction) => Promise<void>;
  onUpdate: (transaction: Transaction) => Promise<void>;
}

export function TransactionForm({ open, onOpenChange, type, transaction, onSaved, onAdd, onUpdate }: Props) {
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "");
  const [sourceDestination, setSourceDestination] = useState(transaction?.source_destination || "");
  const [category, setCategory] = useState(transaction?.category || (type === "income" ? "Salary" : ""));
  const [description, setDescription] = useState(transaction?.description || "");
  const [date, setDate] = useState(transaction?.transaction_date ? transaction.transaction_date.slice(0,16) : localDateTimeValue());
  const [loading, setLoading] = useState(false);


  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { toast.error("Enter an amount greater than zero"); return; }
    setLoading(true);
    try {
      const now = new Date().toISOString();
      const data: Transaction = {
        id: transaction?.id || crypto.randomUUID(),
        type,
        amount: value,
        category: category.trim(),
        source_destination: sourceDestination.trim(),
        description: description.trim(),
        transaction_date: new Date(date).toISOString(),
        created_at: transaction?.created_at || now,
        updated_at: transaction?.updated_at || now,
        deleted: false,
      };
      if (transaction) await onUpdate(data);
      else await onAdd(data);
      toast.success(navigator.onLine ? "Saved on this device · syncing" : "Saved on this device · will sync when online");
      onSaved(); onOpenChange(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save transaction on this device"); }
    finally { setLoading(false); }
  }

  const isIncome = type === "income";
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{transaction ? "Edit" : isIncome ? "Add Money" : "Add Expense"}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-4"><div className="space-y-1.5"><label className="text-sm font-medium">Amount (Rs.)</label><Input inputMode="decimal" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus required /></div>
      {isIncome ? <div className="space-y-1.5"><label className="text-sm font-medium">Source</label><Input value={sourceDestination} onChange={(e) => setSourceDestination(e.target.value)} placeholder="Salary, business, friend..." required /><div className="flex flex-wrap gap-1.5 pt-1">{["Salary","Business","Friend","Bank Transfer","Cash","Other"].map((item) => <button type="button" key={item} onClick={() => setSourceDestination(item)} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800">{item}</button>)}</div></div> : <><div className="space-y-1.5"><label className="text-sm font-medium">Category</label><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Food, Transport, Bills..." /><div className="flex flex-wrap gap-1.5 pt-1">{["Food","Transport","Shopping","Bills","Health","Personal","Family","Education","Other"].map((item) => <button type="button" key={item} onClick={() => setCategory(item)} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800">{item}</button>)}</div></div><div className="space-y-1.5"><label className="text-sm font-medium">Paid to / destination</label><Input value={sourceDestination} onChange={(e) => setSourceDestination(e.target.value)} placeholder="Where did it go?" /></div></>}
      <div className="space-y-1.5"><label className="text-sm font-medium">Description <span className="text-zinc-400">(optional)</span></label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add a note" /></div>
      <div className="space-y-1.5"><label className="text-sm font-medium">Date and time</label><Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? "Saving..." : transaction ? "Save changes" : isIncome ? "Add Money" : "Add Expense"}</Button>
    </form></DialogContent></Dialog>;
}
