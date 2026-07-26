import React, { useEffect, useRef, useState } from "react";
import { Bell, BellRing, Trash2, X } from "lucide-react";
import { useNotifications } from "../context/NotificationContext";

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function NotificationBell() {
  const { history, unreadCount, markAllRead, clearHistory, permission, enableSystemNotifications } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next) markAllRead();
      return next;
    });
  }

  return (
    <div className="notif-bell" ref={ref}>
      <button className="bell-btn" onClick={toggle} aria-label="Notifications">
        {unreadCount > 0 ? <BellRing size={18} /> : <Bell size={18} />}
        {unreadCount > 0 && <span className="bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <span>Notifications</span>
            <button className="icon-btn" onClick={clearHistory} aria-label="Clear all">
              <Trash2 size={13} />
            </button>
          </div>

          {permission !== "granted" && permission !== "unsupported" && (
            <button className="notif-permission" onClick={enableSystemNotifications}>
              Turn on desktop alerts for milestones and clock-outs
            </button>
          )}

          <div className="notif-list">
            {history.length === 0 && <div className="notif-empty">Nothing yet — your milestones will show up here.</div>}
            {history.map((n) => (
              <div className={`notif-item type-${n.type}`} key={n.id}>
                <div className="notif-item-title">{n.title}</div>
                {n.message && <div className="notif-item-msg">{n.message}</div>}
                <div className="notif-item-time">{timeAgo(n.time)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ToastStack() {
  const { toasts, dismissToast } = useNotifications();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div className={`toast type-${t.type}`} key={t.id}>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message && <div className="toast-msg">{t.message}</div>}
          </div>
          <button className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
