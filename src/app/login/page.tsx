"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const payload = await response.json();
    if (payload.success) router.replace("/"); else setError(payload.error?.message || "Unable to sign in");
    setLoading(false);
  }

  return <main className="flex min-h-dvh items-center justify-center px-5"><form onSubmit={submit} className="w-full max-w-sm space-y-5"><div><p className="text-sm text-zinc-500">Private ledger</p><h1 className="mt-1 text-2xl font-semibold">My Ledger</h1></div><div className="space-y-2"><label htmlFor="password" className="text-sm font-medium">Password</label><Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>{error && <p className="text-sm text-red-600">{error}</p>}<Button className="w-full" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</Button></form></main>;
}
