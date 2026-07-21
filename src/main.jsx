import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles/theme.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// --- PWA: service worker registration (enables "Install app") ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is a nice-to-have — don't block the app if it fails.
    });
  });
}

// --- Portrait-only orientation lock ---
// The manifest's "orientation": "portrait-primary" locks orientation once the
// app is installed to a home screen / launched standalone. This is a second,
// best-effort lock via the Screen Orientation API for browsers/devices that
// support it while running (has no effect, and is safely ignored, on
// desktop browsers or platforms that don't support the API — e.g. iOS Safari).
function lockPortrait() {
  const orientation = screen.orientation;
  if (orientation && typeof orientation.lock === "function") {
    orientation.lock("portrait").catch(() => {
      // Locking is only permitted in fullscreen/standalone contexts on most
      // browsers — ignore rejections when running in a regular browser tab.
    });
  }
}
window.addEventListener("load", lockPortrait);
