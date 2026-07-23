// Firebase Cloud Messaging background handler.
//
// This is a SEPARATE service worker from sw.js (the app-shell/offline one).
// FCM requires its own worker at a fixed path, but a page can have more
// than one service worker registered at once as long as their scopes don't
// collide — sw.js stays registered at "/" for offline/installability, and
// this one is registered for push only. Nothing here touches caching.
//
// Vite doesn't process files under /public, so this file can't read
// import.meta.env — the Firebase config is instead passed as query-string
// params on the registration URL (see src/utils/cloudSync.js) and picked
// back up here via self.location.search.

importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

const params = new URLSearchParams(self.location.search);
firebase.initializeApp({
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  storageBucket: params.get("storageBucket"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
});

const messaging = firebase.messaging();

// Fires when a push arrives while no tab has focus (app closed, phone
// locked, etc). Foreground pushes are instead handled in-app by
// onForegroundMessage() in cloudSync.js, so this only needs the
// background case — showing the plain OS notification.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || "OJT reminder";
  const body = payload.notification?.body || payload.data?.body || "";
  const tag = payload.data?.tag || "ojt-reminder";

  self.registration.showNotification(title, {
    body,
    tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-32.png",
    data: { url: payload.data?.url || "/" },
  });
});

// Focus (or open) the app when the notification is tapped.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
