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

## 3. Run the reminder scan on a schedule

The scan logic (`api/_lib/reminderScan.js`) needs *something* to trigger it
every minute or two. There are two ways to do that — pick based on
whether you have a card to link to Google Cloud billing.

### 3a. No credit card? Use the free Vercel + cron-job.org path (recommended)

This is what's set up by default. `api/send-reminders.js` is a Vercel
serverless function (deploys automatically with the rest of the app, no
extra command) that does the scan when called. An outside free service
pings it every few minutes.

1. **Get a Firebase service account key** (this does NOT require Blaze —
   it's just an API credential): Firebase console → gear icon → **Project
   settings → Service accounts** → **Generate new private key**. A JSON
   file downloads.
2. **Base64-encode it** so it can go in a single environment variable.
   With the file saved as `serviceAccountKey.json` in your project folder:
   ```bash
   node -e "console.log(Buffer.from(require('fs').readFileSync('serviceAccountKey.json')).toString('base64'))"
   ```
   Copy the long output string.
3. **Pick a secret password** — anything random/hard to guess, e.g.
   `openssl rand -hex 16` (Mac/Linux) or just mash the keyboard for 30
   characters. This stops strangers from triggering your endpoint.
4. **Add both to Vercel**: Project → Settings → Environment Variables:
   - `FIREBASE_SERVICE_ACCOUNT_B64` = the base64 string from step 2
   - `CRON_SECRET` = the secret you picked in step 3

   (Do **not** prefix these with `VITE_` — that would ship them to the
   browser. These two are server-only.)
5. **Redeploy** on Vercel so the env vars take effect.
6. **Set up the free cron trigger** at https://cron-job.org (free, no
   card): create an account, add a new cron job:
   - URL: `https://YOUR-APP.vercel.app/api/send-reminders?secret=YOUR_CRON_SECRET`
   - Schedule: every 1–5 minutes
   - Save and enable it.

   (GitHub Actions' `schedule:` trigger is a fine alternative if you'd
   rather keep it in your repo — same idea, it just curls the same URL.)
7. Delete the local `serviceAccountKey.json` file once you've copied its
   base64 value — don't commit it anywhere.

Still deploy the Firestore rules once (this part doesn't need Blaze):
```bash
firebase deploy --only firestore:rules
```

### 3b. Have a card? Use Firebase Cloud Functions instead

The rules (`firestore.rules`) and the function (`functions/index.js`) are
already written as an alternative — same reminder logic, running on
Firebase's own scheduler instead of an outside cron service.

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
switches to pay-per-use above the free quota. If you go this route, skip
3a entirely — you don't need both.

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
