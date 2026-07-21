// Small wrapper around localStorage that's a bit more resilient than a bare
// getItem/setItem: every write is duplicated to a redundant backup key, so a
// single corrupted or partially-cleared entry can self-heal from its twin
// instead of silently coming back as "no data". This does NOT protect against
// the browser deleting all site storage outright (e.g. a private/incognito
// window being closed) — see isStorageAvailable() for detecting that case.

const PREFIX = "ojt_";
const BACKUP_SUFFIX = "__backup";

function safeParse(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, value: undefined };
  }
}

export function getStorage(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw !== null) {
      const parsed = safeParse(raw);
      if (parsed.ok) return parsed.value;
    }
  } catch (e) {
    // fall through to backup
  }

  // Primary copy is missing or corrupted — recover from the backup copy.
  try {
    const rawBackup = localStorage.getItem(PREFIX + key + BACKUP_SUFFIX);
    if (rawBackup !== null) {
      const parsedBackup = safeParse(rawBackup);
      if (parsedBackup.ok) {
        try {
          localStorage.setItem(PREFIX + key, rawBackup); // heal the primary
        } catch (e) {}
        return parsedBackup.value;
      }
    }
  } catch (e) {}

  return null;
}

export function setStorage(key, value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (e) {
    return false;
  }

  let ok = false;
  try {
    localStorage.setItem(PREFIX + key, serialized);
    ok = true;
  } catch (e) {
    ok = false;
  }

  // Best-effort redundant copy — failure here shouldn't fail the whole write.
  try {
    localStorage.setItem(PREFIX + key + BACKUP_SUFFIX, serialized);
  } catch (e) {}

  return ok;
}

export function removeStorage(key) {
  try {
    localStorage.removeItem(PREFIX + key);
    localStorage.removeItem(PREFIX + key + BACKUP_SUFFIX);
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
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}
