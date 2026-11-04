import nodemailer from "nodemailer";
import type { Config } from "./config.js";

export interface MailMessage { to: string; subject: string; text: string }
export interface Mailer {
  /** False when no SMTP server is configured; email-based features are then hidden. */
  enabled: boolean;
  send(msg: MailMessage): Promise<void>;
}

export function createMailer(config: Pick<Config, "smtpUrl" | "mailFrom">, log?: (s: string) => void): Mailer {
  if (!config.smtpUrl) return { enabled: false, send: async () => { throw new Error("Email is not configured on this server"); } };
  if (config.smtpUrl === "console") {
    // development aid: never use in production, it prints message bodies (including sign-in codes)
    return { enabled: true, send: async (m) => { (log ?? console.log)(`[mail to ${m.to}] ${m.subject}\n${m.text}`); } };
  }
  const transport = nodemailer.createTransport(config.smtpUrl);
  return {
    enabled: true,
    send: async (m) => { await transport.sendMail({ from: config.mailFrom, to: m.to, subject: m.subject, text: m.text }); },
  };
}

/** In-memory mailer for tests. */
export function createMemoryMailer(): Mailer & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = [];
  return { enabled: true, outbox, send: async (m) => { outbox.push(m); } };
}
