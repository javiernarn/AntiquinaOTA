import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getUserStorage, setUserStorage } from "../utils/storage";
import { useAuth } from "../hooks/useAuth";
import {
  fireSystemNotification,
  getPermission,
  requestPermission,
} from "../utils/notifications";
import { uid } from "../utils/time";

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
