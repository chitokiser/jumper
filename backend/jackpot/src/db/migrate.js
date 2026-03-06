import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
  const sqlPath = path.resolve(__dirname, "../../schema.sql");
  const sql = await fs.readFile(sqlPath, "utf8");
  await pool.query(sql);
  logger.info({ sqlPath }, "schema applied");
  await pool.end();
}

migrate().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});
