// Same reminder logic as a Firebase Cloud Function would run, just living
// here as a plain function instead — so it works on Firebase's free
// "Spark" plan with no billing card attached at all. Reading Firestore and
// sending FCM pushes through the Admin SDK doesn't require Blaze; only
// Cloud Functions + Cloud Scheduler do. This file gets invoked by
// api/send-reminders.js, which an outside free cron service calls on a
// schedule (see the setup steps in the project README / chat instructions).
//
// IMPORTANT: this only ever reads `clients` + `lastClientId` from Firestore
// (the two fields cloudSync.js's syncClients() actually writes). There is
// no server-side concept of a "live session" — the app never mirrors an
// activeSession/phase to Firestore, so nothing here depends on one. Every
// reminder below is derived purely from the trainee's current host
// client's own schedule (days / timeIn / timeOut), the same source the
// pre-shift reminder already used. That's what lets a checkpoint like
// "Lunch out" or "Afternoon out" re-fire correctly every scheduled day
// without any extra state from the app itself.

import admin from "firebase-admin";

const TIMEZONE = "Asia/Manila";

const LUNCH_OUT_AT = 12 * 60; // 12:00 PM
const LUNCH_RESUME_AT = 13 * 60; // 1:00 PM
const AFTERNOON_END_AT = 17 * 60; // 5:00 PM — boundary between "Afternoon" and "Evening" labels

// How many minutes ahead of each checkpoint the reminder should go out.
const PRESHIFT_BEFORE_MIN = 10; // day start ("Morning/Afternoon/Evening in")
const LUNCH_OUT_BEFORE_MIN = 10; // before lunch break starts (12:00 PM)
const LUNCH_IN_BEFORE_MIN = 5; // before lunch break ends / afternoon resumes (1:00 PM)
const DAY_END_BEFORE_MIN = 10; // before the client's own timeOut

// How late (in minutes, past the "before" threshold) a checkpoint is still
// allowed to fire if the cron service ran a little late or its interval
// drifted. Without this, a 5-minute "before" window checked by a cron that
// ticks every 5 minutes (like cron-job.org's free tier) can slip past the
// window entirely and the reminder never goes out that day. This only ever
// widens the window backwards in time (still stops the moment the
// checkpoint itself has passed), so reminders never fire late.
const CRON_DRIFT_GRACE_MIN = 4;

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

function minsLeftLabel(left) {
  return `${left} minute${left === 1 ? "" : "s"}`;
}

// "Morning in" / "Lunch in" / "Afternoon in" / "Evening in" (or "... out")
// for a given clock-minute value, matching the exact field labels used in
// the Duty Log's own manual-entry form (see LogbookPage.jsx: "Morning in",
// "Lunch out", "Lunch in", "Afternoon out").
function segmentLabel(mins, isStart) {
  // Start-of-segment and end-of-segment boundaries aren't symmetric: a
  // shift that STARTS at exactly 5:00 PM is beginning an Evening shift,
  // but a shift that ENDS at exactly 5:00 PM just finished an Afternoon
  // one (5:00 PM is the last minute of "Afternoon", not the first minute
  // of "Evening" from the end side).
  if (isStart) {
    if (mins < LUNCH_OUT_AT) return "Morning in";
    if (mins < LUNCH_RESUME_AT) return "Lunch in";
    if (mins < AFTERNOON_END_AT) return "Afternoon in";
    return "Evening in";
  }
  if (mins <= LUNCH_OUT_AT) return "Morning out";
  if (mins <= LUNCH_RESUME_AT) return "Lunch out";
  if (mins <= AFTERNOON_END_AT) return "Afternoon out";
  return "Evening out";
}

// Is `nowMin` inside the pre-checkpoint window, allowing a little grace for
// cron drift, but never past the checkpoint itself?
function inWindow(nowMin, atMin, beforeMin) {
  return nowMin < atMin && nowMin >= atMin - beforeMin - CRON_DRIFT_GRACE_MIN;
}

