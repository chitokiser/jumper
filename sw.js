// /sw.js — Jumper 기사앱 Service Worker
const CACHE_NAME = "jumper-driver-v2";

// 앱 셸: 오프라인에서도 로드되어야 하는 핵심 파일
const SHELL_URLS = [
  "/buggy-driver.html",
  "/assets/css/app.css",
  "/assets/css/pages/buggy.css",
  "/assets/js/pwa-install.js",
  "/assets/images/jump/jump_cart.png",
  "/manifest-driver.webmanifest",
];

// --- Install: 셸 파일 사전 캐싱 ---
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

// --- Activate: 이전 캐시 제거 ---
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

// --- Fetch: 버기카 기사앱 파일만 처리 ---
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/__/") || url.pathname.startsWith("/api/")) return;

  // 버기카 기사앱 관련 경로만 SW가 처리 — 다른 페이지는 건드리지 않음
  const isBuggyAsset = SHELL_URLS.includes(url.pathname) ||
                       url.pathname.startsWith("/buggy-driver");
  if (!isBuggyAsset) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && SHELL_URLS.includes(url.pathname)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === "navigate") {
            return caches.match("/buggy-driver.html").then(
              (page) =>
                page ||
                new Response("오프라인 상태입니다. 인터넷 연결을 확인해주세요.", {
                  status: 503,
                  headers: { "Content-Type": "text/plain; charset=utf-8" },
                })
            );
          }
          return Response.error();
        })
      )
  );
});
