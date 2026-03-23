// /sw.js — Jumper 기사앱 Service Worker
const CACHE_NAME = "jumper-driver-v1";

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

// --- Fetch: 네트워크 우선, 실패 시 캐시 ---
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GET + 동일 오리진만 처리
  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // Firebase / API 요청은 캐시 건너뜀
  if (url.pathname.startsWith("/__/") || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // 성공 응답은 캐시에 저장 (셸 파일 대상)
        if (res.ok && SHELL_URLS.includes(url.pathname)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // 네비게이션 요청 → 오프라인 페이지
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
