"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.storage?.persist?.().catch((error: unknown) => {
      console.warn("Persistent browser storage was not granted", error);
    });
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(async (registration) => {
      const active = registration.active || (await navigator.serviceWorker.ready).active;
      active?.postMessage({ type: "CACHE_APP_PAGES" });
    }).catch((error: unknown) => {
      console.error("Unable to register the offline app shell", error);
    });
  }, []);

  return null;
}
