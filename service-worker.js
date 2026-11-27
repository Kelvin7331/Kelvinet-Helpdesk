/* Kelvinet Smart IT Helpdesk — PWA service worker */
const CACHE_NAME = "kelvinet-helpdesk-pwa-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/chatbot.css",
  "/chatbot.js",
  "/kb-seed.js",
  "/kb-engine.js",
  "/founder-profile.js",
  "/logo.png",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async path => {
      try {
        await cache.add(new Request(path, { cache: "reload" }));
      } catch (error) {
        // A missing optional support file should not prevent SW installation.
        console.warn("[Kelvinet PWA] Could not precache:", path, error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key =>
      key.startsWith("kelvinet-helpdesk-pwa-") && key !== CACHE_NAME
    ).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Do not cache Firebase, AI proxy, EmailJS, authentication or other API traffic.
    const staticHosts = [
      "www.gstatic.com",
      "fonts.googleapis.com",
      "fonts.gstatic.com",
      "cdnjs.cloudflare.com",
      "cdn.jsdelivr.net"
    ];
    if (!staticHosts.includes(url.hostname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      } catch (error) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Keep same-origin application shell fresh while providing an offline fallback.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        if (response && response.ok) cache.put("/index.html", response.clone());
        return response;
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match("/index.html")) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      return (await cache.match(request)) || Response.error();
    }
  })());
});
