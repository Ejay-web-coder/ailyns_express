/* Ailyn's Express service worker.
 *
 * Kept deliberately small so a deploy is never hidden behind a stale cache:
 * - Page loads always go to the network first; the offline page is only a fallback.
 * - Static files (JS, CSS, images, fonts from this site) are served from cache and
 *   refreshed in the background. Vite gives bundles hashed names, so a new deploy
 *   always fetches new files.
 * - Supabase, Google Fonts, maps and every other origin are never intercepted.
 *
 * Bump VERSION when this file's caching rules change.
 */
const VERSION = "ae-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/favicon-48.png"];
const RUNTIME_LIMIT = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
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
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const trim = async (cache) => {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - RUNTIME_LIMIT; i += 1) await cache.delete(keys[i]);
};

const isStatic = (request, url) =>
  ["script", "style", "image", "font"].includes(request.destination) ||
  url.pathname.startsWith("/assets/") ||
  url.pathname.startsWith("/icons/");

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()),
    );
    return;
  }

  if (!isStatic(request, url)) return;

  // Stale-while-revalidate: answer from cache when possible, refresh the copy in the background.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            cache
              .put(request, response.clone())
              .then(() => trim(cache))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});
