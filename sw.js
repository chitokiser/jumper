const CACHE_NAME = "kmoa-app-v1788407502796";

const CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/assets/css/app.css",
  "/assets/css/header.css",
  "/assets/images/jump/mlogo.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;
  if (!url.origin.includes(self.location.hostname)) return; // Only cache same-origin
  if (url.pathname.startsWith("/__/") || url.pathname.startsWith("/api/")) return;

  // Network First Strategy
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache valid responses dynamically
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(async () => {
        // Offline Fallback
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          // Fallback to offline page (or just index.html)
          return caches.match("/index.html");
        }
        return Response.error();
      })
  );
});
