// Thin wrapper around the browser Notification API so the rest of the app
// never has to worry about missing support or unresolved permission.

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getPermission() {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

export async function requestPermission() {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch (e) {
    return "denied";
  }
}

export function fireSystemNotification(title, body, tag) {
  if (!notificationsSupported()) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      tag,
      icon: undefined,
    });
  } catch (e) {
    // Some browsers (mostly mobile) throw on direct construction — safe to ignore,
    // the in-app toast still carries the message.
  }
}
