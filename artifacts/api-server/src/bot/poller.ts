import type { Telegraf } from "telegraf";
import { db } from "@workspace/db";
import { ordersTable } from "@workspace/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { checkPaymentReceived } from "./payments";
import { type CoinSymbol } from "./config";
import { handlePaymentConfirmed } from "./handlers/customer";
import { logger } from "../lib/logger";

const POLL_INTERVAL_MS = 90_000;
const MAX_AGE_HOURS    = 24;

async function tick(bot: Telegraf): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);

  let pending: typeof ordersTable.$inferSelect[] = [];
  try {
    pending = await db.query.ordersTable.findMany({
      where: and(eq(ordersTable.paymentStatus, "waiting"), gte(ordersTable.createdAt, cutoff)),
    });
  } catch (err) {
    logger.error({ err }, "Poller DB query failed");
    return;
  }

  if (pending.length === 0) return;
  logger.info({ count: pending.length }, "Poller checking pending orders");

  for (const order of pending) {
    if (!order.coin || !order.cryptoExpected) continue;
    try {
      const paid = await checkPaymentReceived(
        order.coin as CoinSymbol,
        order.cryptoExpected,
        order.createdAt,
      );
      if (paid) {
        logger.info({ orderId: order.id, coin: order.coin }, "On-chain payment detected");
        await handlePaymentConfirmed(bot, order.id, "finished", order.coin, order.cryptoExpected);
      }
    } catch (err) {
      logger.warn({ err, orderId: order.id }, "Poller check error for order");
    }
  }
}

function safeTick(bot: Telegraf): void {
  tick(bot).catch((err) => {
    logger.error({ err }, "Poller tick threw unexpectedly — will retry next interval");
  });
}

export function startPoller(bot: Telegraf): NodeJS.Timeout {
  logger.info("Payment poller started (interval: 90s)");
  safeTick(bot);
  return setInterval(() => safeTick(bot), POLL_INTERVAL_MS);
}
