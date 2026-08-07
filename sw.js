/* Offline service worker for OpenStudio.
   Navigations are network-first so a new deploy is picked up immediately;
   hashed assets are cache-first (their names change on every build). */
const CACHE = 'openstudio-v2'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return

  const isNavigation = req.mode === 'navigate' || req.destination === 'document'
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (isNavigation) {
        try {
          const fresh = await fetch(req)
          if (fresh.ok) cache.put(req, fresh.clone())
          return fresh
        } catch {
          const cached = await cache.match(req)
          if (cached) return cached
          throw new Error('offline and not cached')
        }
      }
      const cached = await cache.match(req)
      if (cached) return cached
      const res = await fetch(req)
      if (res.ok) cache.put(req, res.clone())
      return res
    })
  )
})
