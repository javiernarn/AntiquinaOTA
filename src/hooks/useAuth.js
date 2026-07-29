import { useCallback, useEffect, useState } from "react";
import { getStorage, setStorage, removeStorage } from "../utils/storage";

const SESSION_KEY = "session";

// How long a signed-in session stays valid before requiring sign-in again.
// Change this single value to adjust the timeout app-wide.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function readSession() {
  const raw = getStorage(SESSION_KEY);
  if (!raw) return null;
  if (raw.expiresAt && Date.now() > raw.expiresAt) {
    // Session has expired — clear it so the app doesn't come back signed in.
    removeStorage(SESSION_KEY);
    return null;
  }
  return raw;
}

export function useAuth() {
  const [user, setUser] = useState(readSession);

  const login = useCallback((profile) => {
    const now = Date.now();
    const session = { ...profile, issuedAt: now, expiresAt: now + SESSION_TTL_MS };
    setStorage(SESSION_KEY, session);
    setUser(session);
  }, []);

  const logout = useCallback(() => {
    removeStorage(SESSION_KEY);
    setUser(null);
  }, []);

  // Auto-expire the session: schedule a timer for whenever the TTL lapses,
  // and double-check whenever the tab comes back into view (covers the
  // device being asleep/backgrounded past the expiry timer's own accuracy).
  useEffect(() => {
    if (!user?.expiresAt) return undefined;

    const msLeft = user.expiresAt - Date.now();
    if (msLeft <= 0) {
      logout();
      return undefined;
    }

    const timer = setTimeout(logout, msLeft);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() > user.expiresAt) {
        logout();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user, logout]);

  return { user, isAuthenticated: !!user, login, logout };
}
