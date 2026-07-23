// Central Firebase bootstrap. Every value here comes from env vars so the
// same code works against your dev and prod Firebase projects without
// edits — see .env.example for what to fill in, and SETUP.md for where
// each value comes from in the Firebase console.
//
// This file intentionally does NOT throw if the config is missing — the
// rest of the app (local logbook, PDF export, etc.) must keep working even
// on a machine that hasn't been wired up for push notifications yet. Every
// consumer of `auth` / `db` / `getMessagingIfSupported()` checks for null.

import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { isSupported as messagingIsSupported, getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const app = firebaseEnabled
  ? getApps()[0] || initializeApp(firebaseConfig)
  : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

// getMessaging() throws in browsers/contexts that don't support the Push
// API (Safari on iOS below 16.4, non-HTTPS localhost variants, etc.), so
// this is async and safe to call anywhere.
let messagingPromise = null;
export function getMessagingIfSupported() {
  if (!app) return Promise.resolve(null);
  if (!messagingPromise) {
    messagingPromise = messagingIsSupported()
      .then((ok) => (ok ? getMessaging(app) : null))
      .catch(() => null);
  }
  return messagingPromise;
}

export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
