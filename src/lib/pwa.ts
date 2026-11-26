import { useSyncExternalStore } from "react";

/**
 * "Install the app" support.
 *
 * Chrome, Edge, Samsung Internet and other Chromium browsers fire `beforeinstallprompt`
 * once the site is installable. It can fire before React renders the landing page, so it
 * is captured here at import time and kept until the user presses an Install button.
 * Safari (iPhone, iPad, Mac) and Firefox never fire it; the landing page shows manual
 * steps for those instead.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type InstallPlatform = "ios" | "android" | "desktop";

type InstallState = {
  /** A one-tap native install dialog is available. */
  canPrompt: boolean;
  /** Running as the installed app, or the user just installed it. */
  installed: boolean;
};

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** True when this page load is the installed app (home-screen icon, dock or app window). */
export const launchedAsApp = isStandalone();

let deferred: BeforeInstallPromptEvent | null = null;
let state: InstallState = { canPrompt: false, installed: isStandalone() };
const listeners = new Set<() => void>();

const update = (next: Partial<InstallState>) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); // keep the browser's own mini-infobar out of the way; we show our own button
  deferred = event as BeforeInstallPromptEvent;
  update({ canPrompt: true });
});

window.addEventListener("appinstalled", () => {
  deferred = null;
  update({ canPrompt: false, installed: true });
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getState = () => state;

export const installPlatform: InstallPlatform = (() => {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
})();

/** Opens the browser's install dialog. Resolves to "unavailable" when there is none to show. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null; // a prompt event can only be used once
  update({ canPrompt: false });
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") update({ installed: true });
    return outcome;
  } catch {
    return "unavailable";
  }
}

export function useInstallPrompt() {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Registers the service worker in production builds only, so local dev never serves cached files. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}
