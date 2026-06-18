import { Router, type IRouter } from "express";
import { getBot, getWebhookSecret } from "../bot";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Telegram pushes updates here the instant a message arrives.
// Verified with the secret token we set during webhook registration.
router.post("/bot/webhook", async (req, res) => {
  // Verify secret token — reject anything not from Telegram
  const incoming = req.headers["x-telegram-bot-api-secret-token"] as string | undefined;
  const expected = getWebhookSecret();
  if (!expected || incoming !== expected) {
    logger.warn({ incoming: !!incoming, expected: !!expected }, "Webhook rejected — bad secret");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const bot = getBot();
  if (!bot) {
    logger.error("Webhook hit but bot is not initialised");
    res.status(503).json({ error: "Bot not initialised" });
    return;
  }

  const updateId: number | undefined = (req.body as { update_id?: number })?.update_id;
  const updateType = Object.keys(req.body as object).find((k) => k !== "update_id") ?? "unknown";
  logger.info({ updateId, updateType }, "Webhook update received");

  // Respond 200 immediately so Telegram doesn't retry
  res.status(200).json({ ok: true });

  // Process the update asynchronously after ACK
  bot.handleUpdate(req.body).catch((err) => {
    logger.error({ err, updateId }, "Webhook update handling failed");
  });
});

export default router;
