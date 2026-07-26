// Vercel serverless function: POST/GET /api/send-reminders
//
// This exists so we don't need Firebase's Blaze (paid) plan just to run a
// timer — Vercel's own free tier already runs this project, and an
// outside free cron service (see PUSH_NOTIFICATIONS_SETUP.md §3b) simply
// calls this URL every few minutes. It's protected by a shared secret so
// randoms on the internet can't trigger it or see whether it's working.

import { runReminderScan } from "./_lib/reminderScan.js";

export default async function handler(req, res) {
  const provided = req.headers["x-cron-secret"] || req.query.secret;
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return res.status(500).json({ ok: false, error: "CRON_SECRET is not set on the server." });
  }
  if (provided !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    const result = await runReminderScan();
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error("send-reminders failed:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
