import React, { useMemo, useState } from "react";
import { History, Search, ArrowUpDown, Users, Sun, Sunset, Moon } from "lucide-react";
import {
  formatHours,
  formatTime12,
  formatDateLong,
  todayStr,
  startOfWeek,
  formatWeekRange,
  monthKey,
  formatMonthLabel,
} from "../../utils/time";
import { completionFor } from "../../utils/dutyStatus";
import { liveEntryProgress } from "../../utils/liveProgress";

const CATEGORY_LABEL = { regular: "Regular", evening: "Evening", overtime: "Overtime" };

// A dedicated home for every entry that's actually finished — the Logbook
// tab only keeps Scheduled / In progress rows now, so this is where
// completed days land instead of piling up in one long scroll. Status is
// re-derived live off the real-time progress engine (utils/liveProgress),
// so an entry appears here the instant its last segment's end time is
// reached — no manual refresh needed.
export default function EntryHistoryPanel({ entries, clients, now = new Date() }) {
  const [filterMode, setFilterMode] = useState("all"); // all | day | week | month
  const [filterDay, setFilterDay] = useState(() => todayStr(now));
  const [filterWeek, setFilterWeek] = useState(() => todayStr(now));
  const [filterMonth, setFilterMonth] = useState(() => monthKey(todayStr(now)));
  const [sortOrder, setSortOrder] = useState("desc"); // desc = newest on top, asc = oldest (Day 1) on top

  const clientName = (id) => clients.find((c) => c.id === id)?.name || "Unassigned";

  const completed = useMemo(() => {
    return entries
      .map((e) => ({ ...e, progress: liveEntryProgress(e, now) }))
      .filter((e) => e.progress.status === "complete");
  }, [entries, now]);

  const filtered = useMemo(() => {
    let list = completed;
    if (filterMode === "day") {
      list = list.filter((e) => e.date === filterDay);
    } else if (filterMode === "week") {
      const wk = startOfWeek(filterWeek);
      list = list.filter((e) => startOfWeek(e.date) === wk);
    } else if (filterMode === "month") {
      list = list.filter((e) => monthKey(e.date) === filterMonth);
    }
    return list
      .slice()
      .sort((a, b) => (sortOrder === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  }, [completed, filterMode, filterDay, filterWeek, filterMonth, sortOrder]);

  const totalHoursShown = Math.round(filtered.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100;
  const weekLabel = formatWeekRange(startOfWeek(filterWeek));
  const monthLabel = formatMonthLabel(filterMonth);

  return (
    <div className="history-panel">
      <div className="history-head">
        <div className="history-head-title">
          <History size={16} />
          <div>
            <h3>Entry History</h3>
            <p className="report-card-sub" style={{ margin: 0 }}>
              Completed entries only, moved off the Logbook tab so it stays short — this list updates in real time as
              each shift wraps up.
            </p>
          </div>
        </div>
        <div className="history-count">
          <strong>{filtered.length}</strong> {filtered.length === 1 ? "entry" : "entries"}
          {filtered.length > 0 && <span> &middot; {formatHours(totalHoursShown)}</span>}
        </div>
      </div>

      <div className="history-controls">
        <div className="history-filter">
          <Search size={13} />
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
            aria-label="Filter completed entries by"
          >
            <option value="all">All completed entries</option>
            <option value="day">By day</option>
            <option value="week">By week</option>
            <option value="month">By month</option>
          </select>

          {filterMode === "day" && (
            <input
              type="date"
              value={filterDay}
              onChange={(e) => setFilterDay(e.target.value)}
              aria-label="Pick a day"
            />
          )}
          {filterMode === "week" && (
            <>
              <input
                type="date"
                value={filterWeek}
                onChange={(e) => setFilterWeek(e.target.value)}
                aria-label="Pick any day in the week"
              />
              <span className="history-filter-label">{weekLabel}</span>
            </>
          )}
          {filterMode === "month" && (
            <>
              <input
                type="month"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                aria-label="Pick a month"
              />
              <span className="history-filter-label">{monthLabel}</span>
            </>
          )}
        </div>

        <button
          type="button"
          className="history-sort-btn"
          onClick={() => setSortOrder((s) => (s === "asc" ? "desc" : "asc"))}
          title="Toggle chronological order"
        >
          <ArrowUpDown size={13} />
          {sortOrder === "asc" ? "Oldest first (Day 1 on top)" : "Newest first"}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-row">
          {completed.length === 0
            ? "No completed entries yet — finished shifts will land here automatically once they're done."
            : "No completed entries match this filter."}
        </div>
      ) : (
        <div className="history-list">
          {filtered.map((e) => {
            const c = completionFor(e);
            return (
              <div className="history-row" key={e.id}>
                <div className="history-row-main">
                  <span className="history-date">{formatDateLong(e.date)}</span>
                  <span className={`tag tag-${e.category}`}>{CATEGORY_LABEL[e.category] || "Regular"}</span>
                  {c.met ? (
                    <span className="completion-badge is-met" title="Met the expected hours for this shift coverage">
                      Complete
                    </span>
                  ) : (
                    <span
                      className="completion-badge is-short"
                      title={`Short ${formatHours(Math.abs(c.delta))} of the expected ${formatHours(c.expected)}`}
                    >
                      −{formatHours(Math.abs(c.delta))}
                    </span>
                  )}
                </div>
                <div className="history-row-segs">
                  {e.amIn && e.amOut && (
                    <span className="timeline-seg">
                      <Sun size={12} /> Morning: {formatTime12(e.amIn)} – {formatTime12(e.amOut)}
                    </span>
                  )}
                  {e.pmIn && e.pmOut && (
                    <span className="timeline-seg">
                      <Sunset size={12} /> Afternoon: {formatTime12(e.pmIn)} – {formatTime12(e.pmOut)}
                    </span>
                  )}
                  {e.evIn && e.evOut && (
                    <span className="timeline-seg">
                      <Moon size={12} /> Evening: {formatTime12(e.evIn)} – {formatTime12(e.evOut)}
                    </span>
                  )}
                </div>
                <div className="history-row-meta">
                  <span className="timeline-client">
                    <Users size={11} /> {clientName(e.client)}
                  </span>
                  <span className="history-row-hours">{formatHours(e.hours)}</span>
                  {e.task && <span className="history-row-task">“{e.task}”</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
