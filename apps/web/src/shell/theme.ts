import { useSyncExternalStore } from "react";

/**
 * The theme choice. /theme-boot.js applies it before first paint; this keeps html[data-theme] in step
 * when the person changes it (account menu) or, on "system", when the system changes.
 */
export type ThemeChoice = "light" | "dark" | "system";

const KEY = "whatbuild.theme";
const DARK = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let choice: ThemeChoice = typeof window === "undefined" ? "system" : read();

function apply() {
  if (typeof document === "undefined") return;
  const dark = choice === "dark" || (choice === "system" && window.matchMedia(DARK).matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

if (typeof window !== "undefined") {
  apply();
  window.matchMedia(DARK).addEventListener("change", () => choice === "system" && apply());
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    choice = read();
    apply();
    listeners.forEach((l) => l());
  });
}

export function setTheme(next: ThemeChoice) {
  choice = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // The choice still applies for this visit.
  }
  apply();
  listeners.forEach((l) => l());
}

export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => choice,
    () => "system" as ThemeChoice,
  );
  return [value, setTheme];
}
