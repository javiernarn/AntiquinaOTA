# Push notifications setup — "your shift starts soon" outside the app

## What this adds

Right now, reminders (shift starting, lunch ending, time to clock out) only
show up while the app is open in a browser tab — that's the
`Notification` API, which can't wake up a closed app.

This adds real push notifications: they land on the trainee's phone lock
screen / notification shade even if the app is closed, the same way
Messenger or Gmail notifications do. It works by adding:

- **Firebase Firestore** — a tiny cloud mirror of each trainee's running
  clock-in session and host-client schedule (everything else — full entry
  history, PDFs — stays local on their device, unchanged).
- **Firebase Cloud Messaging (FCM)** — the delivery service that pushes to
  a specific phone/browser.
- **A Cloud Function that runs every minute**, checks whose shift/lunch
  boundary is coming up, and sends the push. It's a direct mirror of the
  reminder logic already in `LogbookPage.jsx`.

Nothing here changes hosting — your app keeps deploying to Vercel exactly
as before. Firebase is only used for Firestore + Functions + Messaging.

**Cost:** free for an OJT-sized batch of users. Cloud Functions needs the
"Blaze" (pay-as-you-go) plan to use a scheduled function at all, but the
free monthly quota (2M function invocations, generous Firestore reads)
covers this easily — realistically $0/month unless you have thousands of
trainees.

---

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com → **Add project** → name it
   (e.g. `occ-duty-log`) → you can skip Google Analytics.
2. Once created, click the **web icon (`</>`)** to register a web app →
   name it anything → **do not** check "Also set up Firebase Hosting" (you
   already have Vercel).
3. You'll see a `firebaseConfig` object. Copy each value into your `.env`:

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

## 2. Turn on the pieces you need

In the Firebase console, for this project:

- **Build → Firestore Database → Create database** → start in production
  mode → pick a region close to your users (e.g. `asia-southeast1`).
- **Build → Authentication → Sign-in method → Google → Enable.** (This
  lets Firebase accept the same Google sign-in token your app already
  gets — no second login screen for trainees.)
- **Project settings (gear icon) → Cloud Messaging tab → Web configuration
  → "Web Push certificates" → Generate key pair.** Copy the resulting key
  into `.env` as:

  ```
  VITE_FIREBASE_VAPID_KEY=...
  ```

## 3. Deploy the Firestore rules and the scheduled function

The rules (`firestore.rules`) and the function (`functions/index.js`) are
already written — you just need the Firebase CLI to ship them.

```bash
npm install -g firebase-tools
firebase login
cd AntiquinaOTA
firebase use --add        # pick the project you just created
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,functions
```

The first deploy will prompt you to **upgrade to the Blaze plan** — this
is required for any scheduled (cron-style) Cloud Function. You still won't
be billed anything at this scale; Blaze just removes the free-tier cap and
switches to pay-per-use above the free quota.

## 4. Install the new npm dependency and set env vars

```bash
npm install     # picks up the new "firebase" package from package.json
```

Add the same seven `VITE_FIREBASE_*` variables to your **Vercel** project
too (Project → Settings → Environment Variables), then redeploy — env vars
baked in at build time won't appear until the next deploy.

## 5. Try it end to end

1. `npm run dev`, sign in with Google. You should get a browser prompt
   asking to allow notifications — accept it.
2. Set a host client with a start time a few minutes from now, and make
   sure today is one of its working days.
3. Close the tab (or just lock your phone if testing on mobile / an
   installed PWA). Within the 10-minute window before start time, the
   Cloud Function should fire and a real OS notification should appear.
4. Check `firebase functions:log` if nothing shows up — it prints exactly
   which users it evaluated each run.

## How the pieces fit together

```
Trainee's browser                     Firestore                 Cloud Function (every 1 min)
─────────────────                    ───────────               ─────────────────────────────
Signs in with Google  ──────────────▶ users/{uid}
Clocks in / out        ─(mirrors)───▶   .activeSession
Adds/edits host client ─(mirrors)───▶   .clients, .lastClientId
Grants notif. permission───────────▶ users/{uid}/devices/{token}
                                                                  reads all users/*
                                                                  compares now vs. each
                                                                  user's schedule
                                                                  sends via FCM ───────┐
                                                                                        ▼
                                                          Push arrives at the OS level, even
                                                          with the app fully closed — tapping
                                                          it opens /logbook.
```

## Notes / things to know

- **iOS**: Apple only allows web push for a PWA that's been **added to the
  Home Screen** (Share → Add to Home Screen), on iOS 16.4+. A notification
  won't reach an iPhone user who just has the site open in a normal Safari
  tab — this is an Apple platform restriction, not something this code can
  work around. Android and desktop browsers don't have this limitation.
- **Privacy**: only `activeSession`, `clients`, and `lastClientId` are
  mirrored to Firestore — never the full entry history, hours worked, or
  PDFs. Firestore rules (`firestore.rules`) restrict every document to its
  own signed-in owner.
- **Turning it off**: leave the `VITE_FIREBASE_*` vars blank (or unset) —
  every function in `src/utils/cloudSync.js` no-ops when Firebase isn't
  configured, so the rest of the app is unaffected.
