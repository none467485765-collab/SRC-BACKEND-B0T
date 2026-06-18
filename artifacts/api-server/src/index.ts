import app from "./app";
import { logger } from "./lib/logger";
import { startBot, stopBot } from "./bot";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — continuing");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — continuing");
});

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
