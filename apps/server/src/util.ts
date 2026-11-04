import { z } from "zod";
import { badRequest } from "./errors.js";

export function slugify(s: string): string {
  const slug = s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || "item";
}

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw badRequest(`${i.path.join(".") || "body"}: ${i.message}`);
  }
  return r.data;
}

export const uuidParam = z.string().regex(/^[0-9a-f-]{36}$/i, "invalid id");
export const envName = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "use letters, numbers, dash, dot or underscore");
