import app from "./app";
import { logger } from "./lib/logger";
import { startBot, stopBot } from "./bot";
import { pool } from "@workspace/db";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — continuing");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — continuing");
});

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    logger.info("Running DB migrations…");
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id           SERIAL PRIMARY KEY,
        telegram_id  BIGINT NOT NULL UNIQUE,
        username     TEXT,
        first_name   TEXT NOT NULL,
        is_banned    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id               SERIAL PRIMARY KEY,
        telegram_id      BIGINT NOT NULL REFERENCES users(telegram_id),
        plan_id          TEXT NOT NULL,
        plan_name        TEXT NOT NULL,
        plan_price_usd   TEXT NOT NULL,
        payment_status   TEXT NOT NULL DEFAULT 'waiting',
        coin             TEXT,
        crypto_expected  TEXT,
        amount_paid      TEXT,
        delivered_at     TIMESTAMP,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
        id           SERIAL PRIMARY KEY,
        message      TEXT NOT NULL,
        scheduled_at TIMESTAMP NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_by   BIGINT NOT NULL,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    logger.info("DB migrations complete");
  } finally {
    client.release();
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, async (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  await runMigrations();
  await startBot();
});

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  stopBot();
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
