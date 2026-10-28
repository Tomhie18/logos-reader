/* Service worker: app shell is pre-cached; data files are cached the first time they are read
   (cache-first, so after that the radio stays off). Bump VERSION when app files change. */
const VERSION = "v1";
const SHELL = `shell-${VERSION}`, DATA = "data-v1";
const FILES = ["./", "index.html", "app.js", "style.css", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "data/books.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // API calls go straight to the network
  const isData = url.pathname.includes("/data/");
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && (isData || FILES.some((f) => url.pathname.endsWith(f.replace("./", "")) ))) {
        const c = await caches.open(isData ? DATA : SHELL);
        c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
      throw err;
    }
  })());
});
