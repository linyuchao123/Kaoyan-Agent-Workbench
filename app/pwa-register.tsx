"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

    if (isLocalDevelopment) {
      // A production service worker must not cache Vite's development client.
      // Remove registrations and app caches left by earlier local previews.
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      if ("caches" in window) {
        void caches.keys().then((keys) =>
          Promise.all(keys.filter((key) => key.startsWith("yantu-")).map((key) => caches.delete(key))),
        );
      }
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The workbench remains usable online if registration is unavailable.
    });
  }, []);
  return null;
}
