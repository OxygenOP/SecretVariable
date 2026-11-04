import type { Credentials } from "./config.js";
import { CliError } from "./io.js";

export class ApiError extends CliError {
  constructor(public status: number, public apiCode: string, message: string) {
    super(message);
  }
}

export class Api {
  constructor(public server: string, private token?: string) {
    this.server = server.replace(/\/+$/, "");
  }
  static from(c: Credentials) { return new Api(c.server, c.token); }

  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.server}/api/v1${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new CliError(`Cannot reach ${this.server}`, "Check the server URL and your connection.");
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (!res.ok) {
      const msg = json?.error?.message ?? `Request failed (${res.status})`;
      if (res.status === 401 && this.token) throw new ApiError(401, "unauthorized", `${msg}. Run: secretvariable login`);
      throw new ApiError(res.status, json?.error?.code ?? "error", msg);
    }
    return json as T;
  }
  get = <T = any>(p: string) => this.request<T>("GET", p);
  post = <T = any>(p: string, b: unknown = {}) => this.request<T>("POST", p, b);
  put = <T = any>(p: string, b: unknown) => this.request<T>("PUT", p, b);
  del = <T = any>(p: string) => this.request<T>("DELETE", p);
}
