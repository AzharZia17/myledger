"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { AppHeader } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLedger } from "@/hooks/useLedger";
import { toast, Toaster } from "sonner";
import type { Settings } from "@/types";

export default function SettingsPage() {
  const router = useRouter();
  const ledger = useLedger();
  const { theme, setTheme } = useTheme();
  const [opening, setOpening] = useState<string>();
  const [name, setName] = useState<string>();
  const [saving, setSaving] = useState(false);
  const openingValue = opening ?? String(ledger.settings.opening_balance);
  const nameValue = name ?? ledger.settings.app_name;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(openingValue);
    if (!Number.isFinite(value)) {
      toast.error("Enter a valid opening balance");
      return;
    }
    setSaving(true);
    try {
      const settings: Settings = {
        ...ledger.settings,
        opening_balance: value,
        currency: "PKR",
        app_name: nameValue.trim() || "My Ledger",
        theme: theme === "light" || theme === "dark" ? theme : "system",
      };
      await ledger.updateSettings(settings);
      toast.success(navigator.onLine ? "Saved on this device · syncing" : "Saved on this device · will sync when online");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save settings on this device");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
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
      ready={!ledger.loadingLocal && !ledger.loadingRemote}
    />
    <main className="mx-auto min-h-dvh max-w-2xl px-4 pb-24 pt-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {ledger.loadingLocal || ledger.loadingRemote
        ? <p className="mt-6 text-sm text-zinc-500">Loading settings…</p>
        : <form onSubmit={submit} className="mt-6 space-y-5 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
          <div className="space-y-1.5">
            <label htmlFor="opening-balance" className="text-sm font-medium">Opening balance</label>
            <div className="relative">
              <span className="absolute left-3 top-3 text-sm text-zinc-500">Rs.</span>
              <Input id="opening-balance" className="pl-11" type="number" step="0.01" value={openingValue} onChange={(event) => setOpening(event.target.value)} required />
            </div>
            <p className="text-xs text-zinc-500">The money you already had before recording transactions.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="app-name" className="text-sm font-medium">App name</label>
            <Input id="app-name" value={nameValue} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Currency</label>
            <Input value="PKR — Pakistani Rupee" disabled />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Theme</span>
            <div className="grid grid-cols-3 gap-2">
              {["light", "dark", "system"].map((item) =>
                <Button type="button" key={item} size="sm" variant={theme === item ? "default" : "outline"} onClick={() => setTheme(item)} className="capitalize">{item}</Button>)}
            </div>
          </div>
          <Button className="w-full" disabled={saving}>{saving ? "Saving to this device…" : "Save settings"}</Button>
        </form>}
      <Button type="button" variant="outline" className="mt-4 w-full text-red-600" onClick={() => void signOut()}>Sign out</Button>
    </main>
  </>;
}
