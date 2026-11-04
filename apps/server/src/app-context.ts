import type pg from "pg";
import type { Config } from "./config.js";
import type { Mailer } from "./mailer.js";

export interface AppCtx { pool: pg.Pool; config: Config; mailer: Mailer }
