import type { FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import type { MailMessage } from "./mailer.js";

/** The address people should open: SV_PUBLIC_URL when set, otherwise what the admin's browser used. */
export function publicBaseUrl(config: Pick<Config, "publicUrl">, req: FastifyRequest): string {
  if (config.publicUrl) return config.publicUrl;
  const origin = req.headers.origin;
  if (typeof origin === "string" && /^https?:\/\/[^\s/]+$/.test(origin)) return origin;
  return `${req.protocol}://${req.headers.host ?? "localhost"}`;
}

export interface InviteMailInput {
  to: string;
  inviterName: string;
  projectName: string;
  orgName: string;
  role: string;
  /** Plain-language description of what the invitee can reach, e.g. "development (write), staging (read)". */
  access: string;
  link: string;
  expiresAt: Date;
}

/** Plain text on purpose: the link is the only thing that matters, and the message holds no secret values. */
export function inviteMail(i: InviteMailInput): MailMessage {
  const date = i.expiresAt.toISOString().slice(0, 10);
  return {
    to: i.to,
    subject: `${i.inviterName} invited you to ${i.projectName} on SecretVariable`,
    text: [
      `${i.inviterName} invited you to the project "${i.projectName}" (${i.orgName}) as ${i.role}.`,
      `Access: ${i.access}.`,
      "",
      "Open this link and sign in (or create an account) with this email address to accept:",
      i.link,
      "",
      `The link works once, only for ${i.to}, and expires on ${date}.`,
      "If you were not expecting this, you can ignore this email.",
    ].join("\n"),
  };
}
