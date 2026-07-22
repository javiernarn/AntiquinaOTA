import React, { useState } from "react";
import {
  HelpCircle,
  X,
  Users,
  Play,
  Square,
  Plus,
  FileDown,
  Bell,
  Sun,
  Sunset,
  Moon,
  ShieldCheck,
} from "lucide-react";

// A single, self-contained "how this works" reference for the OJT trainee.
// Deliberately placed right beside the notification bell (topbar-actions)
// so it's always one tap away, on every screen size. Content mirrors the
// actual app logic 1:1 (host client schedules, auto lunch/clock-out,
// shift-coverage rules, real-time progress, PDF export gating) so it never
// tells the trainee something the code doesn't actually do.
export function HelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="help-btn"
        onClick={() => setOpen(true)}
        aria-label="How to use the Duty Log"
        title="How to use the Duty Log"
      >
        <HelpCircle size={18} />
      </button>

      {open && (
        <div className="help-overlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="help-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="help-card-head">
              <h2 id="help-title">How the OJT Duty Log works</h2>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className="help-card-body">
              <p className="help-intro">
                This app is your digital Daily Time Record (DTR). It tracks your OJT hours
                against your required total, in real time, and can generate a signable PDF
                report for your coordinator. Here's exactly how each part works.
              </p>

              <section className="help-section">
                <h3><Users size={14} /> 1. Set up your profile &amp; host clients</h3>
                <ul>
                  <li><strong>Trainee name</strong> and <strong>Required hours</strong> (e.g. 486h) appear on the printed report — fill these in first.</li>
                  <li><strong>Host clients</strong> are the company/office you're deployed to. Add one with its <em>type</em>:
                    <ul>
                      <li><strong>Public</strong> — Mon–Thu, 8:00 AM–5:00 PM (default)</li>
                      <li><strong>Private</strong> — Mon–Fri, 7:00 AM–6:00 PM (default)</li>
                      <li><strong>Custom</strong> — set your own days and time in/out</li>
                    </ul>
                  </li>
                  <li>You can edit a host client's schedule any time. A host client that's already used on a saved entry <strong>can't be deleted</strong> until you edit/remove those entries first — this protects your logged hours from being orphaned.</li>
                </ul>
              </section>

              <section className="help-section">
                <h3><Play size={14} /> 2. Clocking in &amp; out (live tracking)</h3>
                <ul>
                  <li>Pick a host client and shift type (Regular / Evening / Overtime), then hit <strong>Clock in</strong>. The ring and timer start immediately.</li>
                  <li>For a <strong>Regular</strong> shift the app auto-manages your day:
                    <ul>
                      <li>At <strong>12:00 PM</strong> it automatically clocks you out for lunch and saves your Morning hours.</li>
                      <li>At <strong>1:00 PM</strong> it automatically resumes your Afternoon shift (a heads-up notification fires 10 minutes before).</li>
                      <li>At your host client's scheduled end time (e.g. 5:00 PM or 6:00 PM) it automatically clocks you out and saves the Afternoon hours.</li>
                    </ul>
                  </li>
                  <li><strong>Overtime</strong> shifts are manual — they keep running until you tap <strong>Clock out</strong> yourself.</li>
                  <li>You can end your day early at any time with <strong>Clock out</strong> / <strong>End day now</strong> — whatever you've actually worked so far is saved, nothing more.</li>
                  <li>Long-shift reminders fire at 4h, 8h, and 12h so you don't forget you're still clocked in.</li>
                </ul>
              </section>

              <section className="help-section">
                <h3><Plus size={14} /> 3. Adding a day manually</h3>
                <ul>
                  <li>Missed clocking in, or need to log a past day? Use <strong>Add day</strong> at the bottom of the Logbook tab.</li>
                  <li>Choose the <strong>shift coverage</strong> for that entry:
                    <span className="help-inline-icons">
                      <Sun size={12} /> Morning only, <Sunset size={12} /> Afternoon only, <Moon size={12} /> Evening only,
                      Afternoon → Evening, or Whole day.
                    </span>
                  </li>
                  <li>Available options adjust automatically — e.g. you can't pick "Morning" for today's date once it's already past 12:00 PM, and the options narrow to match whatever hours your selected host client actually works.</li>
                  <li>A <strong>host client is required</strong> on every entry, and the time ranges can't overlap another entry already logged for that same date.</li>
                  <li>Use the <strong>pencil icon</strong> on any row to correct it (e.g. an early out), or the <strong>trash icon</strong> to delete it (with a confirmation prompt).</li>
                </ul>
              </section>

              <section className="help-section">
                <h3><ShieldCheck size={14} /> 4. Real-time progress &amp; completion</h3>
                <ul>
                  <li>The hero ring shows total hours logged vs. your required hours — it updates live, second by second, while you're clocked in.</li>
                  <li>An entry added for a time that hasn't happened yet (e.g. adding today's 8–5 shift at 7:59 AM) contributes <strong>0 hours</strong> until that time actually arrives, then ticks up in real time — it never lets you claim hours you haven't worked yet.</li>
                  <li>Each entry gets a badge: <strong>Scheduled</strong> (hasn't started), <strong>In progress</strong> (currently running), <strong>Complete</strong> (met the standard hours for its coverage), or a <strong>−Xh</strong> short badge if it fell short.</li>
                </ul>
              </section>

              <section className="help-section">
                <h3><FileDown size={14} /> 5. Reports &amp; exporting your PDF</h3>
                <ul>
                  <li>The <strong>Reports</strong> tab breaks your hours down by Morning/Afternoon/Evening, by host client, by shift type, and shows a day-by-day detailed log.</li>
                  <li><strong>Export PDF Report</strong> generates an official, signable Duty Time Record — choose Daily, Weekly summary, or Monthly summary before exporting.</li>
                  <li>Export is <strong>locked while any shift is still running</strong> (either you're currently clocked in, or a saved entry's scheduled end time hasn't passed yet) — a report only reflects hours that have actually finished.</li>
                  <li>The PDF includes trainee info, a summary of hours/remaining/progress/overtime, the full log table, an hourly breakdown, and signature lines for you and your supervisor/coordinator.</li>
                </ul>
              </section>

              <section className="help-section">
                <h3><Bell size={14} /> 6. Notifications</h3>
                <ul>
                  <li>The bell icon logs every milestone (25%/50%/75%/100% of your required hours), clock-in/out confirmations, lunch reminders, and warnings (e.g. browser storage issues).</li>
                  <li>Tap <strong>"Turn on desktop alerts"</strong> in the panel to also get OS-level notifications even when this tab isn't focused.</li>
                </ul>
              </section>

              <section className="help-section">
                <h3><ShieldCheck size={14} /> 7. Your data &amp; privacy</h3>
                <ul>
                  <li>Your logbook is tied to your signed-in Google account and stored securely (encrypted) in <strong>this browser only</strong> — it is not uploaded to a server.</li>
                  <li>Using a different device or browser starts a fresh, empty logbook for that device. Export a PDF regularly so you always have a backup copy of your official record.</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default HelpButton;
