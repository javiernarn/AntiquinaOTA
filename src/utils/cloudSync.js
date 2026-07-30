// Everything needed to make server-side (Cloud Functions) push
// notifications possible, kept in one file so the rest of the app only
// needs a handful of calls:
//
//   signInToCloud(idToken)   — once, right after Google sign-in succeeds
//   registerDeviceForPush()  — once per device, after sign-in (asks for
//                               Notification permission)
//   syncClients(list, lastId)— whenever the host-client list or the
//                               "most recent client" changes
//
// If Firebase isn't configured (no .env values set), every export below is
// a safe no-op — the app behaves exactly as it did before this feature.

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { getToken, onMessage } from "firebase/messaging";
import { auth, db, firebaseEnabled, getMessagingIfSupported, VAPID_KEY } from "../firebase";

let currentUid = null;
let currentDeviceToken = null;
let authReadyResolve;
const authReady = new Promise((resolve) => {
  authReadyResolve = resolve;
});

if (auth) {
  onAuthStateChanged(auth, (u) => {
    currentUid = u?.uid || null;
    authReadyResolve(currentUid);
  });
} else {
  authReadyResolve(null);
}

// On a fresh page load, Firebase restores its persisted session from
// IndexedDB asynchronously — so right after mount, auth.currentUser can
// still be null even though the person is signed in. Anything that needs
// to know "are we signed in yet" (device registration on app reload)
// should await this once instead of racing it.
async function waitForAuthReady() {
  return authReady;
}

// --- Auth -------------------------------------------------------------
// The app already gets a Google ID token from GoogleSignInButton (via
// Google Identity Services). Firebase Auth accepts that same token
// directly, so no separate Firebase login screen/popup is needed — this
// silently upgrades the existing sign-in into a verified Firebase Auth
// session, whose uid (== the Google `sub`) is what Firestore security
// rules check against.
export async function signInToCloud(idToken) {
  if (!firebaseEnabled || !idToken) return null;
  try {
    const credential = GoogleAuthProvider.credential(idToken);
    const result = await signInWithCredential(auth, credential);
    currentUid = result.user.uid;
    return result.user.uid;
  } catch (e) {
    console.warn("Cloud sign-in failed — push notifications will stay off for this session.", e);
    return null;
  }
}

// Fully signs the device out of the cloud side: deregisters this
// browser's push token from the account that's signing out (so this
// device stops receiving THAT account's reminders), then ends the
// Firebase Auth session.
//
// The deregister step has to happen BEFORE firebaseSignOut() — once
// signed out, Firestore security rules will reject a delete against
// users/{uid}/devices/{token} because request.auth no longer matches
// that uid. Skipping this order (or skipping this step entirely, as the
// old code did) is exactly what let a phone keep receiving a previous
// account's reminders after switching to a different Google account on
// the same device: FCM tokens belong to the browser + service worker,
// not to whichever account happens to be signed in, so an old token left
// registered under the old account just... keeps working.
export async function signOutOfCloud() {
  if (!firebaseEnabled) return;
  const uid = uidOrNull();
  if (uid && currentDeviceToken) {
    try {
      await deleteDoc(doc(db, "users", uid, "devices", getOrCreateDeviceId()));
    } catch (e) {
      // Non-fatal — proceed with sign-out either way. Worst case, a
      // human clears it later, or removeDeviceToken's FCM-side cleanup
      // (invalid-token pruning in reminderScan.js) catches it eventually.
    }
  }
  try {
    await firebaseSignOut(auth);
  } catch (e) {
    // ignore
  }
  currentUid = null;
  currentDeviceToken = null;
}

function uidOrNull() {
  return currentUid || auth?.currentUser?.uid || null;
}

// FCM tokens rotate over time (browser cache clears, PWA reinstalls, OS
// updates, etc). If we keyed each device's Firestore doc by the token
// itself, every rotation would leave the OLD token doc behind — still
// valid, still receiving pushes — while a new doc got created for the
// new token. Over months that silently piles up several live tokens for
// the SAME physical device, and reminderScan.js's sendToUser() (which
// pushes to every token it finds) ends up firing the same reminder 2-4x
// on one phone.
//
// To prevent that, each browser gets ONE stable, locally-generated device
// id (persisted in localStorage) that's used as the Firestore doc id
// instead of the token. Re-registering — even with a brand-new token —
// just overwrites that same doc rather than creating a new one.
const DEVICE_ID_KEY = "occ-push-device-id";
function getOrCreateDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch (e) {
    // localStorage unavailable (private mode, etc) — fall back to an
    // in-memory id; worst case this tab re-registers as "new" next load.
    return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

// --- Device / push token registration ----------------------------------
// Registers this browser tab's service worker for FCM, requests
// Notification permission if needed, and stores the resulting token under
// users/{uid}/devices/{deviceId} (a stable per-browser id, NOT the token
// itself — see getOrCreateDeviceId() above) so the scheduler knows where
// to push. Safe to call every time the app loads — re-registering just
// overwrites this device's one doc.
export async function registerDeviceForPush() {
  if (!firebaseEnabled) return "unsupported";
  const uid = uidOrNull() || (await waitForAuthReady());
  if (!uid) return "signed-out";
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return "unsupported";

  const messaging = await getMessagingIfSupported();
  if (!messaging) return "unsupported";

  if (Notification.permission === "default") {
    const result = await Notification.requestPermission();
    if (result !== "granted") return result;
  }
  if (Notification.permission !== "granted") return Notification.permission;

  try {
    const cfg = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
    const qs = new URLSearchParams(cfg).toString();
    const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${qs}`);

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return "denied";
    currentDeviceToken = token;
    const deviceId = getOrCreateDeviceId();

    await setDoc(
      doc(db, "users", uid, "devices", deviceId),
      {
        token,
        platform: navigator.platform || "web",
        userAgent: navigator.userAgent,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // While this tab is open and focused, FCM delivers here instead of to
    // the service worker — show the same in-app toast path the rest of
    // the app already uses (wired up by the caller via `onNotify`).
    onMessage(messaging, (payload) => {
      window.dispatchEvent(
        new CustomEvent("cloud-push", {
          detail: {
            title: payload.notification?.title || payload.data?.title,
            message: payload.notification?.body || payload.data?.body,
          },
        })
      );
    });

    return "granted";
  } catch (e) {
    console.warn("Push registration failed.", e);
    return "error";
  }
}

// --- Session / schedule mirroring ---------------------------------------
// The scheduler (Cloud Functions) can't read the browser's local
// storage, so the small slice of state it actually needs — the
// host-client list, and which client the trainee most recently logged
// hours under — gets mirrored to Firestore whenever it changes. Everything
// else (full entry history, PDFs, etc.) stays local-only.
export async function syncClients(clients, lastClientId) {
  if (!firebaseEnabled) return;
  const uid = uidOrNull();
  if (!uid) return;
  try {
    await setDoc(
      doc(db, "users", uid),
      { clients: clients || [], lastClientId: lastClientId || null },
      { merge: true }
    );
  } catch (e) {
    console.warn("Client-schedule sync failed (push reminders may lag).", e);
  }
}

export async function removeDeviceToken(token) {
  if (!firebaseEnabled) return;
  const uid = uidOrNull();
  if (!uid || !token) return;
  try {
    await deleteDoc(doc(db, "users", uid, "devices", token));
  } catch (e) {
    // Non-fatal — a stale token just means one extra (harmless) send attempt later.
  }
}