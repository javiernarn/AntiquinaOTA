// Server-side reminder scheduler.
//
// This is the "outside the app" half of the notification system. It's a
// deliberate mirror of the timing rules already in
// src/pages/Logbook/LogbookPage.jsx (pre-shift, lunch-out, lunch-ending,
// lunch-resume, end-of-day) — same minute boundaries, same 10-minute
// heads-up window — but running on a server clock instead of the
// trainee's open browser tab, so it can push a real OS notification to
// their phone whether the app is open, backgrounded, or fully closed.
//
// It reads only the small slice of state the client mirrors to Firestore
// (users/{uid}.activeSession, .clients, .lastClientId) — see
// src/utils/cloudSync.js for the client side of that mirror. Full entry
// history / logbook data never leaves the trainee's device.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

const TIMEZONE = "Asia/Manila";

const LUNCH_OUT_AT = 12 * 60; // 12:00 PM
const LUNCH_RESUME_AT = 13 * 60; // 1:00 PM
const PM_END_AT = 17 * 60; // 5:00 PM fallback (no host client assigned)
const EV_END_AT = 20 * 60; // 8:00 PM

const PRESHIFT_BEFORE_MIN = 10;
const LUNCH_REMINDER_BEFORE_MIN = 10;
const SHIFT_END_BEFORE_MIN = 10;

function nowMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour").value);
  const m = Number(parts.find((p) => p.type === "minute").value);
  return h * 60 + m;
}

function todayStr(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date); // YYYY-MM-DD
}

// 1=Mon … 7=Sun, matching src/utils/schedule.js's WEEKDAYS.
function weekday(date) {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(date);
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[short];
}

function toMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== "string" || !hhmm.includes(":")) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function formatTime12(hhmm) {
  const mins = toMinutes(hhmm);
  if (mins === null) return hhmm;
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Decides whether *this* user should get a push right now, and which one.
// Returns { title, body, flagKey } or null.
function pickReminder({ activeSession, clients, lastClientId, nowMin, wd, alreadySent }) {
  if (!activeSession) {
    const client = (clients || []).find((c) => c.id === lastClientId);
    if (!client || !Array.isArray(client.days) || !client.days.includes(wd)) return null;
    const startMin = toMinutes(client.timeIn);
    if (startMin === null) return null;
    if (alreadySent.preShift) return null;
    if (nowMin >= startMin - PRESHIFT_BEFORE_MIN && nowMin < startMin) {
      const left = startMin - nowMin;
      return {
        flagKey: "preShift",
        title: "Your OJT shift starts soon",
        body: `${client.name} starts at ${formatTime12(client.timeIn)} — about ${left} minute${left === 1 ? "" : "s"} left.`,
      };
    }
    return null;
  }

  if (activeSession.phase === "lunch" && !alreadySent.lunchReminder) {
    if (nowMin >= LUNCH_RESUME_AT - LUNCH_REMINDER_BEFORE_MIN && nowMin < LUNCH_RESUME_AT) {
      const left = LUNCH_RESUME_AT - nowMin;
      return {
        flagKey: "lunchReminder",
        title: "Lunch ending soon",
        body: `Your Afternoon time-in starts in ${left} minute${left === 1 ? "" : "s"} (1:00 PM).`,
      };
    }
    return null;
  }

  if (activeSession.phase === "pm" && !alreadySent.shiftEnd) {
    const client = (clients || []).find((c) => c.id === activeSession.client);
    const dayEndMin = client ? toMinutes(client.timeOut) ?? PM_END_AT : PM_END_AT;
    if (nowMin >= dayEndMin - SHIFT_END_BEFORE_MIN && nowMin < dayEndMin) {
      return {
        flagKey: "shiftEnd",
        title: "Your shift is ending soon",
        body: `Don't forget to clock out — ends at ${formatTime12(client ? client.timeOut : "17:00")}.`,
      };
    }
    return null;
  }

  if (activeSession.phase === "ev" && !alreadySent.shiftEndEv) {
    if (nowMin >= EV_END_AT - SHIFT_END_BEFORE_MIN && nowMin < EV_END_AT) {
      return {
        flagKey: "shiftEndEv",
        title: "Your evening shift is ending soon",
        body: "Don't forget to clock out — ends at 8:00 PM.",
      };
    }
    return null;
  }

  return null;
}

async function sendToUser(uid, reminder) {
  const devicesSnap = await db.collection("users").doc(uid).collection("devices").get();
  const tokens = devicesSnap.docs.map((d) => d.id);
  if (!tokens.length) return;

  const resp = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: reminder.title, body: reminder.body },
    data: { tag: reminder.flagKey, url: "/logbook" },
    webpush: { fcmOptions: { link: "/logbook" } },
  });

  // Prune tokens the client no longer holds (uninstalled, permission
  // revoked, etc.) so the device list doesn't grow unbounded.
  await Promise.all(
    resp.responses.map((r, i) => {
      const badToken =
        !r.success &&
        (r.error?.code === "messaging/registration-token-not-registered" ||
          r.error?.code === "messaging/invalid-registration-token");
      if (!badToken) return null;
      return db.collection("users").doc(uid).collection("devices").doc(tokens[i]).delete().catch(() => {});
    })
  );
}

// Runs every minute. Firestore reads scale with user count — fine at OJT-
// batch scale (tens to low hundreds of trainees); if this ever needs to
// scale to thousands, switch to a collection-group query filtered by an
// indexed "hasActiveScheduleToday" field instead of scanning every user.
exports.scheduledReminders = onSchedule(
  { schedule: "every 1 minutes", timeZone: TIMEZONE },
  async () => {
    const now = new Date();
    const nowMin = nowMinutes(now);
    const today = todayStr(now);
    const wd = weekday(now);

    const usersSnap = await db.collection("users").get();

    await Promise.all(
      usersSnap.docs.map(async (userDoc) => {
        const uid = userDoc.id;
        const data = userDoc.data() || {};

        const notifyStateRef = db.collection("users").doc(uid).collection("notifyState").doc(today);
        const notifyStateSnap = await notifyStateRef.get();
        const alreadySent = notifyStateSnap.exists ? notifyStateSnap.data() : {};

        const reminder = pickReminder({
          activeSession: data.activeSession || null,
          clients: data.clients || [],
          lastClientId: data.lastClientId || null,
          nowMin,
          wd,
          alreadySent,
        });
        if (!reminder) return;

        await notifyStateRef.set({ [reminder.flagKey]: true }, { merge: true });
        await sendToUser(uid, reminder);
      })
    );

    return null;
  }
);
