<<<<<<< HEAD
# OJT Logbook — Opol Community College

A time tracker for OJT hours. Pure React, no backend server, no API of its
own — entries are saved in your browser, and sign-in is handled entirely by
Google's client-side sign-in widget.

## What you need installed

Just **Node.js** (includes npm). Get it from https://nodejs.org if you don't
have it — the LTS version is fine.

## Setup (one time)

1. Unzip this folder.
2. Open a terminal in it and run:

   ```
   npm install
   ```

3. Set up Google sign-in (see below) — or skip it for now, the app will
   tell you sign-in isn't configured yet and everything else still runs.

## Google sign-in setup

Google Sign-In needs a **Client ID**, which is free and takes about two
minutes to create:

1. Go to https://console.cloud.google.com/apis/credentials and create a
   project (or pick an existing one).
2. Click **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Under **Authorized JavaScript origins**, add:
   - `http://localhost:5173` (for local development)
   - your real domain later, when you deploy (e.g. `https://yourdomain.com`)
5. Copy the generated Client ID.
6. In this project, copy `.env.example` to `.env`:

   ```
   cp .env.example .env
   ```

7. Paste your Client ID into `.env`:

   ```
   VITE_GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
   ```

8. Restart `npm run dev` if it was already running.

No backend or server-side secret is needed — the app reads the identity
Google hands back (name, email, photo) directly in the browser and stores
it locally as the signed-in session.

## Running it

```
npm run dev
```

Open the link it prints (usually `http://localhost:5173`).

## Building for deployment

```
npm run build
```

Produces a `dist` folder of plain HTML/JS/CSS you can host anywhere static
(GitHub Pages, Netlify, Vercel, etc). Remember to add that domain to your
Google OAuth **Authorized JavaScript origins** too.

## How it's organized

```
src/
  assets/images/        Logo and other static images
  components/
    GoogleSignInButton.jsx   Loads Google's sign-in widget, decodes the profile
    ProtectedRoute.jsx       Redirects to /login if not signed in
  hooks/
    useAuth.js               Reads/writes the signed-in session
  pages/
    MainPage.jsx             Animated loading screen shown on first load
    LoginPage.jsx            Portrait sign-in card (Google sign-in only)
    Logbook/
      LogbookPage.jsx        The actual OJT logbook/tracker
  routes/
    index.js                 Route definitions, grouped public vs protected
  styles/
    theme.css                 Shared color tokens used across pages
  utils/
    storage.js                localStorage helpers (namespaced, JSON-safe)
    time.js                    Hour math (hoursBetween, formatHours, etc.)
  App.jsx                      Router setup
  main.jsx                     Entry point
```

**Flow:** `/` shows the loading screen for a couple seconds, then sends you
to `/login` (if signed out) or `/logbook` (if already signed in). Signing in
with Google saves your name/email/photo locally and takes you to `/logbook`,
which is a protected route — visiting it directly while signed out bounces
you back to `/login`.

## Notes

- All data — your logbook entries and your signed-in session — lives in
  this browser only. Nothing is sent to a server. Clearing your browser
  data clears it too.
- Use **Export CSV** in the logbook to back up or submit your hours.
- Required hours defaults to 486 — change it in the app to match your
  program's actual requirement.
=======
# AntiquinaOTA
>>>>>>> 588b771b804f85e7eb7c674a1e0ab8fa01c916dd
