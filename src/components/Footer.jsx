import React from "react";

// Small credit footer shown at the bottom of the app's pages.
export default function Footer() {
  return (
    <footer className="app-footer">
      <span className="app-footer__tag" aria-hidden="true">{"</>"}</span>
      <span className="app-footer__text">
        Developed by{" "}
        <a
          href="https://antiquina-folio.lovable.app"
          target="_blank"
          rel="noopener noreferrer"
        >
          Antiquina, Jonee John R.
        </a>
      </span>
    </footer>
  );
}
