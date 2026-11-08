import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTheme } from "./theme";

/* ---------- icons: 15-18px outline set, drawn inline ---------- */
const PATHS: Record<string, string> = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  users: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3.25 3.25 0 0 1 0 6.1",
  key: "M15 9a4 4 0 1 1-1.2 2.8L4 21v-3l1.5-1.5H8V14l3-3A4 4 0 0 1 15 9zM17.5 8.5h.01",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
  logout: "M10 5H5v14h5M15 8l4 4-4 4M19 12H9",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  copy: "M9 9h10v11H9zM5 15V4h10",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  eye: "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeoff: "M3 3l18 18M10.6 6a9.6 9.6 0 0 1 1.4-.1c6.4 0 10 6.1 10 6.1a17 17 0 0 1-3.3 3.9M6.6 7.6A17 17 0 0 0 2 12s3.6 6.5 10 6.5a9.7 9.7 0 0 0 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2",
  plus: "M12 5v14M5 12h14",
  sidebar: "M4 5h16v14H4zM9 5v14",
  x: "M6 6l12 12M18 6L6 18",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  arrow: "M7 17L17 7M9 7h8v8",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  undo: "M9 14L4 9l5-5M4 9h9a6 6 0 0 1 0 12h-3",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A7 7 0 0 0 19 12z",
};
export function Icon({ name, className = "ico" }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M12 6c-2.6 0-3.6 1.2-3.6 3.6v2.8c0 1.3-.7 2.2-2.2 3.6 1.5 1.4 2.2 2.3 2.2 3.6v2.8c0 2.4 1 3.6 3.6 3.6M20 6c2.6 0 3.6 1.2 3.6 3.6v2.8c0 1.3.7 2.2 2.2 3.6-1.5 1.4-2.2 2.3-2.2 3.6v2.8c0 2.4-1 3.6-3.6 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.4" fill="currentColor" />
    </svg>
  );
}

/* ---------- data hook ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => { if (id === seq.current) setState({ data, error: null, loading: false }); },
      (error) => { if (id === seq.current) setState({ data: null, error, loading: false }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

/* ---------- formatting ---------- */
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  const a = Math.abs(s);
  if (a < 45) return "just now";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}
export const absTime = (iso: string) => new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

// pale identity tints, at least ~40 degrees apart; no violet/indigo (reserved against the style)
const HUES = [210, 160, 35, 340, 95, 190, 15, 125];
export function Avatar({ name }: { name: string }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length]!;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return <span className="avatar" style={{ "--h": hue } as React.CSSProperties} aria-hidden="true">{initials}</span>;
}
export const Who = ({ name }: { name: string | null }) => name ? <span className="who"><Avatar name={name} />{name}</span> : <span className="dash">-</span>;

export function Signs({ s }: { s: { added: string[]; changed: string[]; removed: string[] } | null }) {
  if (!s) return <span className="dash">-</span>;
  const part = (sign: string, n: number) => <span className={n ? "" : "zero"}>{sign}{n}</span>;
  return <span className="signs" title={`${s.added.length} added, ${s.changed.length} changed, ${s.removed.length} removed`}>{part("+", s.added.length)}{part("~", s.changed.length)}{part("−", s.removed.length)}</span>;
}

/* ---------- toast + modal ---------- */
interface Toast { id: number; text: string; error?: boolean }
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, error }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), error ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{list.map((t) => <div key={t.id} className={`toast${t.error ? " error" : ""}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement("textarea");
    t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy"); t.remove(); return ok;
  }
}
export function CopyButton({ text, label = "Copy", className = "icon-btn" }: { text: string | (() => Promise<string>); label?: string; className?: string }) {
  const toast = useToast();
  return (
    <button className={className} aria-label={label} title={label} onClick={async () => {
      try { toast((await copyText(typeof text === "function" ? await text() : text)) ? "Copied to clipboard" : "Could not copy", false); } catch (e) { toast((e as Error).message, true); }
    }}><Icon name="copy" /></button>
  );
}

export function CodeLine({ children, copy }: { children: string; copy?: string }) {
  return <div className="code"><code><span className="prompt">$</span>{children}</code><CopyButton text={copy ?? children} label="Copy command" /></div>;
}

/** Reserved 20px slot for a form-level error: showing or hiding a message never moves the layout. */
export function FormError({ message }: { message?: string | null }) {
  return <div className="form-error" role="alert" aria-live="polite" title={message || undefined}>{message}</div>;
}

export function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "side" }) {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;
  if (variant === "side") {
    return <button className="side-item" data-tip={label} aria-label={label} onClick={toggle}><Icon name={theme === "dark" ? "sun" : "moon"} /><span className="label">{theme === "dark" ? "Light mode" : "Dark mode"}</span></button>;
  }
  return <button className="icon-btn" aria-label={label} title={label} onClick={toggle}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>;
}

export const Loading = () => <div className="panel" aria-busy="true"><div className="skeleton" style={{ width: "30%" }} /><div className="skeleton" style={{ width: "80%", marginTop: 14 }} /><div className="skeleton" style={{ width: "60%", marginTop: 14 }} /></div>;
export const ErrorBox = ({ error, retry }: { error: Error; retry?: () => void }) => (
  <div className="notice" role="alert"><span className="error-text">{error.message}</span>{retry && <button className="btn sm" onClick={retry}>Try again</button>}</div>
);

export function usePageTitle(t: string) { useEffect(() => { document.title = `${t} · SecretVariable`; }, [t]); }
export function useMemoList<T>(v: T[], _k: unknown) { return useMemo(() => v, [v]); }
