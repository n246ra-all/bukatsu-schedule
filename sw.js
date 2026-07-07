importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey:            "AIzaSyApgGpS8vL15-ZXX6gLPKC0E2tVA9PODHY",
  authDomain:        "bukatsu-schedule.firebaseapp.com",
  projectId:         "bukatsu-schedule",
  storageBucket:     "bukatsu-schedule.firebasestorage.app",
  messagingSenderId: "1049363882732",
  appId:             "1:1049363882732:web:9d234aa0fa18fd54b0fbc9"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// バックグラウンド通知受信
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || '部活スケジュール';
  const body  = payload.notification?.body  || '';
  self.registration.showNotification(title, {
    body,
    icon:  './icon-192.png',
    badge: './icon-192.png',
    data:  payload.data || {},
  });
});

// 通知タップ時の処理
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  let url = 'https://n246ra-all.github.io/bukatsu-schedule/';
  if (data.lineEnabled === 'true') {
    url = (data.lineTarget === 'group' && data.lineGroupId)
      ? 'line://ti/g/' + data.lineGroupId
      : 'line://';
  }
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// ===== キャッシュ（PWA） =====
const CACHE = 'bukatsu-v6';
const APP_ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('googleapis')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
