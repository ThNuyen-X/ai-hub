// Service Worker - Auto Flush & Network First
const CACHE_VER = "bo-tot-v11";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // Luôn ưu tiên mạng tươi mới, không lưu cache để đổi giao diện tức thì
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
