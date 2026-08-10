"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // The workbench remains usable online if registration is unavailable.
      });
    }
  }, []);
  return null;
}
