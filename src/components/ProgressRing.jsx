import React from "react";

const SIZE = 224;
const STROKE = 13;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const TICKS = 24;

export default function ProgressRing({ percent = 0, complete = false, live = false, children }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const offset = CIRC - (clamped / 100) * CIRC;

  return (
    <div className={`duty-ring${complete ? " is-complete" : ""}${live ? " is-live" : ""}`}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle className="ring-track" cx={SIZE / 2} cy={SIZE / 2} r={R} strokeWidth={STROKE} />
        {Array.from({ length: TICKS }).map((_, i) => {
          const angle = (i / TICKS) * 360;
          const rad = (angle - 90) * (Math.PI / 180);
          const major = i % 6 === 0;
          const outer = R - STROKE / 2 - 5;
          const inner = outer - (major ? 10 : 5);
          const x1 = SIZE / 2 + outer * Math.cos(rad);
          const y1 = SIZE / 2 + outer * Math.sin(rad);
          const x2 = SIZE / 2 + inner * Math.cos(rad);
          const y2 = SIZE / 2 + inner * Math.sin(rad);
          return (
            <line
              key={i}
              className={`ring-tick${major ? " major" : ""}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            />
          );
        })}
        <circle
          className="ring-progress"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          strokeWidth={STROKE}
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <div className="ring-center">{children}</div>
      {complete && <div className="ring-seal">TARGET&nbsp;MET</div>}
    </div>
  );
}
