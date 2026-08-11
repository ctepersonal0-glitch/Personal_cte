// ==================== firebase-messaging-sw.js ====================
// Archivo obligatorio para notificaciones en segundo plano
// DEBE estar en la RAÍZ del servidor (mismo nivel que index.html)

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDUg4382VkkbP4CB9YV2wASS0bc9WEcM-U",
  authDomain: "cte-sistema-53d3e.firebaseapp.com",
  projectId: "cte-sistema-53d3e",
  storageBucket: "cte-sistema-53d3e.firebasestorage.app",
  messagingSenderId: "863608060086",
  appId: "1:863608060086:web:1accb8e23ca865b06f0e17"
});

const messaging = firebase.messaging();

// ── Notificaciones cuando la app está en segundo plano o cerrada ──
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Notificación en segundo plano:', payload);

  const { title, body, icon } = payload.notification || {};

  self.registration.showNotification(title || '⚠️ NUEVA SOLICITUD CTE', {
    body: body || '⚠️ Hay una nueva solicitud de registro pendiente.',
    icon: icon || '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'cte-solicitud-' + Date.now(),
    data: payload.data,
    actions: [
      { action: 'abrir', title: '📋 Ver solicitud' },
      { action: 'cerrar', title: '✕ Cerrar' }
    ],
    requireInteraction: true
  });
});

// ── Acción al hacer clic en la notificación (nivel raíz, se registra una sola vez) ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'cerrar') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const origen = self.location.origin;

      for (const client of clientList) {
        if (client.url.startsWith(origen) && 'focus' in client) {
          client.postMessage({ type: 'ABRIR_ADMIN_PANEL' });
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow('/index.html?tab=admin');
      }
    })
  );
});
