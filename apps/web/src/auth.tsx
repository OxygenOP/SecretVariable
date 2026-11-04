import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@secretvariable/shared";
import { get, getToken, post, setToken, setUnauthorizedHandler } from "./api";

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthState>(null as never);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!getToken());

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (getToken()) get("/me").then((r) => setUser(r.user), () => setToken(null)).finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await post("/auth/login", { email, password, name: "web" });
    setToken(r.token); setUser(r.user);
  }, []);
  const register = useCallback(async (name: string, email: string, password: string) => {
    const r = await post("/auth/register", { name, email, password });
    setToken(r.token); setUser(r.user);
  }, []);
  const logout = useCallback(async () => {
    try { await post("/auth/logout"); } catch { /* already invalid */ }
    setToken(null); setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, ready, login, register, logout }}>{children}</Ctx.Provider>;
}
