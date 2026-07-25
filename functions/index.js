// ---------------------------------------------------------------------------
// "Shift starting soon" push notifications — the server-side half of the
// reminder feature.
//
// The app (src/utils/cloudSync.js) already mirrors two things to Firestore
// for every signed-in trainee:
//   users/{uid}.clients          — their host-client list, each with
//                                  { id, name, days: [1..7], timeIn, timeOut }
//                                  exactly as set up on the "Host clients"
//                                  form (e.g. Private, Mon–Fri, 8:00 AM–5:00 PM)
//   users/{uid}.activeSession    — their current clock-in session, if any
//   users/{uid}/devices/{token}  — one doc per device registered for push
//
// This function runs on a fixed schedule, and for every trainee, every host
// client, every one of that client's scheduled days, checks whether "now"
// (Philippine time) is 20 minutes before that client's timeIn. If so — and
// the trainee hasn't already clocked in for that client today, and hasn't
// already been reminded today — it sends a real FCM push. That push is
// delivered by the OS (Android notification tray / iOS/desktop banner) via
// public/firebase-messaging-sw.js even if the app/browser is completely
// closed, which a plain in-page Notification() call (fireSystemNotification
// in src/utils/notifications.js) can't do — that one only fires while the
// tab is open, and is kept as an immediate same-tab fallback.
//
// Deploy: from the project root, `firebase deploy --only functions`.
// Requires the Blaze (pay-as-you-go) plan — Cloud Scheduler, which
// `onSchedule` runs on, isn't available on the free Spark plan. In
// practice, a few hundred trainees checked every 5 minutes costs a few
// cents a month; Firebase's free tier alone typically covers it.
// ---------------------------------------------------------------------------

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

// How far ahead of a client's timeIn to remind the trainee. Matches the
// in-app fallback reminder in LogbookPage.jsx (search "shift reminder").
const REMINDER_MINUTES_BEFORE = 20;

// This function runs on this cadence, and treats "due" as anywhere in the
// window [reminderMinute, reminderMinute + RUN_INTERVAL_MINUTES) so a run
// can't miss the exact minute a shift's reminder should fire.
const RUN_INTERVAL_MINUTES = 5;

function toMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function formatTime12(t) {
  const mins = toMinutes(t);
  if (mins === null) return "";
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${period}`;
}

// "Now" in Philippine time (Asia/Manila, UTC+8, no DST) — matches how the
// app itself anchors every clock reading (see src/utils/time.js's
// PH_TIME_ZONE comment for why: trainees' phones can be set to any locale/
// timezone, but everyone's OJT hours need to mean the same wall-clock time).
function phNow() {
  const now = new Date();
  const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const minutesSinceMidnight = ph.getUTCHours() * 60 + ph.getUTCMinutes();
  const isoWeekday = ph.getUTCDay() === 0 ? 7 : ph.getUTCDay(); // 1=Mon … 7=Sun
  const dateStr = ph.toISOString().slice(0, 10); // YYYY-MM-DD, Philippine calendar day
  return { minutesSinceMidnight, isoWeekday, dateStr };
}

async function sendRemindersForUser(uid, data, phState) {
  const clients = Array.isArray(data.clients) ? data.clients : [];
  if (!clients.length) return;

  const { minutesSinceMidnight: nowMin, isoWeekday, dateStr } = phState;
  const activeSession = data.activeSession || null;

  // Which of this trainee's host clients have a shift starting in
  // [now, now + interval) minus the 20-minute lead time, and are scheduled
  // to work today.
  const due = clients.filter((c) => {
    if (!c || !c.id || !Array.isArray(c.days) || !c.days.includes(isoWeekday)) return false;
    const startMin = toMinutes(c.timeIn);
    if (startMin === null) return false;
    const reminderAt = startMin - REMINDER_MINUTES_BEFORE;
    return nowMin >= reminderAt && nowMin < reminderAt + RUN_INTERVAL_MINUTES;
  });
  if (!due.length) return;

  // Skip anything already covered — either already reminded today, or
  // the trainee is already clocked in under that client today (no need to
  // nudge someone who's already on shift).
  const notifyRef = db.collection("users").doc(uid).collection("notifyState").doc(dateStr);
  const notifySnap = await notifyRef.get();
  const alreadySent = notifySnap.exists ? notifySnap.data().sentClientIds || [] : [];

  const toSend = due.filter((c) => {
    if (alreadySent.includes(c.id)) return false;
    if (activeSession && activeSession.date === dateStr && activeSession.client === c.id) return false;
    return true;
  });
  if (!toSend.length) return;

  const devicesSnap = await db.collection("users").doc(uid).collection("devices").get();
  const tokens = devicesSnap.docs.map((d) => d.id);
  if (!tokens.length) return; // no registered device, nothing to push to

  const sentClientIds = [];
  const staleTokens = [];

  for (const client of toSend) {
    const title = "Your OJT shift starts soon";
    const body = `${client.name} starts at ${formatTime12(client.timeIn)} — that's in about ${REMINDER_MINUTES_BEFORE} minutes. Don't forget to clock in.`;

    try {
      const res = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: { tag: `shift-reminder-${dateStr}-${client.id}`, url: "/" },
        webpush: { fcmOptions: { link: "/" } },
      });
      res.responses.forEach((r, i) => {
        if (!r.success && r.error?.code === "messaging/registration-token-not-registered") {
          staleTokens.push(tokens[i]);
        }
      });
      sentClientIds.push(client.id);
    } catch (e) {
      logger.error(`Push send failed for user ${uid}, client ${client.id}`, e);
    }
  }

  const cleanup = staleTokens.map((t) =>
    db.collection("users").doc(uid).collection("devices").doc(t).delete().catch(() => {})
  );

  const writes = [Promise.all(cleanup)];
  if (sentClientIds.length) {
    writes.push(notifyRef.set({ sentClientIds: FieldValue.arrayUnion(...sentClientIds) }, { merge: true }));
  }
  await Promise.all(writes);
}

exports.shiftReminders = onSchedule(
  { schedule: `every ${RUN_INTERVAL_MINUTES} minutes`, timeZone: "Asia/Manila" },
  async () => {
    const phState = phNow();
    const usersSnap = await db.collection("users").get();
    await Promise.all(
      usersSnap.docs.map((doc) =>
        sendRemindersForUser(doc.id, doc.data(), phState).catch((e) =>
          logger.error(`Reminder pass failed for user ${doc.id}`, e)
        )
      )
    );
  }
);
