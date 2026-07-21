import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getStorage, setStorage } from "../utils/storage";
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
  const [toasts, setToasts] = useState([]);
  const [history, setHistory] = useState(() => getStorage(HISTORY_KEY) || []);
  const [permission, setPermission] = useState(() => getPermission());

  useEffect(() => {
    setStorage(HISTORY_KEY, history.slice(0, MAX_HISTORY));
  }, [history]);

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
