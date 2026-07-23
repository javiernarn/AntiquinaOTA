import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getUserStorage, setUserStorage } from "../utils/storage";
import { useAuth } from "../hooks/useAuth";
import {
  fireSystemNotification,
  getPermission,
  requestPermission,
} from "../utils/notifications";
import { uid } from "../utils/time";
import { registerDeviceForPush } from "../utils/cloudSync";

const HISTORY_KEY = "notifications-v1";
const MAX_HISTORY = 40;
const TOAST_LIFETIME_MS = 6000;

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  // Same account-scoping as the logbook data — otherwise Trainee B signing
  // in would see Trainee A's notification history (and vice versa).
  const userId = user?.sub || user?.email || null;

  const [toasts, setToasts] = useState([]);
  const [history, setHistory] = useState([]);
  const [permission, setPermission] = useState(() => getPermission());

  // Load (and reload, if a different account signs in) this account's
  // notification history.
  useEffect(() => {
    setHistory(userId ? getUserStorage(HISTORY_KEY, userId) || [] : []);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setUserStorage(HISTORY_KEY, userId, history.slice(0, MAX_HISTORY));
  }, [history, userId]);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markAllRead = useCallback(() => {
    setHistory((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  const notify = useCallback((notification) => {
    const item = {
      id: uid(),
      type: notification.type || "info",
      title: notification.title,
      message: notification.message || "",
      time: new Date().toISOString(),
      read: false,
    };

    setToasts((prev) => [...prev, item]);
    setHistory((prev) => [item, ...prev].slice(0, MAX_HISTORY));

    if (notification.system) {
      fireSystemNotification(item.title, item.message, notification.tag);
    }

    window.setTimeout(() => dismissToast(item.id), TOAST_LIFETIME_MS);
    return item.id;
  }, [dismissToast]);

  // Re-register for push on every load — not just right after sign-in.
  // Firebase Auth's own session survives a page reload (it persists to
  // IndexedDB independently of this app's local session), so a returning,
  // already-signed-in trainee should still get their device token
  // refreshed without having to sign out and back in.
  useEffect(() => {
    if (!userId) return;
    registerDeviceForPush();
  }, [userId]);

  // A push that arrives while this tab is open and focused is delivered
  // straight to the page (not the service worker) — show it the same way
  // as any other in-app notification.
  useEffect(() => {
    function onCloudPush(e) {
      if (!e.detail?.title) return;
      notify({ type: "info", title: e.detail.title, message: e.detail.message || "" });
    }
    window.addEventListener("cloud-push", onCloudPush);
    return () => window.removeEventListener("cloud-push", onCloudPush);
  }, [notify]);

  const enableSystemNotifications = useCallback(async () => {
    const result = await requestPermission();
    setPermission(result);
    return result;
  }, []);

  const unreadCount = useMemo(() => history.filter((n) => !n.read).length, [history]);

  const value = useMemo(
    () => ({
      toasts,
      history,
      unreadCount,
      permission,
      notify,
      dismissToast,
      markAllRead,
      clearHistory,
      enableSystemNotifications,
    }),
    [toasts, history, unreadCount, permission, notify, dismissToast, markAllRead, clearHistory, enableSystemNotifications]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within a NotificationProvider");
  return ctx;
}
