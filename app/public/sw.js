/* DrivePro service worker: shows push notifications when the app is not
   visible; tapping one focuses (or reopens) the app. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {}
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const visible = wins.some((c) => c.visibilityState === 'visible');
      if (visible) return; // the open app already shows its own toast
      await self.registration.showNotification(data.title || 'DrivePro', {
        body: data.body || '',
        tag: data.tag || 'drivepro',
        renotify: true,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        vibrate: [200, 100, 200],
        data: { url: data.url || '/' },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (wins.length) return wins[0].focus();
      return self.clients.openWindow((event.notification.data && event.notification.data.url) || '/');
    })()
  );
});
