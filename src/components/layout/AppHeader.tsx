"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, List, Settings } from "lucide-react";
import { InstallAppButton } from "@/components/layout/InstallAppButton";
import { PwaRegistration } from "@/components/layout/PwaRegistration";

export function AppHeader({
  name = "My Ledger",
  online = true,
  pendingCount = 0,
  conflictCount = 0,
  syncing = false,
  syncError = null,
  ready = true,
}: {
  name?: string;
  online?: boolean;
  pendingCount?: number;
  conflictCount?: number;
  syncing?: boolean;
  syncError?: string | null;
  ready?: boolean;
}) {
  const pathname = usePathname();
  const items = [{ href: "/", label: "Overview", icon: LayoutDashboard }, { href: "/transactions", label: "Transactions", icon: List }, { href: "/settings", label: "Settings", icon: Settings }];
  const status = !ready
    ? "Loading local data"
    : conflictCount
      ? `Review sync · ${conflictCount}`
    : !online
      ? "Offline"
      : syncError
        ? "Sync failed"
        : syncing
          ? "Syncing"
          : pendingCount
            ? `Pending sync · ${pendingCount}`
            : "Synced";
  const dot = !ready ? "bg-zinc-300" : conflictCount ? "bg-red-500" : syncError || !online || pendingCount ? "bg-amber-500" : "bg-emerald-500";
  return <><PwaRegistration/><header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"><div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4"><Link href="/" className="font-semibold tracking-tight">{name}</Link><nav className="hidden items-center gap-5 sm:flex">{items.map(({href,label})=>{const active=pathname===href;return <Link key={href} href={href} className={`text-sm ${active?"font-medium text-zinc-950 dark:text-white":"text-zinc-500"}`}>{label}</Link>})}</nav><div className="flex items-center gap-2"><InstallAppButton/><div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-500"><span className={`h-2 w-2 rounded-full ${dot}`}/>{status}</div></div></div></header><nav className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-zinc-800 dark:bg-zinc-950 sm:hidden"><div className="grid h-16 grid-cols-3">{items.map(({ href, label, icon: Icon }) => { const active = pathname === href; return <Link key={href} href={href} className={`flex flex-col items-center justify-center gap-1 text-xs ${active ? "text-zinc-950 dark:text-white" : "text-zinc-500"}`}><Icon className="h-5 w-5"/><span>{label}</span></Link>; })}</div></nav></>;
}
