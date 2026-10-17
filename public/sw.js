const CACHE = "allinoneview-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/allinoneview-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache API responses or OAuth/auth routes. Live market data must stay live.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/callback") ||
    url.pathname.includes("/auth/")
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) =>
            cached ||
            caches.match("/").then(
              (home) =>
                home ||
                new Response("ALLINONEVIEW is offline.", {
                  status: 503,
                  headers: { "Content-Type": "text/plain" }
                })
            )
        )
      )
  );
});
