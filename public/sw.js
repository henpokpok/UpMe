const CACHE_NAME = 'upmee-pwa-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Service Worker Push Event Handler for Mobile Background Notifications
self.addEventListener('push', (event) => {
  let data = { title: 'UpMee 🐰 มีไฟล์/ข้อความใหม่!', body: 'มีไฟล์ใหม่ฝากไว้บน UpMee' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.warn('Error parsing push data:', e);
  }

  const options = {
    body: data.body || 'มีไฟล์ใหม่ฝากไว้บน UpMee',
    icon: '/bunny_mascot.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: data
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'UpMee 🐰', options)
  );
});

// Notification Click Handler on Mobile
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
