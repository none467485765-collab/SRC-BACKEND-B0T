import type { Telegraf } from "telegraf";
import { db } from "@workspace/db";
import { usersTable, scheduledBroadcastsTable } from "@workspace/db/schema";
import { eq, lte, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const POLL_INTERVAL_MS = 60_000;

async function tick(bot: Telegraf): Promise<void> {
  const now = new Date();

  let due: typeof scheduledBroadcastsTable.$inferSelect[] = [];
  try {
    due = await db.query.scheduledBroadcastsTable.findMany({
      where: and(
        eq(scheduledBroadcastsTable.status, "pending"),
        lte(scheduledBroadcastsTable.scheduledAt, now),
      ),
    });
  } catch (err) {
    logger.error({ err }, "Scheduler DB query failed");
    return;
  }

  if (due.length === 0) return;

  for (const broadcast of due) {
    logger.info({ broadcastId: broadcast.id }, "Sending scheduled broadcast");

    // Mark as sending first to avoid double-send on restart
    await db
      .update(scheduledBroadcastsTable)
      .set({ status: "sent" })
      .where(eq(scheduledBroadcastsTable.id, broadcast.id));

    // Fetch all non-banned users
    let users: typeof usersTable.$inferSelect[] = [];
    try {
      users = await db.query.usersTable.findMany({
        where: eq(usersTable.isBanned, false),
      });
    } catch (err) {
      logger.error({ err, broadcastId: broadcast.id }, "Failed to fetch users for broadcast");
      continue;
    }

    let sent = 0;
    let failed = 0;
    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.telegramId, broadcast.message, { parse_mode: "HTML" });
        sent++;
      } catch {
        failed++;
      }
      // Small delay to avoid Telegram flood limits
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    logger.info({ broadcastId: broadcast.id, sent, failed }, "Scheduled broadcast complete");
  }
}

function safeTick(bot: Telegraf): void {
  tick(bot).catch((err) => {
    logger.error({ err }, "Scheduler tick threw unexpectedly");
  });
}

export function startScheduler(bot: Telegraf): NodeJS.Timeout {
  logger.info("Broadcast scheduler started (interval: 60s)");
  safeTick(bot);
  return setInterval(() => safeTick(bot), POLL_INTERVAL_MS);
}
