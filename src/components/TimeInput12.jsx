import React from "react";

// Native <input type="time"> renders in whatever hour-cycle the device's
// OS/browser locale is set to: many Android phones default to 24-hour
// ("military") time, while iOS almost always shows a 12-hour AM/PM picker.
// That meant the exact same shift looked different depending on which
// trainee's phone was being used. This component has the same value/onChange
// contract as the native input (24-hour "HH:MM" string in, same out) but
// always renders as an explicit 12-hour Hour / Minute / AM-PM picker, so
// every device — Android or iOS — looks and behaves identically.

function to12(t) {
  if (!t) return { h: "", m: "", p: "AM" };
  const [hh, mm] = t.split(":").map(Number);
  const p = hh >= 12 ? "PM" : "AM";
  let h = hh % 12;
  if (h === 0) h = 12;
  return { h: String(h), m: String(mm).padStart(2, "0"), p };
}

function to24(h, m, p) {
  if (h === "" || m === "") return "";
  let hh = parseInt(h, 10) % 12;
  if (p === "PM") hh += 12;
  return `${String(hh).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

export default function TimeInput12({ value, onChange, className = "", "aria-label": ariaLabel }) {
  const { h, m, p } = to12(value);

  function set(nh, nm, np) {
    onChange(to24(nh, nm, np));
  }

  return (
    <div className={`time12 ${className}`}>
      <select
        className="time12-hour"
        aria-label={ariaLabel ? `${ariaLabel} hour` : "Hour"}
        value={h}
        onChange={(e) => set(e.target.value, m || "00", p)}
      >
        {!h && (
          <option value="" disabled>
            --
          </option>
        )}
        {HOURS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="time12-colon">:</span>
      <select
        className="time12-minute"
        aria-label={ariaLabel ? `${ariaLabel} minute` : "Minute"}
        value={m}
        onChange={(e) => set(h || "12", e.target.value, p)}
      >
        {!m && (
          <option value="" disabled>
            --
          </option>
        )}
        {MINUTES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <div className="time12-period">
        <button type="button" className={p === "AM" ? "active" : ""} onClick={() => set(h || "12", m || "00", "AM")}>
          AM
        </button>
        <button type="button" className={p === "PM" ? "active" : ""} onClick={() => set(h || "12", m || "00", "PM")}>
          PM
        </button>
      </div>
    </div>
  );
}
