import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, FileDown, LogOut, Play, Square, X, Users, Sun, Sunset } from "lucide-react";
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
} from "../../utils/time";
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
  client: "",
  category: "regular",
  task: "",
});

// Total hours across the morning + afternoon segments of an entry-like object.
function segmentHours({ amIn, amOut, pmIn, pmOut }) {
  const am = amIn && amOut ? hoursBetween(amIn, amOut) : 0;
  const pm = pmIn && pmOut ? hoursBetween(pmIn, pmOut) : 0;
  return Math.round((am + pm) * 100) / 100;
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
  const [draftMode, setDraftMode] = useState("full"); // "full" | "am" | "pm" — which segment(s) this manual entry covers
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

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
    // whichever half of the day it started in (before noon = morning,
    // otherwise afternoon) so it lines up with the Morning/Afternoon columns
    // used for manually-added days.
    const startedBeforeNoon = (toMinutes(activeSession.startedClock) ?? 0) < 12 * 60;
    const clockOutTime = nowClock();
    const entry = {
      id: uid(),
      date: activeSession.startedDate,
      amIn: startedBeforeNoon ? activeSession.startedClock : "",
      amOut: startedBeforeNoon ? clockOutTime : "",
      pmIn: startedBeforeNoon ? "" : activeSession.startedClock,
      pmOut: startedBeforeNoon ? "" : clockOutTime,
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

  // Switches which half(s) of the day the manual-entry form captures.
  // Clears the fields for whichever segment doesn't apply, instead of
  // leaving stale default times sitting in a slot the client doesn't use.
  function setShiftMode(mode) {
    setDraftMode(mode);
    setDraft((d) => ({
      ...d,
      amIn: mode === "pm" ? "" : d.amIn || "08:00",
      amOut: mode === "pm" ? "" : d.amOut || "12:00",
      pmIn: mode === "am" ? "" : d.pmIn || "13:00",
      pmOut: mode === "am" ? "" : d.pmOut || "17:00",
    }));
  }

  function addEntry() {
    if (!draft.date) return;
    const hasAM = draft.amIn && draft.amOut;
    const hasPM = draft.pmIn && draft.pmOut;
    if (!hasAM && !hasPM) return;
    const hrs = segmentHours(draft);
    if (hrs <= 0) return;
    setEntries((prev) =>
      [
        ...prev,
        {
          id: uid(),
          ...draft,
          amIn: hasAM ? draft.amIn : "",
          amOut: hasAM ? draft.amOut : "",
          pmIn: hasPM ? draft.pmIn : "",
          pmOut: hasPM ? draft.pmOut : "",
          client: draft.client || null,
          hours: hrs,
        },
      ].sort((a, b) => a.date.localeCompare(b.date))
    );
    setDraft(emptyDraft());
    setDraftMode("full");
  }

  function deleteEntry(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    notify({
      type: "info",
      title: "Entry deleted",
      message: "The logbook entry was removed.",
    });
  }

  function requestDeleteEntry(id) {
    setConfirmDeleteId(id);
  }

  function cancelDeleteEntry() {
    setConfirmDeleteId(null);
  }

  function confirmDeleteEntry() {
    if (confirmDeleteId) deleteEntry(confirmDeleteId);
    setConfirmDeleteId(null);
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

    // ---------- Detailed daily table (Morning + Afternoon breakdown) ----------
    const rows = entries.map((e) => [
      formatDateLong(e.date),
      e.amIn && e.amOut ? `${formatTime12(e.amIn)} – ${formatTime12(e.amOut)}` : "—",
      e.pmIn && e.pmOut ? `${formatTime12(e.pmIn)} – ${formatTime12(e.pmOut)}` : "—",
      formatHours(e.hours),
      clientName(e.client),
      categoryLabel(e.category),
      e.task || "—",
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Date", "Morning (In – Lunch)", "Afternoon (Lunch – Out)", "Hours", "Host Client", "Type", "Task / Remarks"]],
      body: rows,
      styles: { font: "helvetica", fontSize: 8.2, cellPadding: 5, textColor: [22, 33, 28], lineColor: [215, 222, 212], lineWidth: 0.5 },
      headStyles: { fillColor: [22, 33, 28], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [246, 248, 246] },
      columnStyles: {
        0: { cellWidth: 76 },
        1: { cellWidth: 78 },
        2: { cellWidth: 78 },
        3: { cellWidth: 48, halign: "center" },
        4: { cellWidth: 82 },
        5: { cellWidth: 52 },
      },
      didDrawPage: () => {
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
      },
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
      {confirmDeleteId && (() => {
        const target = entries.find((e) => e.id === confirmDeleteId);
        return (
          <div className="confirm-overlay" role="presentation" onClick={cancelDeleteEntry}>
            <div
              className="confirm-card"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-delete-title"
              onClick={(ev) => ev.stopPropagation()}
            >
              <h3 id="confirm-delete-title">Delete this entry?</h3>
              <p>
                {target
                  ? `Are you sure you want to delete the entry for ${formatDateLong(target.date)}? This can't be undone.`
                  : "Are you sure you want to delete this entry? This can't be undone."}
              </p>
              <div className="confirm-actions">
                <button className="confirm-btn confirm-btn--no" onClick={cancelDeleteEntry}>
                  No, keep it
                </button>
                <button className="confirm-btn confirm-btn--yes" onClick={confirmDeleteEntry}>
                  Yes, delete
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
              <Users size={12} /> Host clients
            </label>
            <div className="client-manager">
              <div className="client-chips">
                {clients.length === 0 && <span className="chips-empty">No clients added yet</span>}
                {clients.map((c) => (
                  <span className="client-chip" key={c.id}>
                    {c.name}
                    <button onClick={() => removeClient(c.id)} aria-label={`Remove ${c.name}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
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
                <div className="ledger-row" key={e.id}>
                  <span data-label="Date">{formatDateLong(e.date)}</span>
                  <span data-label="Morning">{e.amIn && e.amOut ? `${formatTime12(e.amIn)} – ${formatTime12(e.amOut)}` : "—"}</span>
                  <span data-label="Afternoon">{e.pmIn && e.pmOut ? `${formatTime12(e.pmIn)} – ${formatTime12(e.pmOut)}` : "—"}</span>
                  <span className="ledger-hours" data-label="Hours">{formatHours(e.hours)}</span>
                  <span className="truncate" data-label="Client">{clientName(e.client)}</span>
                  <span data-label="Type">
                    <span className={`tag tag-${e.category}`}>{categoryLabel(e.category)}</span>
                  </span>
                  <span className="truncate" title={e.task} data-label="Notes">
                    {e.task || "—"}
                  </span>
                  <button className="del-btn" onClick={() => requestDeleteEntry(e.id)} aria-label="Delete entry">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}

            <div className="ledger-new-wrap">
              <div className="shift-mode-row">
                <label className="shift-mode-label">Shift coverage</label>
                <div className="shift-mode-toggle">
                  <button
                    type="button"
                    className={draftMode === "full" ? "active" : ""}
                    onClick={() => setShiftMode("full")}
                  >
                    Whole day
                  </button>
                  <button
                    type="button"
                    className={draftMode === "am" ? "active" : ""}
                    onClick={() => setShiftMode("am")}
                  >
                    <Sun size={12} /> Morning only
                  </button>
                  <button
                    type="button"
                    className={draftMode === "pm" ? "active" : ""}
                    onClick={() => setShiftMode("pm")}
                  >
                    <Sunset size={12} /> Afternoon only
                  </button>
                </div>
              </div>

              <div className="ledger-new-grid">
                <div className="new-field">
                  <label>Date</label>
                  <input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
                </div>
                {draftMode !== "pm" && (
                  <>
                    <div className="new-field">
                      <label><Sun size={11} /> Morning in</label>
                      <input type="time" value={draft.amIn} onChange={(e) => setDraft((d) => ({ ...d, amIn: e.target.value }))} />
                    </div>
                    <div className="new-field">
                      <label>Lunch out</label>
                      <input type="time" value={draft.amOut} onChange={(e) => setDraft((d) => ({ ...d, amOut: e.target.value }))} />
                    </div>
                  </>
                )}
                {draftMode !== "am" && (
                  <>
                    <div className="new-field">
                      <label><Sunset size={11} /> Lunch in</label>
                      <input type="time" value={draft.pmIn} onChange={(e) => setDraft((d) => ({ ...d, pmIn: e.target.value }))} />
                    </div>
                    <div className="new-field">
                      <label>Afternoon out</label>
                      <input type="time" value={draft.pmOut} onChange={(e) => setDraft((d) => ({ ...d, pmOut: e.target.value }))} />
                    </div>
                  </>
                )}
                <div className="new-field small">
                  <label>Total</label>
                  <span className="new-hours">{formatHours(segmentHours(draft))}</span>
                </div>
              </div>
              <div className="ledger-new-grid secondary">
                <div className="new-field grow">
                  <label>Host client</label>
                  <select value={draft.client} onChange={(e) => setDraft((d) => ({ ...d, client: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="new-field">
                  <label>Shift type</label>
                  <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
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
                    placeholder="What did you work on?"
                    value={draft.task}
                    onChange={(e) => setDraft((d) => ({ ...d, task: e.target.value }))}
                  />
                </div>
                <button className="add-btn" onClick={addEntry} aria-label="Add entry">
                  <Plus size={17} /> Add day
                </button>
              </div>
            </div>

            <div className="ledger-footer">
              <button className="export-btn" onClick={exportPDF} disabled={exporting}>
                <FileDown size={14} /> {exporting ? "Preparing report…" : "Export Detailed PDF Report"}
              </button>
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
