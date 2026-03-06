// /sw.js
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Do not intercept non-GET or cross-origin requests (e.g. Firebase Storage upload POST).
  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req).catch(() => {
      // Keep behavior simple: only provide offline fallback for HTML navigations.
      if (req.mode === "navigate") {
        return new Response("오프라인 상태입니다.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      return Response.error();
    })
  );
});
