// Same logic as functions/index.js, just running as a Vercel serverless
// function instead of a Firebase Cloud Function — so it works on
// Firebase's free "Spark" plan with no credit card, using Vercel's own
// free cron/serverless tier instead of Blaze.
//
// Trigger: an outside cron service (see PUSH_NOTIFICATIONS_SETUP.md §3b)
// hits /api/send-reminders every few minutes. This file does the actual
// "who needs a reminder right now" work.

import admin from "firebase-admin";

const TIMEZONE = "Asia/Manila";

const LUNCH_OUT_AT = 12 * 60;
const LUNCH_RESUME_AT = 13 * 60;
const PM_END_AT = 17 * 60;
const EV_END_AT = 20 * 60;

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
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date);
}

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

function pickReminder({ activeSession, clients, lastClientId, nowMin, wd, alreadySent }) {
  if (!activeSession) {
    const client = (clients || []).find((c) => c.id === lastClientId);
    if (!client || !Array.isArray(client.days) || !client.days.includes(wd)) return null;
    const startMin = toMinutes(client.timeIn);
    if (startMin === null || alreadySent.preShift) return null;
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

function getAdminApp() {
  if (admin.apps.length) return admin.app();
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_B64 env var");
  const serviceAccount = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  return admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

async function sendToUser(db, messaging, uid, reminder) {
  const devicesSnap = await db.collection("users").doc(uid).collection("devices").get();
  const tokens = devicesSnap.docs.map((d) => d.id);
  if (!tokens.length) return;

  const resp = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: reminder.title, body: reminder.body },
    data: { tag: reminder.flagKey, url: "/logbook" },
    webpush: { fcmOptions: { link: "/logbook" } },
  });

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

export async function runReminderScan() {
  const app = getAdminApp();
  const db = app.firestore();
  const messaging = app.messaging();

  const now = new Date();
  const nowMin = nowMinutes(now);
  const today = todayStr(now);
  const wd = weekday(now);

  const usersSnap = await db.collection("users").get();
  let evaluated = 0;
  let sent = 0;

  await Promise.all(
    usersSnap.docs.map(async (userDoc) => {
      evaluated++;
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
      await sendToUser(db, messaging, uid, reminder);
      sent++;
    })
  );

  return { evaluated, sent, at: now.toISOString() };
}
