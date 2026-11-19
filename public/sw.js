const SHELL_CACHE = "my-ledger-shell-v1";
const PAGE_CACHE = "my-ledger-pages-v1";
const SHELL_ASSETS = [
  "/offline.html",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-icon.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("my-ledger-") && key !== SHELL_CACHE && key !== PAGE_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_APP_PAGES") return;
  event.waitUntil((async () => {
    const cache = await caches.open(PAGE_CACHE);
    for (const path of ["/", "/transactions", "/settings"]) {
      try {
        const url = new URL(path, self.location.origin);
        const response = await fetch(new Request(url, { credentials: "include", cache: "no-store" }));
        if (response.ok && response.type === "basic" && new URL(response.url).pathname !== "/login") {
          await cache.put(url.href, response);
        }
      } catch {
        // A page is cached on its first successful visit if prefetching is unavailable.
      }
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(PAGE_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic" && new URL(response.url).pathname !== "/login") {
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (await cache.match(request, { ignoreVary: true }))
          || (await cache.match(new URL(url.pathname, self.location.origin).href, { ignoreVary: true }))
          || (await caches.match("/offline.html"));
      }
    })());
    return;
  }

});
