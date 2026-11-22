const CACHE_NAME = "kmoa-app-v9999999999";

const CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/manifest.webmanifest",
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

// ── PWA Push Notification Handlers ────────────────────────────────────────
self.addEventListener("push", (event) => {
  let payload = {
    title: "베스트클럽 (BestClub)",
    body: "새로운 타임특가 · 주간 3억 GP 게임 소식이 도착했습니다!",
    url: "/",
    tag: "bestclub-alert",
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch (_) {
      const text = event.data.text();
      if (text) payload.body = text;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || "/assets/images/jump/mlogo.png",
      badge: "/assets/images/jump/mlogo.png",
      tag: payload.tag || "bestclub-alert",
      renotify: true,
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "SHOW_LOCAL_NOTIFICATION") return;

  event.waitUntil(
    self.registration.showNotification(data.title || "베스트클럽 알림", {
      body: data.body || "베스트클럽 알림이 활성화되었습니다.",
      icon: "/assets/images/jump/mlogo.png",
      badge: "/assets/images/jump/mlogo.png",
      tag: data.tag || "bestclub-local",
      data: { url: data.url || "/" },
    })
  );
});

