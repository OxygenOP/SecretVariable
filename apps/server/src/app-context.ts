import type pg from "pg";
import type { Config } from "./config.js";

export interface AppCtx { pool: pg.Pool; config: Config }
