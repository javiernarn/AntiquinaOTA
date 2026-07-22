import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, FileDown, LogOut, Play, Square, X, Users, Sun, Sunset, Moon, Pencil, XCircle } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useNotifications } from "../../context/NotificationContext";
import { useLiveClock } from "../../hooks/useLiveClock";
import { NotificationBell, ToastStack } from "../../components/NotificationCenter";
import ProgressRing from "../../components/ProgressRing";
import ReportsPanel from "./ReportsPanel";
import Footer from "../../components/Footer";
import { getStorage, setStorage, removeStorage, isStorageAvailable } from "../../utils/storage";
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
  elapsedMsSince,
  formatDuration,
  msToHours,
  rangesOverlap,
  startOfWeek,
  formatWeekRange,
  monthKey,
  formatMonthLabel,
} from "../../utils/time";
import { completionFor } from "../../utils/dutyStatus";
import "./logbook.css";

const STORAGE_KEY = "logbook-v2";
const SESSION_KEY = "active-session-v1";
const MILESTONES_KEY = "milestones-v1";

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

function coverageOptionsFor(category) {
  if (category === "evening") return ["ev", "pmev"];
  if (category === "overtime") return ["full", "am", "pm", "ev", "pmev"];
  return ["full", "am", "pm"];
}

