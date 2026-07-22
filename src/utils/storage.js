// Wrapper around the app's persistence layer.
//
// Two things layered on top of a plain key/value store:
//
// 1. PER-USER NAMESPACING. Every OJT trainee's duty log, milestones, and
//    notification history is kept under a key scoped to *their* Google
//    account (`sub`, falling back to `email`). Without this, every signed-in
//    user on the same browser/device shared the exact same storage keys —
//    so Trainee B signing in after Trainee A would see (and silently
//    overwrite) Trainee A's hours. See getUserKey / getUserStorage below.
//
// 2. ENCRYPTION AT REST via react-secure-storage. Plain localStorage is
//    readable by anyone with access to the device (devtools, browser
//    extensions, another person using the same computer). react-secure-
//    storage transparently AES-encrypts every value before it touches
//    localStorage and decrypts on read, using the same get/set/removeItem
//    shape as localStorage, so this file's public functions didn't need to
//    change at all.
//    NOTE: this protects data sitting on disk, not data in a logged-in,
//    unlocked browser session — anyone with the page open can still read
//    it through the app UI itself. It also isn't a substitute for the
//    per-user namespacing above.
//
// Every write is still duplicated to a redundant backup key, so a single
// corrupted or partially-cleared entry can self-heal from its twin instead
// of silently coming back as "no data". This does NOT protect against the
// browser deleting all site storage outright (e.g. a private/incognito
// window being closed) — see isStorageAvailable() for detecting that case.

import secureLocalStorage from "react-secure-storage";

const PREFIX = "ojt_";
const BACKUP_SUFFIX = "__backup";

// react-secure-storage exposes the same getItem/setItem/removeItem shape as
// window.localStorage, so it's a drop-in swap. If the package hasn't been
// installed yet (`npm install` not run since this change), fall back to
// plain localStorage rather than crashing the whole app.
const backingStore = secureLocalStorage && typeof secureLocalStorage.getItem === "function"
  ? secureLocalStorage
  : (typeof localStorage !== "undefined" ? localStorage : null);

function safeParse(raw) {
  // react-secure-storage already returns parsed JS values (it does its own
  // JSON.stringify/parse around the encrypted payload), but plain
  // localStorage in the fallback path returns a raw string — handle both.
  // Objects/arrays, booleans, and numbers all come back pre-parsed from
  // react-secure-storage — only `undefined` (missing) and raw JSON
  // strings (the plain-localStorage fallback path) need special handling.
  if (raw !== null && (typeof raw === "object" || typeof raw === "boolean" || typeof raw === "number")) {
    return { ok: true, value: raw };
  }
  if (typeof raw !== "string") return { ok: false, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, value: undefined };
  }
}

export function getStorage(key) {
  try {
    const raw = backingStore.getItem(PREFIX + key);
    if (raw !== null && raw !== undefined) {
      const parsed = safeParse(raw);
      if (parsed.ok) return parsed.value;
    }
  } catch (e) {
    // fall through to backup
  }

  // Primary copy is missing or corrupted — recover from the backup copy.
  try {
    const rawBackup = backingStore.getItem(PREFIX + key + BACKUP_SUFFIX);
    if (rawBackup !== null && rawBackup !== undefined) {
      const parsedBackup = safeParse(rawBackup);
      if (parsedBackup.ok) {
        try {
          backingStore.setItem(PREFIX + key, parsedBackup.value); // heal the primary
        } catch (e) {}
        return parsedBackup.value;
      }
    }
  } catch (e) {}

  return null;
}

export function setStorage(key, value) {
  let ok = false;
  try {
    backingStore.setItem(PREFIX + key, value);
    ok = true;
  } catch (e) {
    ok = false;
  }

  // Best-effort redundant copy — failure here shouldn't fail the whole write.
  try {
    backingStore.setItem(PREFIX + key + BACKUP_SUFFIX, value);
  } catch (e) {}

  return ok;
}

export function removeStorage(key) {
  try {
    backingStore.removeItem(PREFIX + key);
    backingStore.removeItem(PREFIX + key + BACKUP_SUFFIX);
    return true;
  } catch (e) {
    return false;
  }
}

// Detects storage that's disabled, full, or otherwise non-functional — e.g.
// Safari private browsing (which throws on write) or a full quota.
export function isStorageAvailable() {
  try {
    const testKey = PREFIX + "__probe__";
    backingStore.setItem(testKey, "1");
    backingStore.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------
// Per-user namespacing
// ---------------------------------------------------------------------

// Turns a base key like "logbook-v2" into an account-scoped key like
// "logbook-v2::u_104920384..." so two different Google accounts signed in
// on the same browser never read or write each other's data. `userId`
// should be a stable per-account identifier — the Google `sub` claim
// (preferred) or the account email as a fallback.
export function getUserKey(base, userId) {
  return userId ? `${base}::u_${userId}` : base;
}

// One-time, best-effort migration for browsers that already have data
// saved under the OLD, un-namespaced key from before accounts were
// separated. The first account that signs in after this update inherits
// whatever was sitting in the shared key (which may be a mix of whichever
// trainees used this browser before); every account after that starts
// clean, since the legacy key is deleted the moment it's copied over.
//
// This does not attempt to guess which trainee the legacy data "really"
// belongs to — if it migrates to the wrong person's account, sign out of
// that account and clear the site's storage to reset.
export function migrateLegacyIfNeeded(base, userId) {
  if (!userId) return;
  const namespacedKey = PREFIX + getUserKey(base, userId);
  const legacyKey = PREFIX + base;
  try {
    const existingNamespaced = backingStore.getItem(namespacedKey);
    const legacyRaw = backingStore.getItem(legacyKey);
    const alreadyHasNamespacedData = existingNamespaced !== null && existingNamespaced !== undefined;
    if (!alreadyHasNamespacedData && legacyRaw !== null && legacyRaw !== undefined) {
      backingStore.setItem(namespacedKey, legacyRaw);
      backingStore.setItem(namespacedKey + BACKUP_SUFFIX, legacyRaw);
      backingStore.removeItem(legacyKey);
      backingStore.removeItem(legacyKey + BACKUP_SUFFIX);
    }
  } catch (e) {
    // best-effort only — if this fails, the account just starts empty
    // instead of inheriting old shared data, which is the safer failure mode
  }
}

// Convenience wrappers that combine namespacing + migration so call sites
// don't need to remember both steps.
export function getUserStorage(base, userId) {
  migrateLegacyIfNeeded(base, userId);
  return getStorage(getUserKey(base, userId));
}

export function setUserStorage(base, userId, value) {
  return setStorage(getUserKey(base, userId), value);
}

export function removeUserStorage(base, userId) {
  return removeStorage(getUserKey(base, userId));
}
