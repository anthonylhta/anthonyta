/**
 * Service worker — the offline half of the PWA. Kept deliberately small and
 * safe: network-first so an online launch is never stale, with the cache (and a
 * hand-drawn /offline page) as the fallback when the phone has no signal.
 *
 * What it will NOT touch: cross-origin requests, non-GET requests (except the
 * share-target POST below), and anything under /api/ (auth, cron, the
 * owner-gated image route). Those always hit the network so nothing dynamic or
 * credential-bearing is ever served from a cache.
 * Bump VERSION to roll the cache; activate() drops every older one.
 *
 * The one non-GET job: the share sheet POSTs files to /files/share-target, and
 * sending them to the server would mean plaintext leaving the device (ADR 0053).
 * So the SW stashes them in SHARED_CACHE and 303s to /files?shared=1, where the
 * page encrypts and uploads them. No crypto runs in the SW — it has no key and
 * never sees the passphrase; it only holds bytes for the window to collect.
 */
const VERSION = "v2";
const CACHE = `anthonyta-${VERSION}`;
// The share stash. NOT versioned with the SW cache and exempt from the
// activate() wipe — a pending share must survive a worker update.
const SHARED_CACHE = "anthonyta-shared-v1";
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
          keys
            .filter((key) => key !== CACHE && key !== SHARED_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Share-target intercept — MUST run before the GET-only guard. Stash the
  // shared files locally and bounce to the inbox; if this handler doesn't run
  // (fresh install, mid-deploy) the POST falls through to the server fallback
  // route, which stores nothing and redirects to the failure banner.
  if (request.method === "POST" && url.pathname === "/files/share-target") {
    event.respondWith(
      (async () => {
        try {
          const form = await request.formData();
          const files = form
            .getAll("file")
            .filter((f) => f instanceof File && f.size > 0);
          if (files.length === 0)
            return Response.redirect("/files?share=failed", 303);
          const cache = await caches.open(SHARED_CACHE);
          let i = 0;
          for (const file of files) {
            await cache.put(
              new Request(`/__shared__/${Date.now()}-${i++}`),
              new Response(file, {
                headers: {
                  "content-type": file.type || "application/octet-stream",
                  "x-shared-name": encodeURIComponent(file.name),
                },
              }),
            );
          }
          return Response.redirect("/files?shared=1", 303);
        } catch {
          return Response.redirect("/files?share=failed", 303);
        }
      })(),
    );
    return;
  }

  if (request.method !== "GET") return;
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
