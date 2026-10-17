"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    // Avoid service-worker caching during local development. It is enabled in
    // production/HTTPS builds where PWA installation is intended.
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // PWA installation is optional and must never break the market UI.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
