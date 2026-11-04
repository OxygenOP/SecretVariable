import { parseMasterKey } from "@secretvariable/crypto";

export interface Config {
  databaseUrl: string;
  masterKey: Buffer;
  host: string;
  port: number;
  webDir: string | null;
  allowRegistration: boolean;
  sessionTtlDays: number;
  rateLimitMax: number;
  logger: boolean;
  /** smtp://user:pass@host:587, smtps://..., or "console" (prints emails to the log; development only). Unset disables email. */
  smtpUrl: string | null;
  mailFrom: string;
  /** Public address of this server (https://secrets.example.com), used for links in emails. Unset: derived from the request. */
  publicUrl: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!env.SV_MASTER_KEY) {
    throw new Error("SV_MASTER_KEY is required. Generate one with: openssl rand -hex 32");
  }
  return {
    databaseUrl,
    masterKey: parseMasterKey(env.SV_MASTER_KEY),
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? 8080),
    webDir: env.SV_WEB_DIR ?? null,
    allowRegistration: (env.SV_ALLOW_REGISTRATION ?? "true") !== "false",
    sessionTtlDays: Number(env.SV_SESSION_TTL_DAYS ?? 30),
    rateLimitMax: Number(env.SV_AUTH_RATE_LIMIT ?? 20),
    logger: (env.SV_LOG ?? "true") !== "false",
    smtpUrl: env.SV_SMTP_URL || null,
    mailFrom: env.SV_MAIL_FROM ?? "SecretVariable <no-reply@localhost>",
    publicUrl: env.SV_PUBLIC_URL ? env.SV_PUBLIC_URL.trim().replace(/\/+$/, "") : null,
  };
}
