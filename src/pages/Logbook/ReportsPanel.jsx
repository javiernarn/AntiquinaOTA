import React, { useMemo } from "react";
import { Sun, Sunset } from "lucide-react";
import { formatHours, hoursBetween } from "../../utils/time";

const CATEGORY_META = {
  regular: { label: "Regular", swatch: "var(--brass)" },
  evening: { label: "Evening", swatch: "var(--evening)" },
  overtime: { label: "Overtime", swatch: "var(--rust)" },
};

export default function ReportsPanel({ entries, clients }) {
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "Unassigned";

  const byClient = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const key = e.client || "unassigned";
      if (!map.has(key)) map.set(key, { id: key, hours: 0, days: 0, last: null });
      const bucket = map.get(key);
      bucket.hours += e.hours;
      bucket.days += 1;
      if (!bucket.last || e.date > bucket.last) bucket.last = e.date;
    }
    return [...map.values()].sort((a, b) => b.hours - a.hours);
  }, [entries]);

  const byCategory = useMemo(() => {
    const totals = { regular: 0, evening: 0, overtime: 0 };
    for (const e of entries) totals[e.category] = (totals[e.category] || 0) + e.hours;
    return totals;
  }, [entries]);

  const grandTotal = entries.reduce((s, e) => s + e.hours, 0);
  const maxClientHours = Math.max(1, ...byClient.map((b) => b.hours));
  const maxCategoryHours = Math.max(1, ...Object.values(byCategory));

  const dayPart = useMemo(() => {
    let morning = 0;
    let afternoon = 0;
    for (const e of entries) {
      if (e.amIn && e.amOut) morning += hoursBetween(e.amIn, e.amOut);
      if (e.pmIn && e.pmOut) afternoon += hoursBetween(e.pmIn, e.pmOut);
    }
    return { morning, afternoon };
  }, [entries]);
  const maxDayPart = Math.max(1, dayPart.morning, dayPart.afternoon);

  if (entries.length === 0) {
    return (
      <div className="reports-empty">
        No entries yet. Clock in or add a day in the Logbook tab to see your reports.
      </div>
    );
  }

  return (
    <div className="reports-grid">
      <div className="report-card">
        <h3>Morning vs. afternoon hours</h3>
        <div className="bar-list">
          <div className="bar-row">
            <div className="bar-row-head">
              <span className="bar-name"><Sun size={13} /> Morning (time in – lunch)</span>
              <span className="bar-value">{formatHours(dayPart.morning)}</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(dayPart.morning / maxDayPart) * 100}%`, background: "var(--brass)" }} />
            </div>
          </div>
          <div className="bar-row">
            <div className="bar-row-head">
              <span className="bar-name"><Sunset size={13} /> Afternoon (lunch – time out)</span>
              <span className="bar-value">{formatHours(dayPart.afternoon)}</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(dayPart.afternoon / maxDayPart) * 100}%`, background: "var(--evening)" }} />
            </div>
          </div>
        </div>
      </div>

      <div className="report-card">
        <h3>Hours by host client</h3>
        <div className="bar-list">
          {byClient.map((b) => (
            <div className="bar-row" key={b.id}>
              <div className="bar-row-head">
                <span className="bar-name">{b.id === "unassigned" ? "Unassigned" : clientName(b.id)}</span>
                <span className="bar-value">{formatHours(b.hours)}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill client" style={{ width: `${(b.hours / maxClientHours) * 100}%` }} />
              </div>
              <div className="bar-meta">
                {b.days} {b.days === 1 ? "entry" : "entries"} &middot; last logged {b.last}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="report-card">
        <h3>Hours by shift type</h3>
        <div className="bar-list">
          {Object.entries(byCategory).map(([key, hours]) => (
            <div className="bar-row" key={key}>
              <div className="bar-row-head">
                <span className="bar-name">
                  <i className="dot" style={{ background: CATEGORY_META[key].swatch }} />
                  {CATEGORY_META[key].label}
                </span>
                <span className="bar-value">{formatHours(hours)}</span>
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{
                    width: `${(hours / maxCategoryHours) * 100}%`,
                    background: CATEGORY_META[key].swatch,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="report-total">
          <span>Total logged</span>
          <strong>{formatHours(grandTotal)}</strong>
        </div>
      </div>
    </div>
  );
}
