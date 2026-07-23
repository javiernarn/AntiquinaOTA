import { useEffect, useRef } from "react";

function decodeJwt(token) {
  const payload = token.split(".")[1];
  const json = decodeURIComponent(
    atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
  return JSON.parse(json);
}

export default function GoogleSignInButton({ onSuccess, onError }) {
  const buttonRef = useRef(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId) return;

    function init() {
      if (!window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          try {
            const profile = decodeJwt(response.credential);
            onSuccess({
              name: profile.name,
              email: profile.email,
              picture: profile.picture,
              sub: profile.sub,
              idToken: response.credential,
            });
          } catch (e) {
            onError?.(e);
          }
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        width: 280,
        shape: "pill",
        text: "signin_with",
      });
    }

    if (window.google?.accounts?.id) {
      init();
    } else {
      const existing = document.getElementById("gsi-client-script");
      if (existing) {
        existing.addEventListener("load", init);
      } else {
        const script = document.createElement("script");
        script.id = "gsi-client-script";
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = init;
        document.body.appendChild(script);
      }
    }
  }, [clientId, onSuccess, onError]);

  if (!clientId) {
    return (
      <div className="google-btn-missing">
        Add a Google Client ID to <code>.env</code> as{" "}
        <code>VITE_GOOGLE_CLIENT_ID</code> to turn on sign-in. See the README
        for the two-minute setup.
      </div>
    );
  }

  return <div ref={buttonRef} className="google-btn-slot" />;
}
