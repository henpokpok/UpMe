const CACHE_NAME = 'upmee-pwa-v9';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/bunny_mascot.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch(err => console.warn('Precache warning:', err));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache !== 'upmee-shared-data') {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Web Share Target & Network Fetch Handler (PWA Compliant)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Web Share Target POST handler
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const files = formData.getAll('file') || [];
        const singleFile = formData.get('file');
        const text = formData.get('text') || formData.get('title') || formData.get('url');

        const cache = await caches.open('upmee-shared-data');
        if (files.length > 0) {
          // Store count and each file
          await cache.put('/shared-files-count', new Response(String(files.length)));
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            await cache.put(`/shared-file-${i}`, new Response(f, {
              headers: {
                'x-file-name': encodeURIComponent(f.name),
                'content-type': f.type || 'image/jpeg'
              }
            }));
          }
        } else if (singleFile) {
          await cache.put('/shared-files-count', new Response('1'));
          await cache.put('/shared-file-0', new Response(singleFile, {
            headers: {
              'x-file-name': encodeURIComponent(singleFile.name),
              'content-type': singleFile.type || 'image/jpeg'
            }
          }));
        }
        if (text) {
          await cache.put('/shared-text', new Response(text));
        }
      } catch (err) {
        console.warn('Share target processing error:', err);
      }
      return Response.redirect('/?shared=true', 303);
    })());
    return;
  }

  // 2. Standard Fetch & Cache Handler with Offline Support
  if (event.request.method === 'GET') {
    if (url.origin === self.location.origin) {
      event.respondWith((async () => {
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (_) {
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            const indexCached = (await caches.match('/index.html')) || (await caches.match('/'));
            if (indexCached) return indexCached;
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })());
      return;
    }

    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});

// Service Worker Push Event Handler (Deduplicated with exact item tag & focused tab check)
self.addEventListener('push', (event) => {
  let title = 'UpMee 🐰';
  let bodyText = 'มีไฟล์หรือข้อความใหม่ฝากไว้บน UpMee';
  let iconUrl = '/bunny_mascot.png';
  let imageUrl = undefined;
  let payloadData = {};

  try {
    if (event.data) {
      payloadData = event.data.json();
      const isEncrypted = typeof payloadData.content === 'string' && (
        payloadData.content.includes('"e2ee":true') ||
        (payloadData.file_name && (payloadData.file_name.includes('[E2EE') || payloadData.file_name.includes('Encrypted File')))
      );
      const isFile = payloadData.type === 'file' || payloadData.type === 'both' || Boolean(payloadData.file_name);
      const isImage = isFile && payloadData.file_name && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(payloadData.file_name);

      if (isEncrypted) {
        bodyText = '🔒 ได้รับรายการใหม่ใน Private Vault (E2EE Protected)';
      } else if (isFile) {
        bodyText = `ไฟล์ใหม่: ${payloadData.file_name || 'ไฟล์แนบ'}`;
        if (isImage && payloadData.content && (payloadData.content.startsWith('http://') || payloadData.content.startsWith('https://'))) {
          iconUrl = payloadData.content;
          imageUrl = payloadData.content;
        }
      } else if (payloadData.content) {
        bodyText = payloadData.content.substring(0, 40);
      }
    }
  } catch (e) {
    if (event.data) {
      bodyText = event.data.text().substring(0, 40);
    }
  }

  // Deduplication tag based on item ID
  const itemTag = 'upmee-share-' + (payloadData.id || payloadData.created_at || 'item');

  const options = {
    body: bodyText,
    icon: iconUrl,
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: itemTag,
    renotify: false,
    data: payloadData
  };

  if (imageUrl) {
    options.image = imageUrl;
  }

  // Check if app window is already focused in foreground to prevent duplicate banners
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const isFocused = clientList.some(client => client.focused);
      if (isFocused) {
        // Page is actively open and in focus; foreground WebSocket handles notification tag
        return;
      }
      return self.registration.showNotification(title, options);
    })
  );
});

// Notification Click Handler on Mobile / Desktop
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
