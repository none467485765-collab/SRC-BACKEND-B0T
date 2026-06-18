import { createHash } from "crypto";
import { Telegraf } from "telegraf";
import { logger } from "../lib/logger";
import { registerCustomerHandlers } from "./handlers/customer";
import { registerAdminHandlers } from "./handlers/admin";
import { startPoller } from "./poller";
import { startScheduler } from "./scheduler";
import { ADMIN_IDS } from "./config";

const ADMIN_COMMANDS = [
  { command: "stats",          description: "Statistics & revenue" },
  { command: "revenue",        description: "Full revenue report" },
  { command: "users",          description: "Recent user list" },
  { command: "orders",         description: "All recent orders" },
  { command: "pending",        description: "Pending orders only" },
  { command: "lookup",         description: "Lookup by TKT / user ID / @username" },
  { command: "confirmorder",   description: "Confirm order & notify user" },
  { command: "cancelorder",    description: "Cancel order & notify user" },
  { command: "adduser",        description: "Grant manual access to a user" },
  { command: "message",        description: "DM any user via bot" },
  { command: "broadcast",      description: "Send message to all users" },
  { command: "ban",            description: "Ban a user" },
  { command: "unban",          description: "Unban a user" },
  { command: "schedule",       description: "Schedule a broadcast" },
  { command: "schedules",      description: "View pending scheduled broadcasts" },
  { command: "cancelschedule", description: "Cancel a scheduled broadcast" },
  { command: "admin",          description: "Open admin panel" },
];

// Deterministic secret — derived from the bot token so no extra config needed.
// Telegram sends it back in X-Telegram-Bot-Api-Secret-Token on every webhook call.
function makeWebhookSecret(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 64);
}

let botInstance: Telegraf | null = null;
let webhookSecret: string | null = null;

export function getBot(): Telegraf | null { return botInstance; }
export function getWebhookSecret(): string | null { return webhookSecret; }

// ── Webhook mode ──────────────────────────────────────────────
// Telegram pushes updates to our HTTPS endpoint the instant a message arrives.
// No polling loop = no AbortSignal crash, no 30-second dead windows.

async function startViaWebhook(bot: Telegraf, webhookUrl: string, secret: string): Promise<void> {
  try {
    await bot.telegram.setWebhook(webhookUrl, {
      secret_token: secret,
      allowed_updates: [
        "message", "callback_query", "inline_query",
        "chosen_inline_result", "channel_post",
      ],
      drop_pending_updates: true,
    });
    logger.info({ webhookUrl }, "Telegram webhook registered — instant delivery active");
  } catch (err) {
    logger.error({ err, webhookUrl }, "Failed to register webhook — falling back to polling");
    await startViaPolling(bot);
  }
}

// ── Polling fallback ──────────────────────────────────────────
// Used only when webhook URL cannot be determined (local dev without domain).

const POLL_RETRY_MS = 5_000;

async function startViaPolling(bot: Telegraf): Promise<void> {
  logger.info("Starting in polling mode (no webhook URL available)");
  for (let attempt = 1; attempt <= 9999; attempt++) {
    try {
      await bot.launch({ dropPendingUpdates: true });
      return; // clean stop
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ attempt, retryInMs: POLL_RETRY_MS, msg }, "Bot polling error — retrying");
      await new Promise<void>((r) => setTimeout(r, POLL_RETRY_MS));
    }
  }
}

// ── startBot ──────────────────────────────────────────────────

export async function startBot(): Promise<Telegraf | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot will not start");
    return null;
  }

  const bot = new Telegraf(token);
  const secret = makeWebhookSecret(token);
  webhookSecret = secret;

  registerCustomerHandlers(bot);
  registerAdminHandlers(bot);

  bot.catch((err, ctx) => {
    logger.error({ err, updateType: ctx.updateType }, "Bot middleware error");
  });

  // Start on-chain payment poller (every 90s)
  startPoller(bot);

  // Start scheduled broadcast runner (every 60s)
  startScheduler(bot);

  // Set admin commands — fire-and-forget so a slow Telegram API call
  // never blocks webhook registration or bot initialisation.
  Promise.all(
    ADMIN_IDS.map((adminId) =>
      bot.telegram
        .setMyCommands(ADMIN_COMMANDS, {
          scope: { type: "chat", chat_id: adminId },
        })
        .catch((err) => logger.warn({ err, adminId }, "Could not set admin commands")),
    ),
  ).catch(() => { /* individual errors already logged above */ });

  // Prefer webhook; fall back to polling if no domain is set
  const domain =
    process.env.WEBHOOK_DOMAIN ??
    process.env.REPLIT_DEV_DOMAIN;

  if (domain) {
    const webhookUrl = `https://${domain}/api/bot/webhook`;
    startViaWebhook(bot, webhookUrl, secret).catch((err) => {
      logger.error({ err }, "Webhook startup failed unexpectedly");
    });
  } else {
    startViaPolling(bot).catch((err) => {
      logger.error({ err }, "Polling startup failed unexpectedly");
    });
  }

  botInstance = bot;
  logger.info("Telegram bot initialised");
  return bot;
}

export function stopBot(): void {
  if (botInstance) {
    botInstance.stop("SIGTERM");
    botInstance = null;
    logger.info("Telegram bot stopped");
  }
}
