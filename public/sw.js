/**
 * Service worker — the offline half of the PWA. Kept deliberately small and
 * safe: network-first so an online launch is never stale, with the cache (and a
 * hand-drawn /offline page) as the fallback when the phone has no signal.
 *
 * What it will NOT touch: cross-origin requests, non-GET requests, and anything
 * under /api/ (auth, cron, the owner-gated image route). Those always hit the
 * network so nothing dynamic or credential-bearing is ever served from a cache.
 * Bump VERSION to roll the cache; activate() drops every older one.
 */
const VERSION = "v1";
const CACHE = `anthonyta-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/192", "/icons/512"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Page navigations: network-first, fall back to the last-seen page, then the
  // offline shell. Keeps installed launches fresh whenever there's a connection.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const network = await fetch(request);
          if (network.ok) cache.put(request, network.clone());
          return network;
        } catch {
          return (
            (await cache.match(request)) ||
            (await cache.match(OFFLINE_URL)) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Static assets (fonts, icons, styles, scripts): stale-while-revalidate so the
  // shell paints instantly offline and refreshes in the background when online.
  if (["style", "script", "font", "image"].includes(request.destination)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })(),
    );
  }
});
