import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var __sonaPool: Pool | undefined;
}

const pool =
  globalThis.__sonaPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__sonaPool = pool;
}

export const db = drizzle(pool, { schema });
