import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const applied = await migrate(pool);
const app = await buildApp(config, pool);
if (applied.length) app.log.info({ applied }, "migrations applied");
await app.listen({ host: config.host, port: config.port });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
}
