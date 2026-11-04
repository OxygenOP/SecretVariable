export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const KEY = "sv.token";
let token: string | null = null;
try { token = localStorage.getItem(KEY); } catch { /* storage unavailable */ }

export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Cannot reach the server. Check your connection.");
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    if (res.status === 401 && token) { setToken(null); onUnauthorized(); }
    throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}
export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>("POST", p, b);
export const put = <T = any>(p: string, b: unknown) => api<T>("PUT", p, b);
export const patch = <T = any>(p: string, b: unknown) => api<T>("PATCH", p, b);
export const del = <T = any>(p: string) => api<T>("DELETE", p);
