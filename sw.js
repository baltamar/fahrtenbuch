/* ============================================================
   Fahrtenbuch PWA – Service Worker
   Cache-First für die App-Shell. Versionierter Cache.
   ============================================================ */
"use strict";

var CACHE_NAME = "fahrtenbuch-v2";
var APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // addAll ist atomar – wenn eine Datei fehlt, schlägt das hier fehl.
      // Wir nutzen daher add() mit Fallback.
      return Promise.all(
        APP_SHELL.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn("[SW] Konnte nicht cachen:", url, err);
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  // Nur same-origin Ressourcen aus dem Cache bedienen
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Cache-First, dann Netzwerk, dann Offline-Fallback
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        // Erfolgreiche Antworten in den Cache legen
        if (resp && resp.status === 200 && resp.type === "basic") {
          var copy = resp.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(req, copy).catch(function () { /* ignore quota */ });
          });
        }
        return resp;
      }).catch(function () {
        // Offline-Fallback: index.html für Navigation
        if (req.mode === "navigate") {
          return caches.match("./index.html");
        }
        return new Response("", { status: 504, statusText: "Offline" });
      });
    })
  );
});