const EVENING_STARTS_AT = 17 * 60; // 5:00 PM, in minutes — when "it's already evening"

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

  const [loaded, setLoaded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [targetHours, setTargetHours] = useState(486);
  const [clients, setClients] = useState([]);
  const [entries, setEntries] = useState([]);
  const [draft, setDraft] = useState(emptyDraft());
  const [tab, setTab] = useState("log");
  const [saveState, setSaveState] = useState("idle");
  const [newClientName, setNewClientName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportPeriod, setExportPeriod] = useState("daily"); // "daily" | "weekly" | "monthly" — grouping used by the PDF export
  const [draftMode, setDraftMode] = useState("full"); // "full" | "am" | "pm" | "ev" | "pmev" — which segment(s) this manual entry covers
  const [editingId, setEditingId] = useState(null); // id of the entry currently being edited, or null when adding a new one
  const [confirmDialog, setConfirmDialog] = useState(null); // { kind: "entry" | "client", id }

  const [activeSession, setActiveSession] = useState(() => getStorage(SESSION_KEY));
  const [sessionClient, setSessionClient] = useState("");
  const [sessionCategory, setSessionCategory] = useState("regular");
  const [sessionNote, setSessionNote] = useState("");

  const milestonesRef = useRef(new Set(getStorage(MILESTONES_KEY) || []));
  const longShiftRef = useRef(new Set());

  useEffect(() => {
    document.title = "Duty Log | OJT — " + (user?.school || "Opol Community College");
  }, [user]);

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

  // Load persisted logbook state once on mount.
  useEffect(() => {
    try {
      const raw = getStorage(STORAGE_KEY);
      if (raw) {
        setStudentName(raw.studentName || user?.name || "");
        setTargetHours(typeof raw.targetHours === "number" ? raw.targetHours : 486);
        setClients(Array.isArray(raw.clients) ? raw.clients : []);
        setEntries(Array.isArray(raw.entries) ? raw.entries : []);
      } else if (user?.name) {
        setStudentName(user.name);
      }
    } catch (e) {
      // start fresh
    } finally {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((next) => {
    setSaveState("saving");
    const ok = setStorage(STORAGE_KEY, next);
    setSaveState(ok ? "saved" : "error");
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      persist({ studentName, targetHours, clients, entries });
    }, 400);
    return () => clearTimeout(t);
  }, [loaded, studentName, targetHours, clients, entries, persist]);

  const loggedHours = useMemo(() => entries.reduce((sum, e) => sum + e.hours, 0), [entries]);
  const liveElapsedMs = activeSession ? elapsedMsSince(activeSession.startedAt) : 0;
  const liveElapsedHours = msToHours(liveElapsedMs);
  const totalHours = loggedHours + liveElapsedHours;
  const remaining = Math.max(targetHours - totalHours, 0);
  const percent = targetHours > 0 ? Math.min((totalHours / targetHours) * 100, 100) : 0;
  const complete = percent >= 100;

  const overtimeHours = useMemo(
    () => entries.filter((e) => e.category === "overtime").reduce((s, e) => s + e.hours, 0),
    [entries]
  );

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
    if (changed) setStorage(MILESTONES_KEY, [...milestonesRef.current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percent, loaded]);

  // Long-shift watch — ticks live while a session is running.
  useEffect(() => {
    if (!activeSession) {
      longShiftRef.current = new Set();
      return;
    }
    const hrs = msToHours(elapsedMsSince(activeSession.startedAt));
    [4, 8, 12].forEach((h) => {
      if (hrs >= h && !longShiftRef.current.has(h)) {
        longShiftRef.current.add(h);
        notify({
          type: "warning",
          title: `Shift running ${h}h+`,
          message: "Still on the clock — remember to clock out when you wrap up.",
          system: true,
          tag: `long-shift-${h}`,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveNow, activeSession]);

  function clockIn() {
    if (activeSession) return;
    const session = {
      client: sessionClient || null,
      category: sessionCategory,
      startedAt: new Date().toISOString(),
      startedClock: nowClock(),
      startedDate: todayStr(),
    };
    setActiveSession(session);
    setStorage(SESSION_KEY, session);
    notify({
      type: "info",
      title: "Clocked in",
      message: `${categoryLabel(session.category)} shift started at ${formatTime12(session.startedClock)}.`,
    });
  }

  function clockOut() {
    if (!activeSession) return;
    const ms = elapsedMsSince(activeSession.startedAt);
    const hrs = msToHours(ms);

    if (hrs < 0.01) {
      setActiveSession(null);
      removeStorage(SESSION_KEY);
      return;
    }

    // A clock-in/out session is one continuous stretch, so we file it under
    // whichever segment of the day it started in — Morning (before noon),
    // Afternoon (noon–5pm), or Evening (5pm onward) — so it lines up with
    // the Morning/Afternoon/Evening columns used for manually-added days.
    const startedMinutes = toMinutes(activeSession.startedClock) ?? 0;
    const startedSeg = startedMinutes >= EVENING_STARTS_AT ? "ev" : startedMinutes >= 12 * 60 ? "pm" : "am";
    const clockOutTime = nowClock();
    const entry = {
      id: uid(),
      date: activeSession.startedDate,
      amIn: startedSeg === "am" ? activeSession.startedClock : "",
      amOut: startedSeg === "am" ? clockOutTime : "",
      pmIn: startedSeg === "pm" ? activeSession.startedClock : "",
      pmOut: startedSeg === "pm" ? clockOutTime : "",
      evIn: startedSeg === "ev" ? activeSession.startedClock : "",
      evOut: startedSeg === "ev" ? clockOutTime : "",
      client: activeSession.client,
      category: activeSession.category,
      hours: hrs,
      task: sessionNote.trim(),
    };
    setEntries((prev) => [...prev, entry].sort((a, b) => a.date.localeCompare(b.date)));
    setActiveSession(null);
    removeStorage(SESSION_KEY);
    setSessionNote("");

    notify({
      type: "success",
      title: "Clocked out",
      message: `Logged ${formatHours(hrs)} for ${entry.date}.`,
      system: true,
      tag: "clock-out",
    });
  }

  // Switches which segment(s) of the day the manual-entry form captures.
  // Clears the fields for whichever segment doesn't apply, instead of
  // leaving stale default times sitting in a slot the client doesn't use.
  function setShiftMode(mode) {
    setDraftMode(mode);
    setDraft((d) => ({
      ...d,
      amIn: mode === "full" || mode === "am" ? d.amIn || "08:00" : "",
      amOut: mode === "full" || mode === "am" ? d.amOut || "12:00" : "",
      pmIn: mode === "full" || mode === "pm" || mode === "pmev" ? d.pmIn || "13:00" : "",
      pmOut: mode === "full" || mode === "pm" || mode === "pmev" ? d.pmOut || "17:00" : "",
      evIn: mode === "ev" || mode === "pmev" ? d.evIn || "17:00" : "",
      evOut: mode === "ev" || mode === "pmev" ? d.evOut || "20:00" : "",
    }));
  }

  // Shift type drives which coverage options are even available (Evening /
  // Afternoon → Evening only make sense for Evening or Overtime shifts). If
  // it's already past 5pm and someone picks Overtime (or Evening) while the
  // form is still on the "Whole day" default, nudge the coverage to
  // Afternoon → Evening automatically, since a whole day can't have already
  // happened. Switching back to Regular drops any evening-only coverage.
  function handleCategoryChange(nextCategory) {
    setDraft((d) => ({ ...d, category: nextCategory }));
    const eveningCapable = nextCategory === "overtime" || nextCategory === "evening";
    const nowMinutes = toMinutes(nowClock(new Date(liveNow))) ?? 0;
    if (eveningCapable && draft.date === todayStr() && nowMinutes >= EVENING_STARTS_AT && draftMode === "full") {
      setShiftMode("pmev");
      notify({
        type: "info",
        title: "Switched to Afternoon → Evening",
        message: "It's already past 5:00 PM, so this entry now covers Afternoon → Evening. Adjust the times if needed.",
      });
    } else if (!eveningCapable && (draftMode === "ev" || draftMode === "pmev")) {
      setShiftMode("full");
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

  function addClient() {
    const name = newClientName.trim();
    if (!name) return;
    if (clients.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setNewClientName("");
      return;
    }
    setClients((prev) => [...prev, { id: uid(), name }]);
    setNewClientName("");
  }

  function removeClient(id) {
    setClients((prev) => prev.filter((c) => c.id !== id));
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
    doc.text(
      `Generated in real time on ${generatedAt.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })} at ${generatedAt.toLocaleTimeString()}`,
      margin + 68,
      72
    );

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
    doc.text(`Report Period: ${entries.length ? `${entries[0].date} to ${entries[entries.length - 1].date}` : "—"}`, margin + 230, y);
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
      const rows = entries.map((e) => {
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
      for (const e of entries) {
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

    const hourlyTotals = entries.reduce(
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
            <div>
              <div className="brand-eyebrow">OCC</div>
              <div className="brand-title">Duty Log</div>
              <div className="brand-sub">{user?.school || "Opol Community College"}</div>
            </div>
          </div>

          <div className="topbar-actions">
            <NotificationBell />
            <div className="user-chip">
              {user?.picture ? (
                <img className="avatar avatar-photo" src={user.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="avatar">{initialsOf(user?.name)}</span>
              )}
              <span className="user-name">{user?.name || user?.email}</span>
            </div>
            <button className="signout-btn" onClick={handleSignOut} aria-label="Sign out">
              <LogOut size={14} /> <span>Sign out</span>
            </button>
          </div>
        </header>

        <section className="duty-hero">
          <div className="hero-ring">
            <ProgressRing percent={percent} complete={complete} live={!!activeSession}>
              <div className="ring-hours">{formatHours(totalHours)}</div>
              <div className="ring-target">of {targetHours}h target</div>
              <div className="ring-percent">{Math.round(percent)}%</div>
            </ProgressRing>
            <div className="ring-footnote">
              <span>{formatHours(remaining)} remaining</span>
              {overtimeHours > 0 && <span className="ot-chip">{formatHours(overtimeHours)} overtime</span>}
            </div>
          </div>

          <div className="hero-clock">
            {!activeSession ? (
              <>
                <div className="clock-label">Start a shift</div>
                <div className="clock-controls">
                  <select value={sessionClient} onChange={(e) => setSessionClient(e.target.value)}>
                    <option value="">Unassigned client</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select value={sessionCategory} onChange={(e) => setSessionCategory(e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button className="clock-in-btn" onClick={clockIn}>
                    <Play size={16} /> Clock in
                  </button>
                </div>
                <p className="clock-hint">Real-time tracking starts the moment you clock in.</p>
              </>
            ) : (
              <>
                <div className="clock-label live">
                  <span className="live-dot" /> On duty · {categoryLabel(activeSession.category)} ·{" "}
                  {clientName(activeSession.client)}
                </div>
                <div className="clock-digits">{formatDuration(elapsedMsSince(activeSession.startedAt))}</div>
                <div className="clock-controls">
                  <input
                    type="text"
                    placeholder="What are you working on? (optional)"
                    value={sessionNote}
                    onChange={(e) => setSessionNote(e.target.value)}
                  />
                  <button className="clock-out-btn" onClick={clockOut}>
                    <Square size={14} /> Clock out
                  </button>
                </div>
                <p className="clock-hint">
                  Started at {formatTime12(activeSession.startedClock)} on {formatDateLong(activeSession.startedDate)}.
                </p>
              </>
            )}
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
              type="number"
              min="1"
              value={targetHours}
              onChange={(e) => setTargetHours(Number(e.target.value) || 0)}
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
                  const inUseCount = clientEntryCount(c.id);
                  return (
                    <span className={`client-chip${inUseCount > 0 ? " in-use" : ""}`} key={c.id}>
                      {c.name}
                      {inUseCount > 0 && <span className="chip-count">{inUseCount}</span>}
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
              <div className="client-add">
                <input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addClient()}
                  placeholder="e.g. City Hall — IT Office"
                />
                <button onClick={addClient} aria-label="Add client">
                  <Plus size={15} />
                </button>
              </div>
            </div>
          </div>
        </section>

        <nav className="duty-tabs">
          <button className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>
            Logbook
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
              <div className="empty-row">No entries yet — clock in above or add a day manually below.</div>
            )}

            {entries
              .slice()
              .reverse()
              .map((e) => (
                <div className={`ledger-row${e.id === editingId ? " is-editing" : ""}`} key={e.id}>
                  <span data-label="Date">{formatDateLong(e.date)}</span>
                  <span data-label="Morning">{e.amIn && e.amOut ? `${formatTime12(e.amIn)} – ${formatTime12(e.amOut)}` : "—"}</span>
                  <span data-label="Afternoon">{e.pmIn && e.pmOut ? `${formatTime12(e.pmIn)} – ${formatTime12(e.pmOut)}` : "—"}</span>
                  <span data-label="Evening">{e.evIn && e.evOut ? `${formatTime12(e.evIn)} – ${formatTime12(e.evOut)}` : "—"}</span>
                  <span className="ledger-hours" data-label="Hours">
                    {formatHours(e.hours)}
                    {(() => {
                      const c = completionFor(e);
                      return c.met ? (
                        <span className="completion-badge is-met" title="Met the expected hours for this shift coverage">
                          Complete
                        </span>
                      ) : (
                        <span className="completion-badge is-short" title={`Short ${formatHours(Math.abs(c.delta))} of the expected ${formatHours(c.expected)}`}>
                          −{formatHours(Math.abs(c.delta))}
                        </span>
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
                <div className="shift-mode-toggle">
                  {coverageOptionsFor(draft.category).map((key) => {
                    const meta = COVERAGE_META[key];
                    const Icon = meta.icon;
                    return (
                      <button
                        type="button"
                        key={key}
                        className={draftMode === key ? "active" : ""}
                        onClick={() => setShiftMode(key)}
                      >
                        {Icon && <Icon size={12} />} {meta.label}
                      </button>
                    );
                  })}
                </div>
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
                        <input
                          type="time"
                          value={draft.amIn}
                          onChange={(e) => setDraft((d) => ({ ...d, amIn: e.target.value }))}
                        />
                      </div>
                      <div className="new-field">
                        <label>Lunch out</label>
                        <input
                          type="time"
                          value={draft.amOut}
                          onChange={(e) => setDraft((d) => ({ ...d, amOut: e.target.value }))}
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
                        <input
                          type="time"
                          value={draft.pmIn}
                          onChange={(e) => setDraft((d) => ({ ...d, pmIn: e.target.value }))}
                        />
                      </div>
                      <div className="new-field">
                        <label>Afternoon out</label>
                        <input
                          type="time"
                          value={draft.pmOut}
                          onChange={(e) => setDraft((d) => ({ ...d, pmOut: e.target.value }))}
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
                        <input
                          type="time"
                          value={draft.evIn}
                          onChange={(e) => setDraft((d) => ({ ...d, evIn: e.target.value }))}
                        />
                      </div>
                      <div className="new-field">
                        <label>Evening out</label>
                        <input
                          type="time"
                          value={draft.evOut}
                          onChange={(e) => setDraft((d) => ({ ...d, evOut: e.target.value }))}
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
                    onChange={(e) => setDraft((d) => ({ ...d, client: e.target.value }))}
                  >
                    <option value="">Select a host client…</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
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
                <button className="export-btn" onClick={exportPDF} disabled={exporting}>
                  <FileDown size={14} /> {exporting ? "Preparing report…" : "Export PDF Report"}
                </button>
              </div>
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
        ) : (
          <section className="reports-card">
            <ReportsPanel entries={entries} clients={clients} />
          </section>
        )}

        <Footer />
      </div>
    </div>
  );
}
