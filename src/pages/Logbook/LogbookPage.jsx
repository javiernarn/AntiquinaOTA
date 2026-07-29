import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, FileDown, LogOut, X, Users, Sun, Sunset, Moon, Pencil, XCircle } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useNotifications } from "../../context/NotificationContext";
import { useLiveClock } from "../../hooks/useLiveClock";
import { NotificationBell, ToastStack } from "../../components/NotificationCenter";
import { HelpButton, OnboardingGuide } from "../../components/HelpGuide";
import ProgressRing from "../../components/ProgressRing";
import TimeInput12 from "../../components/TimeInput12";
import ReportsPanel from "./ReportsPanel";
import EntryHistoryPanel from "./EntryHistoryPanel";
import Footer from "../../components/Footer";
import { getUserStorage, setUserStorage, isStorageAvailable } from "../../utils/storage";
import { syncClients } from "../../utils/cloudSync";
import logo from "../../assets/images/site-logo.png";
import { LOGO_BASE64 } from "../../assets/logoBase64";
import {
  hoursBetween,
  toMinutes,
  formatHours,
  formatDateLong,
  formatTime12,
  todayStr,
  nowClock,
  uid,
  rangesOverlap,
  startOfWeek,
  formatWeekRange,
  monthKey,
  formatMonthLabel,
  formatDateTimePH,
  weekdayOf,
} from "../../utils/time";
import { completionFor } from "../../utils/dutyStatus";
import { liveEntryProgress } from "../../utils/liveProgress";
import { COMPANY_TYPES, WEEKDAYS, normalizeClient, isWorkDay, dailyHoursFor, scheduleDaysLabel, defaultsForType, clientCoverage } from "../../utils/schedule";
import "./logbook.css";

const STORAGE_KEY = "logbook-v2";
const MILESTONES_KEY = "milestones-v1";
const REMINDER_KEY = "shift-reminder-v1";
const ONBOARDING_KEY = "onboarding-seen-v1";

const CATEGORIES = [
  { id: "regular", label: "Regular" },
  { id: "evening", label: "Evening" },
  { id: "overtime", label: "Overtime" },
];

const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "Regular";

// Shift-coverage options for the manual entry form. Each maps to a set of
// segments (Morning / Afternoon / Evening) the draft form will show, plus a
// short label used on the "Add ___" button so it's obvious what's about to
// be saved. "Evening" and "Afternoon → Evening" only surface once the shift
// type is Evening or Overtime — a Regular shift has no evening segment.
const COVERAGE_META = {
  full: { label: "Whole day", short: "Whole Day", icon: null },
  am: { label: "Morning only", short: "Morning", icon: Sun },
  pm: { label: "Afternoon only", short: "Afternoon", icon: Sunset },
  ev: { label: "Evening only", short: "Evening", icon: Moon },
  pmev: { label: "Afternoon → Evening", short: "Afternoon–Evening", icon: Moon },
};

// `restrictMorning` drops "full" and "am" from the list — used when the
// entry being composed is for TODAY and it's already past 12:00 PM
// Philippine time, so a fresh Morning (or a "whole day" that starts with
// one) no longer makes sense to pick. Afternoon/Evening stay available
// regardless of what time it currently is — picking Afternoon while it's
// still morning is a normal way to plan ahead for later in the same day.
// `clientCov` (from clientCoverage()) further narrows the list to whatever
// segments the selected host client's own hours actually fall into — e.g.
// a client whose hours are 1:00 PM–8:00 PM (no Morning) drops "full" and
// "am" even for a Regular/Overtime category that would otherwise allow
// them. Pass null when no client is selected yet, so the list isn't
// prematurely restricted before the trainee has picked one.
function coverageOptionsFor(category, restrictMorning, clientCov) {
  let opts;
  if (category === "evening") opts = ["ev", "pmev"];
  else if (category === "overtime") opts = ["full", "am", "pm", "ev", "pmev"];
  else opts = ["full", "am", "pm"];
  if (restrictMorning) opts = opts.filter((k) => k !== "full" && k !== "am");
  if (clientCov) {
    opts = opts.filter((key) => {
      if (key === "full") return clientCov.am && clientCov.pm;
      if (key === "am") return clientCov.am;
      if (key === "pm") return clientCov.pm;
      if (key === "ev") return clientCov.ev;
      if (key === "pmev") return clientCov.pm && clientCov.ev;
      return true;
    });
  }
  return opts;
}

const EVENING_STARTS_AT = 17 * 60; // 5:00 PM, in minutes — when "it's already evening"

// Standard OJT lunch boundary, in minutes-since-midnight, Philippine time —
// used by the manual entry form to decide when "Morning"/"Whole day"
// coverage for today is no longer a sensible option to offer.
const LUNCH_OUT_AT = 12 * 60; // 12:00 PM

function initialsOf(name) {
  if (!name) return "OJ";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "OJ";
}

// Each day is split into a Morning session (time in → lunch out) and an
// Afternoon session (lunch in → time out), matching a standard OJT DTR sheet.
// Either half can be left blank for a half-day entry.
const emptyDraft = () => ({
  date: todayStr(),
  amIn: "08:00",
  amOut: "12:00",
  pmIn: "13:00",
  pmOut: "17:00",
  evIn: "",
  evOut: "",
  client: "",
  category: "regular",
  task: "",
});

// Total hours across the morning + afternoon + evening segments of an entry-like object.
function segmentHours({ amIn, amOut, pmIn, pmOut, evIn, evOut }) {
  const am = amIn && amOut ? hoursBetween(amIn, amOut) : 0;
  const pm = pmIn && pmOut ? hoursBetween(pmIn, pmOut) : 0;
  const ev = evIn && evOut ? hoursBetween(evIn, evOut) : 0;
  return Math.round((am + pm + ev) * 100) / 100;
}

// The list of (label, start, end)-in-minutes segments a draft/entry actually
// fills in — used both to render the ledger and to check for overlaps.
function draftSegments(d) {
  const segs = [];
  if (d.amIn && d.amOut) segs.push({ label: "Morning", start: toMinutes(d.amIn), end: toMinutes(d.amOut) });
  if (d.pmIn && d.pmOut) segs.push({ label: "Afternoon", start: toMinutes(d.pmIn), end: toMinutes(d.pmOut) });
  if (d.evIn && d.evOut) segs.push({ label: "Evening", start: toMinutes(d.evIn), end: toMinutes(d.evOut) });
  return segs;
}

