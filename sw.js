/* Carnet de comptes — service worker
   L'app doit s'ouvrir et fonctionner entièrement hors connexion, tout en
   recevant les mises à jour sans rester bloquée sur une version ancienne.

   IMPORTANT : après toute modification d'un fichier, incrémente VERSION.
   L'app proposera alors un bouton « Mettre à jour » au prochain lancement. */

const VERSION = "v5.0";
const CACHE = "carnet-comptes-" + VERSION;

const PRECACHE = [
  "./",
  "./index.html",
  "./css/app.css",
  "./css/icons.css",
  "./js/app.js",
  "./vendor/chart.umd.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // add() une par une : une URL manquante ne fait pas échouer tout le précache.
      Promise.all(PRECACHE.map((u) => c.add(u).catch(() => null)))
    )
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Ouverture de l'app : réseau d'abord (pour avoir la dernière version),
  // cache en secours dès que la connexion manque.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Ressources statiques : cache d'abord, rafraîchies en arrière-plan.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