// Builds today's checkpoint list for one host client, purely from that
// client's own recurring schedule — no live session state involved. A
// client whose hours don't cross the fixed 12:00–1:00 PM lunch break (e.g.
// a custom 1:00 PM–8:00 PM host) simply skips the two lunch checkpoints,
// matching how clientCoverage()/dailyHoursFor() in src/utils/schedule.js
// already reason about "does this client's day span lunch".
function checkpointsForClient(client, wd) {
  const inMin = toMinutes(client.timeIn);
  const outMin = toMinutes(client.timeOut);
  if (inMin === null || outMin === null || outMin <= inMin) return [];

  const spansLunch = inMin < LUNCH_OUT_AT && outMin > LUNCH_RESUME_AT;
  const checkpoints = [];

  const startLabel = segmentLabel(inMin, true);
  checkpoints.push({
    flagKey: "dayStart",
    atMin: inMin,
    beforeMin: PRESHIFT_BEFORE_MIN,
    build: (left) => ({
      title: `Your ${startLabel} will start soon`,
      body: `${client.name} — ${startLabel} at ${formatTime12(client.timeIn)}, in about ${minsLeftLabel(left)}.`,
    }),
  });

  if (spansLunch) {
    checkpoints.push({
      flagKey: "lunchOut",
      atMin: LUNCH_OUT_AT,
      beforeMin: LUNCH_OUT_BEFORE_MIN,
      build: (left) => ({
        title: "Your Lunch out will start soon",
        body: `Morning is wrapping up — Lunch out in about ${minsLeftLabel(left)} (12:00 PM).`,
      }),
    });
    checkpoints.push({
      flagKey: "lunchIn",
      atMin: LUNCH_RESUME_AT,
      beforeMin: LUNCH_IN_BEFORE_MIN,
      build: (left) => ({
        title: "Your Lunch in will start soon",
        body: `Lunch break is ending — Lunch in / Afternoon resumes in about ${minsLeftLabel(left)} (1:00 PM).`,
      }),
    });
  }

  const endLabel = segmentLabel(outMin, false);
  // Whether the client has duty tomorrow decides the tone/content of the
  // closing line: a mid-week day close reminds them to add tomorrow's
  // entry; the last scheduled day of their week (e.g. Friday for a
  // Mon–Fri client) instead congratulates them on the week, since there's
  // nothing to remind them about tomorrow. The app auto-fills the clock-out
  // time itself, so there's no "don't forget to clock out" action needed —
  // this is purely an encouraging heads-up, not a task reminder.
  const tomorrowWd = wd === 7 ? 1 : wd + 1;
  const hasDutyTomorrow = Array.isArray(client.days) && client.days.includes(tomorrowWd);
  checkpoints.push({
    flagKey: "dayEnd",
    atMin: outMin,
    beforeMin: DAY_END_BEFORE_MIN,
    build: (left) =>
      hasDutyTomorrow
        ? {
            title: "Almost done for today!",
            body: `${client.name} — ${endLabel} in about ${minsLeftLabel(left)} (${formatTime12(client.timeOut)}). Great work today — enjoy your rest, and don't forget to add tomorrow's day when your shift starts.`,
          }
        : {
            title: "You made it through the week!",
            body: `${client.name} — ${endLabel} in about ${minsLeftLabel(left)} (${formatTime12(client.timeOut)}). You've done well this week — congrats! Enjoy your rest, no duty tomorrow.`,
          },
  });

  return checkpoints;
}

// Returns every reminder due right now for this trainee (normally at most
// one — checkpoints are hours apart — but the shape supports more).
function pickReminders({ clients, lastClientId, nowMin, wd, alreadySent }) {
  const client = (clients || []).find((c) => c.id === lastClientId);
  if (!client || !Array.isArray(client.days) || !client.days.includes(wd)) return [];

  const due = [];
  for (const cp of checkpointsForClient(client, wd)) {
    if (alreadySent[cp.flagKey]) continue;
    if (!inWindow(nowMin, cp.atMin, cp.beforeMin)) continue;
    const left = Math.max(1, cp.atMin - nowMin);
    due.push({ flagKey: cp.flagKey, ...cp.build(left) });
  }
  return due;
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
  // Doc id is a stable per-browser device id (see getOrCreateDeviceId() in
  // cloudSync.js) — NOT the FCM token, which rotates. The actual token
  // lives in the doc's `token` field. Dedupe by token too, as a
  // belt-and-suspenders guard against any device docs left over from
  // before this change (which were keyed by token and would otherwise
  // still be able to duplicate a send alongside the new-style doc).
  const seenTokens = new Set();
  const entries = [];
  for (const d of devicesSnap.docs) {
    const token = d.data()?.token || d.id;
    if (!token || seenTokens.has(token)) continue;
    seenTokens.add(token);
    entries.push({ ref: d.ref, token });
  }
  if (!entries.length) return;

  const resp = await messaging.sendEachForMulticast({
    tokens: entries.map((e) => e.token),
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
      return entries[i].ref.delete().catch(() => {});
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

      const reminders = pickReminders({
        clients: data.clients || [],
        lastClientId: data.lastClientId || null,
        nowMin,
        wd,
        alreadySent,
      });
      if (!reminders.length) return;

      for (const reminder of reminders) {
        await notifyStateRef.set({ [reminder.flagKey]: true }, { merge: true });
        await sendToUser(db, messaging, uid, reminder);
        sent++;
      }
    })
  );

  return { evaluated, sent, at: now.toISOString() };
}