export default function LogbookPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const liveNow = useLiveClock(1000);

  // Stable per-account id — every piece of duty-log data below is scoped to
  // this, so two different Google accounts signed in on the same browser
  // never see or overwrite each other's hours. `sub` is Google's permanent
  // account id; email is only a fallback for older sessions that predate it
  // being stored.
  const userId = user?.sub || user?.email || null;

  const [loaded, setLoaded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [targetHours, setTargetHours] = useState(486);
  // Raw text the "Required hours" field displays, kept separate from the
  // numeric targetHours used everywhere else. Binding the input straight to
  // a number (value={targetHours}) hits a known React/browser quirk with
  // type="number": once the field shows "0" and you keep typing, the
  // browser's own text can end up as "0486" while React's numeric value is
  // already the correct 486 — so the progress ring shows 486 but the box
  // itself still shows the stray leading zero. Using a plain string here
  // sidesteps that entirely.
  const [targetHoursInput, setTargetHoursInput] = useState("486");
  const [clients, setClients] = useState([]);
  const [lastClientId, setLastClientId] = useState(null); // most recently clocked-in client — drives the shift-start reminder
  const [entries, setEntries] = useState([]);
  const [draft, setDraft] = useState(emptyDraft());
  const [tab, setTab] = useState("log");
  const [saveState, setSaveState] = useState("idle");
  const [newClientName, setNewClientName] = useState("");
  const [newClientType, setNewClientType] = useState("public"); // "public" | "private" | "custom"
  const [newClientDays, setNewClientDays] = useState(defaultsForType("public").days);
  const [newClientTimeIn, setNewClientTimeIn] = useState(defaultsForType("public").timeIn);
  const [newClientTimeOut, setNewClientTimeOut] = useState(defaultsForType("public").timeOut);
  const [editingClientId, setEditingClientId] = useState(null); // id of the client being edited, or null when adding a new one
  const [exporting, setExporting] = useState(false);
  const [exportPeriod, setExportPeriod] = useState("daily"); // "daily" | "weekly" | "monthly" — grouping used by the PDF export
  const [draftMode, setDraftMode] = useState("full"); // "full" | "am" | "pm" | "ev" | "pmev" — which segment(s) this manual entry covers
  const [editingId, setEditingId] = useState(null); // id of the entry currently being edited, or null when adding a new one
  const [confirmDialog, setConfirmDialog] = useState(null); // { kind: "entry" | "client", id }
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    syncClients(clients, lastClientId);
  }, [clients, lastClientId, loaded]);

  const milestonesRef = useRef(new Set(getUserStorage(MILESTONES_KEY, userId) || []));
  // Date string (YYYY-MM-DD) the pre-shift reminder already fired for —
  // prevents it repeating every tick throughout the 10-minute window, and
  // resets naturally the next calendar day.
  const shiftReminderFiredRef = useRef(getUserStorage(REMINDER_KEY, userId));

  useEffect(() => {
    const pageName = tab === "reports" ? "Reports" : tab === "history" ? "Entry History" : "Logbook";
    document.title = `${pageName} | Logbook - Opol Community College`;
  }, [tab]);

  // One-time heads-up if this browser can't reliably persist data (storage
  // disabled, full, or a private/incognito window that wipes on close).
  useEffect(() => {
    if (!isStorageAvailable()) {
      notify({
        type: "warning",
        title: "Browser storage unavailable",
        message:
          "Your entries won't be saved after this tab closes. Exit private/incognito mode, or allow site data, to keep your logbook.",
        system: true,
        tag: "storage-unavailable",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tracks page scroll so the sticky header can pick up a subtle shadow
  // once content has scrolled beneath it (purely cosmetic — the header
  // itself never moves).
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Load persisted logbook state — scoped to the signed-in account, and
  // re-run whenever the account changes (e.g. signing out of one Google
  // account and into another) so the new account never inherits data left
  // in state from the previous one.
  useEffect(() => {
    if (!userId) return;
    setLoaded(false);
    try {
      const raw = getUserStorage(STORAGE_KEY, userId);
      if (raw) {
        setStudentName(raw.studentName || user?.name || "");
        const savedHours = typeof raw.targetHours === "number" ? raw.targetHours : 486;
        setTargetHours(savedHours);
        setTargetHoursInput(String(savedHours));
        setClients(Array.isArray(raw.clients) ? raw.clients : []);
        setEntries(Array.isArray(raw.entries) ? raw.entries : []);
        setLastClientId(raw.lastClientId || null);
      } else {
        // Fresh account on this browser — reset everything rather than
        // keeping whatever the previously signed-in account had loaded.
        setStudentName(user?.name || "");
        setTargetHours(486);
        setTargetHoursInput("486");
        setClients([]);
        setEntries([]);
        setLastClientId(null);
      }
    } catch (e) {
      // start fresh
    } finally {
      setLoaded(true);
    }

    // First time this Google account has ever signed in here (or simply
    // hasn't completed the walkthrough yet) — show the onboarding guide
    // automatically. Checked per-account, not just "is this a fresh
    // browser", so it still shows for a new account even on a browser
    // that already has another trainee's data in it.
    const seenOnboarding = getUserStorage(ONBOARDING_KEY, userId);
    setShowOnboarding(!seenOnboarding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function finishOnboarding() {
    setUserStorage(ONBOARDING_KEY, userId, true);
    setShowOnboarding(false);
  }

  const persist = useCallback((next) => {
    if (!userId) return;
    setSaveState("saving");
    const ok = setUserStorage(STORAGE_KEY, userId, next);
    setSaveState(ok ? "saved" : "error");
  }, [userId]);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      persist({ studentName, targetHours, clients, entries, lastClientId });
    }, 400);
    return () => clearTimeout(t);
  }, [loaded, studentName, targetHours, clients, entries, lastClientId, persist]);

  // The wall clock this render is anchored to — recomputed every tick of
  // useLiveClock() so every live-progress calculation below stays in sync
  // with real time, not just with whatever was true the moment an entry
  // was saved.
  const nowDate = useMemo(() => new Date(liveNow), [liveNow]);

  // Real-time progress for every saved entry: how much of its scheduled
  // Morning/Afternoon/Evening segments have actually elapsed against the
  // clock right now, rather than trusting the entry's stored `hours` the
  // instant it's added. A manually-added "8:00 AM–5:00 PM" entry for today
  // logged at 7:59 AM contributes 0 hours until 8:00 AM actually arrives,
  // then ticks up live as the day goes on.
  const entryProgress = useMemo(() => {
    const map = new Map();
    for (const e of entries) map.set(e.id, liveEntryProgress(e, nowDate));
    return map;
  }, [entries, nowDate]);

  // An entry stays in the Logbook tab's ledger for the rest of the calendar
  // day it's dated on — even after its last segment's end time has passed
  // and it's fully "complete" for hours purposes — so it's still easy to
  // find and correct (edit/delete) right after it's logged. It only moves
  // out to the Entry History tab once that date is no longer today, i.e.
  // starting the following day. Deliberately date-based, not status-based:
  // a same-day finished entry keeps status "complete" for hours/export
  // purposes (see utils/liveProgress.js) but that no longer decides which
  // tab it's shown in.
  const ledgerEntries = useMemo(
    () => entries.filter((e) => e.date >= todayStr(nowDate)),
    [entries, nowDate]
  );
  const completedCount = entries.length - ledgerEntries.length;

  // True the moment any entry has started but hasn't finished yet (its
  // scheduled end time is still in the future) — used to gate the Reports
  // tab and PDF export so a still-running shift can't be exported/viewed
  // as if it were already a finished day's record.
  const anyEntryInProgress = useMemo(
    () => [...entryProgress.values()].some((p) => p.status === "in-progress"),
    [entryProgress]
  );
  const blockingExport = anyEntryInProgress;

  const loggedHours = useMemo(
    () => Math.round([...entryProgress.values()].reduce((sum, p) => sum + p.liveHours, 0) * 100) / 100,
    [entryProgress]
  );
  const totalHours = loggedHours;
  const remaining = Math.max(targetHours - totalHours, 0);
  const percent = targetHours > 0 ? Math.min((totalHours / targetHours) * 100, 100) : 0;
  const complete = percent >= 100;

  const overtimeHours = useMemo(
    () => entries.filter((e) => e.category === "overtime").reduce((s, e) => s + e.hours, 0),
    [entries]
  );

  // True only when composing a brand-new entry (not editing an existing
  // one) dated today, and it's already past 12:00 PM Philippine time — the
  // point at which picking "Morning" or "Whole day" coverage for today
  // stops making sense, since that window has already closed.
  const pastLunchToday =
    !editingId && draft.date === todayStr() && (toMinutes(nowClock(new Date(liveNow))) ?? 0) >= LUNCH_OUT_AT;

  // The Add-day form's currently-selected host client, and which Morning /
  // Afternoon / Evening segments that client's own hours actually cover —
  // used to keep the shift-coverage buttons honest for hosts whose hours
  // don't start in the morning (e.g. 1:00 PM–8:00 PM).
  const draftSelectedClient = clients.find((c) => c.id === draft.client) || null;
  const draftClientCoverage = draftSelectedClient ? clientCoverage(draftSelectedClient) : null;

  // True when the selected host client's own schedule doesn't include the
  // weekday of this entry's date — e.g. a Mon–Fri client picked for a
  // Saturday entry. The client can still be selected (some trainees do get
  // asked to cover an extra day), but the form surfaces a hint so it's
  // clear why, with a nudge to either add a separate host client for that
  // day or edit this one's schedule.
  const draftClientDayMismatch =
    draftSelectedClient && draft.date && !isWorkDay(draftSelectedClient, draft.date);
  const FULL_WEEKDAYS = {
    1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday",
  };
  const draftDateWeekdayLabel = draft.date ? FULL_WEEKDAYS[weekdayOf(draft.date)] : "";

  // Milestone notifications — fire once per threshold, remembered across reloads.
  useEffect(() => {
    if (!loaded) return;
    const thresholds = [25, 50, 75, 100];
    let changed = false;
    for (const t of thresholds) {
      if (percent >= t && !milestonesRef.current.has(t)) {
        milestonesRef.current.add(t);
        changed = true;
        notify({
          type: t === 100 ? "success" : "info",
          title: t === 100 ? "Target reached!" : `${t}% of your OJT hours logged`,
          message:
            t === 100
              ? `You've logged ${formatHours(totalHours)} of your ${targetHours}h requirement.`
              : `${formatHours(totalHours)} logged so far — ${formatHours(remaining)} to go.`,
          system: true,
          tag: `milestone-${t}`,
        });
      }
    }
    if (changed) setUserStorage(MILESTONES_KEY, userId, [...milestonesRef.current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percent, loaded]);

  // Pre-shift reminder — nudges the trainee about 20 minutes before their
  // scheduled start time so they remember their shift is about to begin.
  // Based on the host client they most recently logged hours under (their
  // Public/Private/Custom schedule set on the Host clients form), and only
  // on that client's actual working days — a public-office assignment
  // (Mon–Thu) won't nag on a Friday, for instance. Skipped once they've
  // already logged hours for that client today.
  //
  // This only fires while this tab is open and in the foreground — it's a
  // same-tab fallback. The real "reaches the phone even with the app
  // closed" reminder is the scheduled push sent server-side by
  // functions/index.js (shiftReminders), which runs this same 20-minute-
  // before check for every host client on every trainee's account, not
  // just the most recent one.
  useEffect(() => {
    if (!loaded) return;
    const client = clients.find((c) => c.id === lastClientId);
    if (!client) return;
    const norm = normalizeClient(client);
    const today = todayStr();
    if (!isWorkDay(norm, today)) return;
    if (shiftReminderFiredRef.current === today) return;
    if (entries.some((e) => e.date === today && e.client === client.id)) return;

    const nowMin = toMinutes(nowClock(new Date(liveNow)));
    const startMin = toMinutes(norm.timeIn);
    if (nowMin === null || startMin === null) return;

    if (nowMin >= startMin - 20 && nowMin < startMin) {
      shiftReminderFiredRef.current = today;
      setUserStorage(REMINDER_KEY, userId, today);
      notify({
        type: "info",
        title: "Your OJT shift starts soon",
        message: `${client.name} starts at ${formatTime12(norm.timeIn)} — about ${startMin - nowMin} minute${startMin - nowMin === 1 ? "" : "s"} from now.`,
        system: true,
        tag: `shift-reminder-${today}`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveNow, loaded, clients, entries, lastClientId]);

  // If the Add-day form is left open across the 12:00 PM boundary while set
  // to Morning or Whole day for today, switch it to Afternoon the moment
  // that coverage stops being valid, with a heads-up why.
  useEffect(() => {
    if (!pastLunchToday) return;
    if (draftMode === "am" || draftMode === "full") {
      setShiftMode("pm");
      notify({
        type: "info",
        title: "Switched to Afternoon",
        message: "It's already past 12:00 PM, so Morning coverage isn't available for today. This entry now covers Afternoon — adjust the times if needed.",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastLunchToday]);

  // Switches which segment(s) of the day the manual-entry form captures.
  // Clears the fields for whichever segment doesn't apply, instead of
  // leaving stale default times sitting in a slot the client doesn't use.
  // The Morning time-in and Afternoon time-out defaults follow the draft's
  // selected host client's own schedule (e.g. 7:00 AM–6:00 PM) when one's
  // picked, falling back to the plain 8:00 AM–5:00 PM day otherwise. Lunch
  // itself (12:00 PM out, 1:00 PM resume) is always fixed.
  function setShiftMode(mode) {
    setDraftMode(mode);
    setDraft((d) => {
      const client = clients.find((c) => c.id === d.client);
      const norm = client ? normalizeClient(client) : null;
      const cov = norm ? clientCoverage(norm) : null;
      const defAmIn = norm ? norm.timeIn : "08:00";
      // Afternoon "in": resumes at 1:00 PM after lunch for a client that
      // also works mornings; for an afternoon-only host (e.g. 1:00 PM
      // start, no Morning segment) there's no lunch to resume from, so it
      // starts whenever that client's own hours start instead.
      const defPmIn = norm && cov && !cov.am ? norm.timeIn : "13:00";
      // Afternoon "out": the client's own end time — unless that end time
      // is in the evening, in which case 5:00 PM–onward belongs to the
      // Evening segment instead and Afternoon stops at 5:00 PM.
      const defPmOut = norm ? (cov && cov.ev ? "17:00" : norm.timeOut) : "17:00";
      // Evening "out" follows the client's own end time when the client
      // actually works evenings; "in" is always the fixed 5:00 PM
      // Afternoon/Evening boundary.
      const defEvIn = "17:00";
      const defEvOut = norm && cov && cov.ev ? norm.timeOut : "20:00";
      return {
        ...d,
        amIn: mode === "full" || mode === "am" ? d.amIn || defAmIn : "",
        amOut: mode === "full" || mode === "am" ? d.amOut || "12:00" : "",
        pmIn: mode === "full" || mode === "pm" || mode === "pmev" ? d.pmIn || defPmIn : "",
        pmOut: mode === "full" || mode === "pm" || mode === "pmev" ? d.pmOut || defPmOut : "",
        evIn: mode === "ev" || mode === "pmev" ? d.evIn || defEvIn : "",
        evOut: mode === "ev" || mode === "pmev" ? d.evOut || defEvOut : "",
      };
    });
  }

  // Selecting (or changing) the host client re-derives this draft's Morning
  // time-in and Afternoon time-out from that client's own schedule — the
  // same 7:00 AM–6:00 PM (or whatever's set on the Host clients form). Only
  // touches whichever of those two fields is actually part of the current
  // shift coverage (a field left blank because that segment isn't covered
  // stays blank); the lunch break stays fixed at 12:00–1:00 PM either way.
  function handleClientChange(clientId) {
    const client = clientId ? clients.find((c) => c.id === clientId) : null;
    const norm = client ? normalizeClient(client) : null;
    const cov = norm ? clientCoverage(norm) : null;
    setDraft((d) => ({
      ...d,
      client: clientId,
      amIn: d.amIn && norm ? norm.timeIn : d.amIn,
      pmIn: d.pmIn && norm ? (cov && !cov.am ? norm.timeIn : "13:00") : d.pmIn,
      pmOut: d.pmOut && norm ? (cov && cov.ev ? "17:00" : norm.timeOut) : d.pmOut,
      evOut: d.evOut && norm ? (cov && cov.ev ? norm.timeOut : d.evOut) : d.evOut,
    }));
    // A host client's schedule is set up with specific working days (e.g.
    // Mon–Fri). If this entry's date falls outside those days, the client
    // is still selectable — but flag it, since it usually means either the
    // wrong host client was picked, or this host client's schedule needs
    // updating to include this day.
    if (client && draft.date && !isWorkDay(client, draft.date)) {
      const weekday = FULL_WEEKDAYS[weekdayOf(draft.date)];
      notify({
        type: "warning",
        title: `"${client.name}" isn't scheduled for ${weekday}`,
        message: `Its OJT days are set to ${scheduleDaysLabel(client)}. If you actually reported to "${client.name}" this ${weekday}, edit it under Host clients to add ${weekday} to its schedule. Otherwise, add a separate host client for this day.`,
      });
    }
    // A host client's own hours cap which shift-coverage options actually
    // make sense (e.g. picking a 1:00 PM–8:00 PM afternoon-only client
    // while "Morning only" or "Whole day" was selected). If the current
    // coverage no longer fits this client, fall back to the first coverage
    // that does and explain why.
    const allowed = coverageOptionsFor(draft.category, pastLunchToday, cov);
    if (client && !allowed.includes(draftMode)) {
      const fallback = allowed[0] || "pm";
      setShiftMode(fallback);
      notify({
        type: "info",
        title: `Switched to ${COVERAGE_META[fallback]?.label || "a different coverage"}`,
        message: `"${client.name}"'s hours are ${formatTime12(norm.timeIn)}–${formatTime12(norm.timeOut)}, which doesn't include a ${
          COVERAGE_META[draftMode]?.label || "this"
        } segment — this entry now covers ${COVERAGE_META[fallback]?.label || "a different segment"} instead.`,
      });
    }
  }

  // Shift type drives which coverage options are even available (Evening /
  // Afternoon → Evening only make sense for Evening or Overtime shifts). If
  // it's already past 5pm and someone picks Overtime (or Evening) while the
  // form is still on the "Whole day" default, nudge the coverage to
  // Afternoon → Evening automatically, since a whole day can't have already
  // happened. Switching back to Regular drops any evening-only coverage.
  // Likewise, if it's already past noon today, Morning/Whole day aren't in
  // the allowed list for any category — fall back to whatever the first
  // still-valid option is.
  function handleCategoryChange(nextCategory) {
    setDraft((d) => ({ ...d, category: nextCategory }));
    const eveningCapable = nextCategory === "overtime" || nextCategory === "evening";
    const nowMinutes = toMinutes(nowClock(new Date(liveNow))) ?? 0;
    const selectedClient = clients.find((c) => c.id === draft.client);
    const clientCov = selectedClient ? clientCoverage(selectedClient) : null;
    const allowed = coverageOptionsFor(nextCategory, pastLunchToday, clientCov);
    if (eveningCapable && draft.date === todayStr() && nowMinutes >= EVENING_STARTS_AT && draftMode === "full") {
      setShiftMode("pmev");
      notify({
        type: "info",
        title: "Switched to Afternoon → Evening",
        message: "It's already past 5:00 PM, so this entry now covers Afternoon → Evening. Adjust the times if needed.",
      });
    } else if (!eveningCapable && (draftMode === "ev" || draftMode === "pmev")) {
      setShiftMode("full");
    } else if (!allowed.includes(draftMode)) {
      setShiftMode(allowed[0] || "pm");
    }
  }

  // Loads an existing entry back into the draft form so its times, client,
  // shift type, and remarks can be corrected — e.g. the OJT coordinator
  // called an early out at 2:06 PM instead of the planned 5:00 PM.
  function startEdit(entry) {
    const hasAM = !!(entry.amIn && entry.amOut);
    const hasPM = !!(entry.pmIn && entry.pmOut);
    const hasEV = !!(entry.evIn && entry.evOut);
    let mode = "full";
    if (hasAM && !hasPM && !hasEV) mode = "am";
    else if (!hasAM && hasPM && !hasEV) mode = "pm";
    else if (!hasAM && !hasPM && hasEV) mode = "ev";
    else if (!hasAM && hasPM && hasEV) mode = "pmev";
    else mode = "full";

    setDraft({
      date: entry.date,
      amIn: entry.amIn || "",
      amOut: entry.amOut || "",
      pmIn: entry.pmIn || "",
      pmOut: entry.pmOut || "",
      evIn: entry.evIn || "",
      evOut: entry.evOut || "",
      client: entry.client || "",
      category: entry.category,
      task: entry.task || "",
    });
    setDraftMode(mode);
    setEditingId(entry.id);
    requestAnimationFrame(() => {
      document.querySelector(".ledger-new-wrap")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
    setDraftMode("full");
  }



  // Checks a draft against the app's rules before it's saved: a date is
  // required, a host client is required, at least one time segment must be
  // filled in, and the segment(s) can't overlap a time range already
  // logged for that same date — no duplicate "whole day" entries stacked
  // on top of each other.
  function validateDraft(d, excludeId) {
    if (!d.date) return "Please pick a date.";
    if (!d.client) return "Host client is required — please select one.";

    const segs = draftSegments(d);
    if (segs.length === 0) return "Enter at least one time range for this entry.";

    for (const e of entries) {
      if (e.id === excludeId) continue;
      if (e.date !== d.date) continue;
      const existingSegs = draftSegments(e);
      for (const a of segs) {
        for (const b of existingSegs) {
          if (rangesOverlap(a.start, a.end, b.start, b.end)) {
            return `That overlaps a ${b.label.toLowerCase()} entry you already logged for ${formatDateLong(d.date)}. Edit or delete it first instead of adding a duplicate.`;
          }
        }
      }
    }
    return null;
  }

  function submitEntry() {
    const error = validateDraft(draft, editingId);
    if (error) {
      notify({ type: "warning", title: "Can't save this entry", message: error });
      return;
    }
    const hrs = segmentHours(draft);
    if (hrs <= 0) {
      notify({ type: "warning", title: "Can't save this entry", message: "Total hours must be greater than zero." });
      return;
    }
    const built = { ...draft, client: draft.client || null, hours: hrs };

    if (editingId) {
      setEntries((prev) =>
        prev.map((e) => (e.id === editingId ? { ...built, id: editingId } : e)).sort((a, b) => a.date.localeCompare(b.date))
      );
      notify({
        type: "success",
        title: "Entry updated",
        message: `${formatDateLong(draft.date)} was updated to ${formatHours(hrs)}.`,
      });
    } else {
      setEntries((prev) => [...prev, { id: uid(), ...built }].sort((a, b) => a.date.localeCompare(b.date)));
      notify({
        type: "success",
        title: "Entry added",
        message: `Logged ${formatHours(hrs)} for ${formatDateLong(draft.date)}.`,
      });
    }
    setDraft(emptyDraft());
    setDraftMode("full");
    setEditingId(null);
  }

  function deleteEntry(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (id === editingId) cancelEdit();
    notify({
      type: "info",
      title: "Entry deleted",
      message: "The logbook entry was removed.",
    });
  }

  function requestDeleteEntry(id) {
    setConfirmDialog({ kind: "entry", id });
  }

  // A host client can't be removed once it's actually been used on a duty
  // entry — whole day, or any single Morning/Afternoon/Evening coverage
  // added via "Add day" (or a clocked session). Removing it would orphan
  // real logged hours, so it must first be cleared off every entry (by
  // editing those entries to a different client) before it can go away.
  function clientEntryCount(id) {
    return entries.filter((e) => e.client === id).length;
  }

  function requestDeleteClient(id) {
    const count = clientEntryCount(id);
    if (count > 0) {
      const client = clients.find((c) => c.id === id);
      notify({
        type: "warning",
        title: "Can't remove this host client",
        message: `"${client?.name || "This client"}" is used on ${count} duty log ${count === 1 ? "entry" : "entries"} (added via Add day / shift coverage). Edit or delete those entries first, then remove the client.`,
      });
      return;
    }
    setConfirmDialog({ kind: "client", id });
  }

  function cancelConfirm() {
    setConfirmDialog(null);
  }

  function confirmDialogAction() {
    if (!confirmDialog) return;
    if (confirmDialog.kind === "entry") deleteEntry(confirmDialog.id);
    else if (confirmDialog.kind === "client") removeClient(confirmDialog.id);
    setConfirmDialog(null);
  }

  function applyClientTypePreset(type) {
    setNewClientType(type);
    const d = defaultsForType(type);
    setNewClientDays(d.days);
    setNewClientTimeIn(d.timeIn);
    setNewClientTimeOut(d.timeOut);
  }

  function toggleNewClientDay(dayId) {
    setNewClientDays((prev) =>
      prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId].sort((a, b) => a - b)
    );
  }

  function resetClientForm() {
    setNewClientName("");
    applyClientTypePreset("public");
    setEditingClientId(null);
  }

  function addClient() {
    const name = newClientName.trim();
    if (!name) return;
    if (!newClientDays.length) {
      notify({ type: "warning", title: "Pick at least one working day", message: "Select which days this host client's OJT schedule covers." });
      return;
    }
    if (editingClientId) {
      setClients((prev) =>
        prev.map((c) =>
          c.id === editingClientId
            ? { ...c, name, type: newClientType, days: newClientDays, timeIn: newClientTimeIn, timeOut: newClientTimeOut }
            : c
        )
      );
      // The client someone just edited is the one whose schedule should
      // drive their reminders — without this, lastClientId was never set
      // anywhere in the app, so the cloud function could never match a
      // client and pre-shift/lunch/end-of-day reminders never fired for
      // anyone, no matter how the host client was configured.
      setLastClientId(editingClientId);
      notify({ type: "success", title: "Host client updated", message: `"${name}" schedule was updated.` });
      resetClientForm();
      return;
    }
    if (clients.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setNewClientName("");
      return;
    }
    const newClient = { id: uid(), name, type: newClientType, days: newClientDays, timeIn: newClientTimeIn, timeOut: newClientTimeOut };
    setClients((prev) => [...prev, newClient]);
    // A newly added host client becomes the trainee's current one for
    // reminder purposes (see note above).
    setLastClientId(newClient.id);
    resetClientForm();
  }

  function startEditClient(id) {
    const client = clients.find((c) => c.id === id);
    if (!client) return;
    const norm = normalizeClient(client);
    setEditingClientId(id);
    setNewClientName(norm.name);
    setNewClientType(norm.type);
    setNewClientDays(norm.days);
    setNewClientTimeIn(norm.timeIn);
    setNewClientTimeOut(norm.timeOut);
  }

  function cancelClientEdit() {
    resetClientForm();
  }

  function removeClient(id) {
    setClients((prev) => prev.filter((c) => c.id !== id));
    if (id === editingClientId) resetClientForm();
    if (id === lastClientId) setLastClientId(null);
    notify({ type: "info", title: "Host client removed", message: "The host client was removed from your list." });
  }

  function clientName(id) {
    if (!id) return "Unassigned";
    return clients.find((c) => c.id === id)?.name || "Unassigned";
  }

  function handleSignOut() {
    logout();
    navigate("/login", { replace: true });
  }

  async function exportPDF() {
    // Real-time gate: a report is a record of finished duty hours, so it
    // can't be generated while any entry is still mid-shift (started but
    // its scheduled end hasn't been reached yet). This mirrors the same
    // rule the Reports tab uses.
    if (blockingExport) {
      notify({
        type: "warning",
        title: "Still tracking today's shift",
        message: "Today's logged hours are still in progress against the clock. Wait until the scheduled shift finishes, then export or view your report.",
      });
      return;
    }

    setExporting(true);
    let jsPDF, autoTable;
    try {
      // Loaded on demand: jsPDF (and its html2canvas dependency) is the
      // heaviest part of the app, so it's kept out of the main bundle and
      // only fetched the moment someone actually exports a report.
      [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
    } catch (e) {
      setExporting(false);
      notify({
        type: "warning",
        title: "Couldn't load the PDF engine",
        message: "Check your connection and try exporting again.",
      });
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 40;
    const generatedAt = new Date();

    // Only entries that have actually happened (in progress or already
    // complete against the clock) belong in a report — a future-dated or
    // not-yet-started-today entry hasn't produced any real hours yet, so
    // it's left out rather than printed as if it already occurred.
    const reportableEntries = entries.filter((e) => entryProgress.get(e.id)?.status !== "upcoming");

    // ---------- Header band ----------
    doc.setFillColor(22, 33, 28); // --ink
    doc.rect(0, 0, pageW, 92, "F");
    try {
      doc.addImage(LOGO_BASE64, "PNG", margin, 18, 56, 56);
    } catch (e) {
      // If the logo fails to embed for any reason, continue without it.
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Opol Community College", margin + 68, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text("On-the-Job Training — Official Duty Time Record", margin + 68, 56);
    doc.setFontSize(9);
    doc.setTextColor(220, 224, 220);
    doc.text(`Generated in real time on ${formatDateTimePH(generatedAt)}`, margin + 68, 72);

    // ---------- Trainee + summary block ----------
    let y = 114;
    doc.setTextColor(22, 33, 28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Trainee Information", margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    y += 16;
    doc.text(`Name: ${studentName || "—"}`, margin, y);
    doc.text(`Host Agency/Clients: ${clients.map((c) => c.name).join(", ") || "—"}`, margin + 230, y);
    y += 15;
    doc.text(`Required Hours: ${targetHours}h`, margin, y);
    doc.text(`Report Period: ${reportableEntries.length ? `${reportableEntries[0].date} to ${reportableEntries[reportableEntries.length - 1].date}` : "—"}`, margin + 230, y);
    y += 15;
    const periodLabel = { daily: "Daily (every logged entry)", weekly: "Weekly summary", monthly: "Monthly summary" }[exportPeriod];
    doc.text(`Report Type: ${periodLabel}`, margin, y);

    y += 22;
    const summaryBoxes = [
      { label: "Hours Completed", value: formatHours(totalHours) },
      { label: "Remaining", value: formatHours(remaining) },
      { label: "Progress", value: `${Math.round(percent)}%` },
      { label: "Overtime Logged", value: formatHours(overtimeHours) },
    ];
    const boxW = (pageW - margin * 2 - 3 * 10) / 4;
    summaryBoxes.forEach((box, i) => {
      const x = margin + i * (boxW + 10);
      doc.setFillColor(236, 240, 236);
      doc.roundedRect(x, y, boxW, 46, 6, 6, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(169, 131, 47);
      doc.text(box.value, x + boxW / 2, y + 22, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.6);
      doc.setTextColor(86, 99, 90);
      doc.text(box.label.toUpperCase(), x + boxW / 2, y + 36, { align: "center" });
    });

    y += 64;

    // ---------- Footer helper (reused by every table on this report) ----------
    const drawFooter = () => {
      const pageCount = doc.internal.getNumberOfPages();
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(120, 130, 122);
      doc.text(
        `OCC Duty Log · Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${pageCount}`,
        margin,
        pageH - 24
      );
      doc.text("This report reflects entries logged at the time of export and updates in real time.", pageW - margin, pageH - 24, {
        align: "right",
      });
    };

    // ---------- Main table: Daily (every entry) / Weekly / Monthly summary ----------
    if (exportPeriod === "daily") {
      // Every entry, with a Completion column showing whether the actual
      // hours logged met the standard expectation for that entry's own
      // shift coverage (Whole day / Morning only / Afternoon → Evening…).
      const rows = reportableEntries.map((e) => {
        const c = completionFor(e);
        return [
          formatDateLong(e.date),
          e.amIn && e.amOut ? `${formatTime12(e.amIn)} – ${formatTime12(e.amOut)}` : "—",
          e.pmIn && e.pmOut ? `${formatTime12(e.pmIn)} – ${formatTime12(e.pmOut)}` : "—",
          e.evIn && e.evOut ? `${formatTime12(e.evIn)} – ${formatTime12(e.evOut)}` : "—",
          formatHours(e.hours),
          c.met ? "Complete" : `Short ${formatHours(Math.abs(c.delta))}`,
          clientName(e.client),
          categoryLabel(e.category),
          e.task || "—",
        ];
      });

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [["Date", "Morning (In – Lunch)", "Afternoon (Lunch – Out)", "Evening (In – Out)", "Hours", "Completion", "Host Client", "Type", "Task / Remarks"]],
        body: rows,
        styles: { font: "helvetica", fontSize: 7.2, cellPadding: 4, textColor: [22, 33, 28], lineColor: [215, 222, 212], lineWidth: 0.5 },
        headStyles: { fillColor: [22, 33, 28], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [246, 248, 246] },
        columnStyles: {
          0: { cellWidth: 62 },
          1: { cellWidth: 62 },
          2: { cellWidth: 62 },
          3: { cellWidth: 62 },
          4: { cellWidth: 36, halign: "center" },
          5: { cellWidth: 46, halign: "center" },
          6: { cellWidth: 62 },
          7: { cellWidth: 42 },
        },
        didParseCell: (data) => {
          if (data.section === "body" && data.column.index === 5) {
            const met = data.cell.raw === "Complete";
            data.cell.styles.textColor = met ? [31, 122, 92] : [193, 67, 46];
            data.cell.styles.fontStyle = "bold";
          }
        },
        didDrawPage: drawFooter,
      });
    } else {
      // Weekly / Monthly summary: one row per period with days logged, a
      // Morning/Afternoon/Evening hour split, hours by shift type, total
      // hours, and how many of that period's days fully met their own
      // shift-coverage expectation vs fell short.
      const groups = new Map();
      for (const e of reportableEntries) {
        const key = exportPeriod === "weekly" ? startOfWeek(e.date) : monthKey(e.date);
        if (!groups.has(key)) {
          groups.set(key, { key, days: 0, am: 0, pm: 0, ev: 0, regular: 0, evening: 0, overtime: 0, hours: 0, complete: 0, short: 0 });
        }
        const g = groups.get(key);
        g.days += 1;
        if (e.amIn && e.amOut) g.am += hoursBetween(e.amIn, e.amOut);
        if (e.pmIn && e.pmOut) g.pm += hoursBetween(e.pmIn, e.pmOut);
        if (e.evIn && e.evOut) g.ev += hoursBetween(e.evIn, e.evOut);
        g[e.category] = (g[e.category] || 0) + e.hours;
        g.hours += e.hours;
        const c = completionFor(e);
        if (c.met) g.complete += 1;
        else g.short += 1;
      }
      const sortedGroups = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
      const rows = sortedGroups.map((g) => [
        exportPeriod === "weekly" ? formatWeekRange(g.key) : formatMonthLabel(g.key),
        String(g.days),
        formatHours(g.am),
        formatHours(g.pm),
        formatHours(g.ev),
        formatHours(g.hours),
        `${g.complete} / ${g.days}`,
      ]);

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [[exportPeriod === "weekly" ? "Week" : "Month", "Days Logged", "Morning Hrs", "Afternoon Hrs", "Evening Hrs", "Total Hours", "Days Meeting Shift Coverage"]],
        body: rows,
        styles: { font: "helvetica", fontSize: 8, cellPadding: 5, textColor: [22, 33, 28], lineColor: [215, 222, 212], lineWidth: 0.5 },
        headStyles: { fillColor: [22, 33, 28], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [246, 248, 246] },
        columnStyles: {
          1: { halign: "center" },
          2: { halign: "center" },
          3: { halign: "center" },
          4: { halign: "center" },
          5: { halign: "center" },
          6: { halign: "center" },
        },
        didDrawPage: drawFooter,
      });
    }

    // ---------- Hourly breakdown: total hours per day-part across the whole report ----------
    let hourlyY = doc.lastAutoTable.finalY + 26;
    const pageHForHourly = doc.internal.pageSize.getHeight();
    if (hourlyY > pageHForHourly - 140) {
      doc.addPage();
      hourlyY = 50;
    }
    doc.setTextColor(22, 33, 28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Hourly Breakdown — Morning / Afternoon / Evening", margin, hourlyY);

    const hourlyTotals = reportableEntries.reduce(
      (acc, e) => {
        if (e.amIn && e.amOut) acc.am += hoursBetween(e.amIn, e.amOut);
        if (e.pmIn && e.pmOut) acc.pm += hoursBetween(e.pmIn, e.pmOut);
        if (e.evIn && e.evOut) acc.ev += hoursBetween(e.evIn, e.evOut);
        return acc;
      },
      { am: 0, pm: 0, ev: 0 }
    );

    autoTable(doc, {
      startY: hourlyY + 10,
      margin: { left: margin, right: margin },
      head: [["Segment", "Standard Window", "Total Hours Logged"]],
      body: [
        ["Morning", "8:00 AM – 12:00 PM", formatHours(hourlyTotals.am)],
        ["Afternoon", "1:00 PM – 5:00 PM", formatHours(hourlyTotals.pm)],
        ["Evening", "5:00 PM – 8:00 PM", formatHours(hourlyTotals.ev)],
      ],
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, textColor: [22, 33, 28], lineColor: [215, 222, 212], lineWidth: 0.5 },
      headStyles: { fillColor: [22, 33, 28], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [246, 248, 246] },
      columnStyles: { 2: { halign: "center" } },
      didDrawPage: drawFooter,
    });

    // ---------- Signatures ----------
    let finalY = doc.lastAutoTable.finalY + 40;
    const pageH = doc.internal.pageSize.getHeight();
    if (finalY > pageH - 90) {
      doc.addPage();
      finalY = 60;
    }
    doc.setDrawColor(22, 33, 28);
    doc.setTextColor(22, 33, 28);
    doc.setFontSize(9.5);
    const sigW = (pageW - margin * 2 - 40) / 2;
    doc.line(margin, finalY, margin + sigW, finalY);
    doc.text("Trainee Signature over Printed Name", margin, finalY + 14);
    doc.line(margin + sigW + 40, finalY, margin + sigW + 40 + sigW, finalY);
    doc.text("Supervisor / OJT Coordinator Signature", margin + sigW + 40, finalY + 14);

    doc.save(`OCC-OJT-Duty-Log-${(studentName || "trainee").replace(/\s+/g, "-")}-${todayStr()}.pdf`);

    setExporting(false);
    notify({
      type: "success",
      title: "Report exported",
      message: "Your detailed duty log PDF has been downloaded.",
    });
  }

  return (
    <div className="duty-page">
      <ToastStack />
      <OnboardingGuide open={showOnboarding} onDone={finishOnboarding} />
      {confirmDialog && (() => {
        const isEntry = confirmDialog.kind === "entry";
        const target = isEntry
          ? entries.find((e) => e.id === confirmDialog.id)
          : clients.find((c) => c.id === confirmDialog.id);
        const title = isEntry ? "Delete this entry?" : "Remove this host client?";
        const message = isEntry
          ? target
            ? `Are you sure you want to delete the entry for ${formatDateLong(target.date)}? This can't be undone.`
            : "Are you sure you want to delete this entry? This can't be undone."
          : target
          ? `Are you sure you want to remove "${target.name}"? It has no duty log entries, so this is safe.`
          : "Are you sure you want to remove this host client?";
        return (
          <div className="confirm-overlay" role="presentation" onClick={cancelConfirm}>
            <div
              className="confirm-card"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-delete-title"
              onClick={(ev) => ev.stopPropagation()}
            >
              <h3 id="confirm-delete-title">{title}</h3>
              <p>{message}</p>
              <div className="confirm-actions">
                <button className="confirm-btn confirm-btn--no" onClick={cancelConfirm}>
                  No, keep it
                </button>
                <button className="confirm-btn confirm-btn--yes" onClick={confirmDialogAction}>
                  Yes, {isEntry ? "delete" : "remove"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="duty-shell">
        <header className={`duty-topbar${scrolled ? " is-scrolled" : ""}`}>
          <div className="brand">
            <img className="brand-logo" src={logo} alt="Opol Community College logo" />
            <div className="brand-text">
              <div className="brand-eyebrow">OCC</div>
              <div className="brand-title">Duty Log</div>
              <div className="brand-sub">{user?.school || "Opol Community College"}</div>
            </div>
          </div>

          <div className="topbar-actions">
            <HelpButton />
            <NotificationBell />
            <div className="user-chip">
              {user?.picture ? (
                <img className="avatar avatar-photo" src={user.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="avatar">{initialsOf(user?.name)}</span>
              )}
              <span className="user-id">
                <span className="user-name">{user?.name || user?.email}</span>
                {user?.name && user?.email ? <span className="user-email">{user.email}</span> : null}
              </span>
            </div>
            <button className="signout-btn" onClick={handleSignOut} aria-label="Sign out">
              <LogOut size={14} /> <span>Sign out</span>
            </button>
          </div>
        </header>

        <section className="duty-hero">
          <div className="hero-ring">
            <ProgressRing percent={percent} complete={complete}>
              <div className="ring-hours">{formatHours(totalHours)}</div>
              <div className="ring-target">of {targetHours}h target</div>
              <div className="ring-percent">{Math.round(percent)}%</div>
            </ProgressRing>
            <div className="ring-footnote">
              <span className="remaining-chip">{formatHours(remaining)} still required</span>
              {overtimeHours > 0 && <span className="ot-chip">{formatHours(overtimeHours)} overtime</span>}
            </div>
          </div>
        </section>

        <section className="duty-setup">
          <div className="setup-field">
            <label>Trainee name</label>
            <input value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Juan Dela Cruz" />
          </div>
          <div className="setup-field small">
            <label>Required hours</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={targetHoursInput}
              onChange={(e) => {
                // Digits only — also strips any leading zeros as the user
                // types (e.g. "0" + "4" no longer sits as "04").
                const digits = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
                setTargetHoursInput(digits);
                setTargetHours(digits ? Number(digits) : 0);
              }}
              onBlur={() => {
                // Only fall back to a default once the field is actually
                // left empty (or invalid) on blur — not the instant a digit
                // is deleted, so clearing the box to retype a new number
                // doesn't keep snapping back to a stray "0".
                const parsed = Number(targetHoursInput);
                const safe = targetHoursInput && parsed > 0 ? parsed : 486;
                setTargetHours(safe);
                setTargetHoursInput(String(safe));
              }}
            />
          </div>
          <div className="setup-field grow">
            <label>
              <Users size={12} /> Host clients <span className="required-mark">*</span>
            </label>
            <div className="client-manager">
              <div className="client-chips">
                {clients.length === 0 && <span className="chips-empty">No clients added yet</span>}
                {clients.map((c) => {
                  const norm = normalizeClient(c);
                  const inUseCount = clientEntryCount(c.id);
                  return (
                    <span className={`client-chip${inUseCount > 0 ? " in-use" : ""}${editingClientId === c.id ? " editing" : ""}`} key={c.id}>
                      <span className="chip-main">
                        <span className="chip-name">{c.name}</span>
                        <span className="chip-schedule">
                          {(COMPANY_TYPES[norm.type] || COMPANY_TYPES.custom).label} · {scheduleDaysLabel(norm)} ·{" "}
                          {formatTime12(norm.timeIn)}–{formatTime12(norm.timeOut)}
                        </span>
                      </span>
                      {inUseCount > 0 && <span className="chip-count">{inUseCount}</span>}
                      <button onClick={() => startEditClient(c.id)} aria-label={`Edit ${c.name}`} title="Edit schedule">
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => requestDeleteClient(c.id)}
                        aria-label={inUseCount > 0 ? `${c.name} is used on ${inUseCount} duty log entries and can't be removed` : `Remove ${c.name}`}
                        disabled={inUseCount > 0}
                        title={inUseCount > 0 ? `Used on ${inUseCount} duty log ${inUseCount === 1 ? "entry" : "entries"} — edit or delete those first` : "Remove client"}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
              </div>
              <div className="client-form">
                <div className="client-form-row">
                  <input
                    className="client-name-input"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="e.g. City Hall — IT Office"
                  />
                  <div className="client-type-toggle">
                    {Object.entries(COMPANY_TYPES).map(([key, meta]) => (
                      <button
                        key={key}
                        type="button"
                        className={newClientType === key ? "active" : ""}
                        onClick={() => applyClientTypePreset(key)}
                      >
                        {meta.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="client-form-row">
                  <div className="client-days-toggle">
                    {WEEKDAYS.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={newClientDays.includes(d.id) ? "active" : ""}
                        onClick={() => toggleNewClientDay(d.id)}
                      >
                        {d.short}
                      </button>
                    ))}
                  </div>
                  <div className="client-time-fields">
                    <TimeInput12 aria-label="Time in" value={newClientTimeIn} onChange={setNewClientTimeIn} />
                    <span>to</span>
                    <TimeInput12 aria-label="Time out" value={newClientTimeOut} onChange={setNewClientTimeOut} />
                  </div>
                </div>
                <p className="client-form-hint">
                  {formatTime12(newClientTimeIn)}–{formatTime12(newClientTimeOut)} ={" "}
                  {formatHours(dailyHoursFor({ days: newClientDays, timeIn: newClientTimeIn, timeOut: newClientTimeOut }))}{" "}
                  a day (lunch break already excluded), on {scheduleDaysLabel({ days: newClientDays })}.
                </p>
                <div className="client-form-actions">
                  {editingClientId && (
                    <button type="button" className="client-cancel-btn" onClick={cancelClientEdit}>
                      Cancel
                    </button>
                  )}
                  <button type="button" className="client-save-btn" onClick={addClient}>
                    <Plus size={15} /> {editingClientId ? "Save changes" : "Add host client"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <nav className="duty-tabs">
          <button className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>
            Logbook
          </button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
            Entry History{completedCount > 0 ? ` (${completedCount})` : ""}
          </button>
          <button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>
            Reports
          </button>
        </nav>

        {tab === "log" ? (
          <section className="ledger-card">
            <div className="ledger-head">
              <span>Date</span>
              <span><Sun size={11} /> Morning</span>
              <span><Sunset size={11} /> Afternoon</span>
              <span><Moon size={11} /> Evening</span>
              <span>Hours</span>
              <span>Client</span>
              <span>Type</span>
              <span>Notes</span>
              <span></span>
            </div>

            {entries.length === 0 && (
              <div className="empty-row">No entries yet — add a day below to get started.</div>
            )}

            {entries.length > 0 && ledgerEntries.length === 0 && (
              <div className="empty-row">
                No entries for today (or later) right now — earlier days have moved to the Entry History tab.
              </div>
            )}

            {ledgerEntries
              .slice()
              .reverse()
              .map((e) => (
                <div className={`ledger-row${e.id === editingId ? " is-editing" : ""}`} key={e.id}>
                  <span data-label="Date">{formatDateLong(e.date)}</span>
                  <span data-label="Morning">{e.amIn && e.amOut ? `${formatTime12(e.amIn)} – ${formatTime12(e.amOut)}` : "—"}</span>
                  <span data-label="Afternoon">{e.pmIn && e.pmOut ? `${formatTime12(e.pmIn)} – ${formatTime12(e.pmOut)}` : "—"}</span>
                  <span data-label="Evening">{e.evIn && e.evOut ? `${formatTime12(e.evIn)} – ${formatTime12(e.evOut)}` : "—"}</span>
                  <span className="ledger-hours" data-label="Hours">
                    {(() => {
                      const p = entryProgress.get(e.id);
                      if (p && p.status === "upcoming") {
                        return (
                          <>
                            {formatHours(0)}
                            <span className="completion-badge is-upcoming" title={`Scheduled for ${formatHours(p.scheduledHours)} — hasn't started yet`}>
                              Scheduled
                            </span>
                          </>
                        );
                      }
                      if (p && p.status === "in-progress") {
                        const livePct = p.scheduledHours > 0 ? Math.min((p.liveHours / p.scheduledHours) * 100, 100) : 0;
                        return (
                          <>
                            {formatHours(p.liveHours)}
                            <span className="completion-badge is-progress" title={`${formatHours(p.liveHours)} elapsed of ${formatHours(p.scheduledHours)} scheduled — still running`}>
                              <span className="live-dot" /> In progress
                            </span>
                            <span className="inline-progress-track" aria-hidden="true">
                              <span className="inline-progress-fill" style={{ width: `${livePct}%` }} />
                            </span>
                          </>
                        );
                      }
                      const c = completionFor(e);
                      return (
                        <>
                          {formatHours(e.hours)}
                          {c.met ? (
                            <span className="completion-badge is-met" title="Met the expected hours for this shift coverage">
                              Complete
                            </span>
                          ) : (
                            <span className="completion-badge is-short" title={`Short ${formatHours(Math.abs(c.delta))} of the expected ${formatHours(c.expected)}`}>
                              −{formatHours(Math.abs(c.delta))}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </span>
                  <span className="truncate" data-label="Client">{clientName(e.client)}</span>
                  <span data-label="Type">
                    <span className={`tag tag-${e.category}`}>{categoryLabel(e.category)}</span>
                  </span>
                  <span className="truncate" title={e.task} data-label="Notes">
                    {e.task || "—"}
                  </span>
                  <span className="row-actions">
                    <button className="edit-btn" onClick={() => startEdit(e)} aria-label="Edit entry">
                      <Pencil size={14} />
                    </button>
                    <button className="del-btn" onClick={() => requestDeleteEntry(e.id)} aria-label="Delete entry">
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>
              ))}

            <div className={`ledger-new-wrap${editingId ? " is-editing" : ""}`}>
              {editingId && (
                <div className="editing-banner">
                  <Pencil size={13} /> Editing an existing entry — change whatever needs correcting (e.g. an early out) and save.
                </div>
              )}

              <div className="shift-mode-row">
                <label className="shift-mode-label">Shift coverage</label>
                <div className={`shift-mode-toggle count-${coverageOptionsFor(draft.category, pastLunchToday, draftClientCoverage).length}`}>
                  {coverageOptionsFor(draft.category, pastLunchToday, draftClientCoverage).map((key) => {
                    const meta = COVERAGE_META[key];
                    const Icon = meta.icon;
                    return (
                      <button
                        type="button"
                        key={key}
                        className={draftMode === key ? "active" : ""}
                        onClick={() => setShiftMode(key)}
                      >
                        {Icon && <Icon size={12} />} <span>{meta.label}</span>
                      </button>
                    );
                  })}
                </div>
                {pastLunchToday && (
                  <span className="field-hint">
                    It's already past 12:00 PM, so Morning / Whole day isn't available for today's entry.
                  </span>
                )}
                {!pastLunchToday && draftSelectedClient && draftClientCoverage && !(draftClientCoverage.am && draftClientCoverage.pm) && (
                  <span className="field-hint">
                    "{draftSelectedClient.name}"'s hours are {formatTime12(normalizeClient(draftSelectedClient).timeIn)}–
                    {formatTime12(normalizeClient(draftSelectedClient).timeOut)}, so only coverage that fits those hours is shown.
                  </span>
                )}
              </div>

              <div className="new-field date-field">
                <label>Date</label>
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                />
              </div>

              <div className="segment-groups">
                {(draftMode === "full" || draftMode === "am") && (
                  <div className="segment-group segment-am">
                    <div className="segment-group-title"><Sun size={13} /> Morning</div>
                    <div className="segment-group-fields">
                      <div className="new-field">
                        <label>Morning in</label>
                        <TimeInput12
                          aria-label="Morning in"
                          value={draft.amIn}
                          onChange={(v) => setDraft((d) => ({ ...d, amIn: v }))}
                        />
                      </div>
                      <div className="new-field">
                        <label>Lunch out</label>
                        <TimeInput12
                          aria-label="Lunch out"
                          value={draft.amOut}
                          onChange={(v) => setDraft((d) => ({ ...d, amOut: v }))}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {(draftMode === "full" || draftMode === "pm" || draftMode === "pmev") && (
                  <div className="segment-group segment-pm">
                    <div className="segment-group-title"><Sunset size={13} /> Afternoon</div>
                    <div className="segment-group-fields">
                      <div className="new-field">
                        <label>Lunch in</label>
                        <TimeInput12
                          aria-label="Lunch in"
                          value={draft.pmIn}
                          onChange={(v) => setDraft((d) => ({ ...d, pmIn: v }))}
                        />
                      </div>
                      <div className="new-field">
                        <label>Afternoon out</label>
                        <TimeInput12
                          aria-label="Afternoon out"
                          value={draft.pmOut}
                          onChange={(v) => setDraft((d) => ({ ...d, pmOut: v }))}
                        />
                      </div>
                    </div>
                    <span className="field-hint">Left early? Set the actual time you clocked out.</span>
                  </div>
                )}
                {(draftMode === "ev" || draftMode === "pmev") && (
                  <div className="segment-group segment-ev">
                    <div className="segment-group-title"><Moon size={13} /> Evening</div>
                    <div className="segment-group-fields">
                      <div className="new-field">
                        <label>Evening in</label>
                        <TimeInput12
                          aria-label="Evening in"
                          value={draft.evIn}
                          onChange={(v) => setDraft((d) => ({ ...d, evIn: v }))}
                        />
                      </div>
                      <div className="new-field">
                        <label>Evening out</label>
                        <TimeInput12
                          aria-label="Evening out"
                          value={draft.evOut}
                          onChange={(v) => setDraft((d) => ({ ...d, evOut: v }))}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="total-strip">
                <span className="total-strip-label">Total for this entry</span>
                <span className="total-strip-value">{formatHours(segmentHours(draft))}</span>
              </div>
              <div className="ledger-new-grid secondary">
                <div className="new-field grow">
                  <label>Host client <span className="required-mark">*</span></label>
                  <select
                    className={!draft.client ? "field-required" : ""}
                    value={draft.client}
                    onChange={(e) => handleClientChange(e.target.value)}
                  >
                    <option value="">Select a host client…</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {draftClientDayMismatch && (
                    <span className="field-hint field-hint-warning">
                      "{draftSelectedClient.name}" is scheduled {scheduleDaysLabel(draftSelectedClient)}, not{" "}
                      {draftDateWeekdayLabel}. If this is right, edit "{draftSelectedClient.name}" under Host clients
                      to add {draftDateWeekdayLabel} — or add it as a separate host client instead.
                    </span>
                  )}
                </div>
                <div className="new-field">
                  <label>Shift type</label>
                  <select value={draft.category} onChange={(e) => handleCategoryChange(e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="new-field grow">
                  <label>Task / remarks</label>
                  <input
                    type="text"
                    placeholder="What are you working on?"
                    value={draft.task}
                    onChange={(e) => setDraft((d) => ({ ...d, task: e.target.value }))}
                  />
                </div>
                <div className="new-field-actions">
                  {editingId && (
                    <button className="cancel-edit-btn" onClick={cancelEdit} type="button" aria-label="Cancel edit">
                      <XCircle size={15} /> Cancel
                    </button>
                  )}
                  <button className="add-btn" onClick={submitEntry} aria-label={editingId ? "Save changes" : "Add entry"}>
                    {editingId ? (
                      <>Save changes</>
                    ) : (
                      <>
                        <Plus size={17} /> Add {COVERAGE_META[draftMode].short}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="ledger-footer">
              <div className="export-controls">
                <select
                  className="export-period-select"
                  value={exportPeriod}
                  onChange={(e) => setExportPeriod(e.target.value)}
                  aria-label="Report period"
                >
                  <option value="daily">Daily (every entry)</option>
                  <option value="weekly">Weekly summary</option>
                  <option value="monthly">Monthly summary</option>
                </select>
                <button
                  className="export-btn"
                  onClick={exportPDF}
                  disabled={exporting || blockingExport}
                  title={
                    blockingExport
                      ? "Today's shift is still in progress against the clock — the report will be available once it finishes."
                      : undefined
                  }
                >
                  <FileDown size={14} /> {exporting ? "Preparing report…" : blockingExport ? "Shift in progress…" : "Export PDF Report"}
                </button>
              </div>
              {blockingExport && (
                <span className="export-blocked-note">
                  A logged shift for today hasn't reached its scheduled end time yet — report export unlocks once it does.
                </span>
              )}
              <span className="save-note">
                {saveState === "saving"
                  ? "Saving…"
                  : saveState === "error"
                  ? "Couldn't save — storage may be full or disabled"
                  : loaded
                  ? "Saved to this browser"
                  : "Loading…"}
              </span>
            </div>
          </section>
        ) : tab === "history" ? (
          <section className="ledger-card">
            <EntryHistoryPanel entries={entries} clients={clients} now={nowDate} />
          </section>
        ) : (
          <section className="reports-card">
            <ReportsPanel entries={entries} clients={clients} now={nowDate} blockingExport={blockingExport} />
          </section>
        )}

        <Footer />
      </div>
    </div>
  );
}
