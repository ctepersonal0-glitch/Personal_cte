// ==================== firebase-messaging-sw.js ====================
// PASO 3: Archivo obligatorio para notificaciones en segundo plano
// DEBE estar en la RAÍZ del servidor (mismo nivel que index.html)

// ⚠️ REEMPLAZA con los datos de tu proyecto Firebase (igual que en index.html)
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey : "AIzaSyDUg4382VkkbP4CB9YV2wASS0bc9WEcM-U" , 
  authDomain : "cte-sistema-53d3e.firebaseapp.com" , 
  ID del proyecto : "cte-sistema-53d3e" , 
  storageBucket : "cte-sistema-53d3e.firebasestorage.app" , 
  messagingSenderId : "863608060086" , 
  appId : "1:863608060086:web:1accb8e23ca865b06f0e17" 
});

const messaging = firebase.messaging();

// Manejar notificaciones cuando la app está en segundo plano o cerrada
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Notificación en segundo plano:', payload);

  const { title, body, icon } = payload.notification || {};
  
  self.registration.showNotification(title || 'NUEVA SOLICITUD CTE', {
    body: body || 'Hay una nueva solicitud de registro pendiente.',
    icon: icon || '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'cte-solicitud-' + Date.now(),
    data: payload.data,
    actions: [
      { action: 'abrir', title: '📋 Ver solicitud' },
      { action: 'cerrar', title: '✕ Cerrar' }
    ],
    requireInteraction: true // La notificación permanece hasta que el admin la toca
  });
});

// Acción al hacer clic en la notificación
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'abrir' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('index.html') && 'focus' in client) {
            client.focus();
            client.postMessage({ type: 'ABRIR_ADMIN_PANEL' });
            return;
          }
        }
        clients.openWindow('/index.html?tab=admin');
      })
    );
  }
});
