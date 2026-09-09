/**
 * lib/db-migrate.ts
 *
 * Applies the database schema. Run with: npm run db:migrate
 *
 * Every statement in initSchema is CREATE ... IF NOT EXISTS, so this is safe to
 * run repeatedly and against a database that already holds data.
 *
 * The API routes also call initSchema defensively, but running it here means a
 * fresh checkout can be prepared in one step rather than on the first request.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal .env loader. Next.js loads these files for the app, but this script
 * runs standalone under tsx, so it has to read them itself. Later files do not
 * override values already set, matching Next's precedence (.env.local wins).
 */
function loadEnv(files: string[]) {
  for (const file of files) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;

    for (const rawLine of readFileSync(path, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eq = line.indexOf("=");
      if (eq === -1) continue;

      const key = line.slice(0, eq).trim();
      if (!key || key in process.env) continue;

      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

async function main() {
  loadEnv([".env.local", ".env"]);

  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in your Neon connection string."
    );
    process.exit(1);
  }

  // Imported after the environment is loaded — lib/db reads DATABASE_URL lazily,
  // but keeping the import here makes the ordering explicit.
  const { initSchema } = await import("./db");

  console.log("Applying schema…");
  await initSchema();
  console.log("Schema is up to date.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
