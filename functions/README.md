# Shift-reminder push notifications

This folder is the missing server half of the "shift starting soon" reminder.
The app already does everything client-side — registers each device for
push (`src/utils/cloudSync.js`), mirrors each trainee's host-client
schedule and active session to Firestore, and has a background service
worker ready to show the notification (`public/firebase-messaging-sw.js`).
What was missing was something to actually *send* that push on a timer —
that's `shiftReminders` in `index.js`.

## What it does

Every 5 minutes, for every trainee:
- Looks at their host-client list (Public/Private/Custom, whatever days
  and hours were set on the **Host clients** form).
- For any client scheduled to work **today**, checks whether right now is
  **20 minutes before** that client's start time.
- If so, and the trainee isn't already clocked in under that client today,
  and hasn't already been reminded today, sends a push: *"[Client] starts
  at [time] — that's in about 20 minutes. Don't forget to clock in."*
- This reaches the phone's notification tray even if the app/browser is
  completely closed — unlike the in-app-only fallback reminder in
  `LogbookPage.jsx`, which only fires while a tab is open.

## Deploy

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Requires:
- The **Blaze (pay-as-you-go)** Firebase plan — `onSchedule` runs on Cloud
  Scheduler, which isn't available on the free Spark plan. Checking a few
  hundred trainees every 5 minutes typically stays within Firebase's free
  usage tier (a few cents/month at most).
- The same Firebase project already configured in `.env` /
  `VITE_FIREBASE_PROJECT_ID` (see `.firebaserc`).
- Firestore already has the `users/{uid}`, `users/{uid}/devices/{token}`,
  and `users/{uid}/notifyState/{date}` structure the app writes to — no
  extra setup needed there, `firestore.rules` already covers them.

## Verifying it's running

```bash
firebase functions:log
```

You should see one `shiftReminders` invocation every 5 minutes, and a
`Push send failed…` line only if something's actually wrong (bad token,
etc.) — no due reminders on a given tick is normal and silent.
