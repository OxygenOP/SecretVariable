import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";
const KEY = "sv.theme";
const listeners = new Set<() => void>();

function readStored(): ThemePref {
  try { const v = localStorage.getItem(KEY); if (v === "light" || v === "dark") return v; } catch { /* storage unavailable */ }
  return "system";
}
let pref: ThemePref = typeof localStorage === "undefined" ? "system" : readStored();
const mql = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;

export const resolveTheme = (p: ThemePref): Theme => (p === "system" ? (mql?.matches ? "light" : "dark") : p);

function apply() {
  if (typeof document === "undefined") return; // unit tests run in Node
  const t = resolveTheme(pref);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#f6f6f7" : "#171719");
}
function emit() { apply(); listeners.forEach((l) => l()); }

export function setThemePref(next: ThemePref) {
  pref = next;
  try { next === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, next); } catch { /* ignore */ }
  emit();
}
mql?.addEventListener?.("change", () => { if (pref === "system") emit(); });
apply();

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export function useTheme() {
  const p = useSyncExternalStore(subscribe, () => pref);
  const theme = resolveTheme(p);
  return { pref: p, theme, setPref: setThemePref, toggle: () => setThemePref(theme === "dark" ? "light" : "dark") };
}
