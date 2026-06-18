import { Telegraf, Markup, type Context } from "telegraf";
import { db } from "@workspace/db";
import { usersTable, ordersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import {
  PLANS,
  WALLETS,
  SELLER_USERNAME,
  SELLER_URL,
  WEBSITE_URL,
  CHANNEL_URL,
  FEATURES_TEXT,
  type PlanId,
  type CoinSymbol,
  getPlan,
} from "../config";
import { CE, BE } from "../emoji";
import { cbtn, ubtn, ICON, COIN_ICON } from "../buttons";
import { getCryptoAmount, getPaymentQrUrl } from "../payments";
import { logger } from "../../lib/logger";
import { sendAdminAlert } from "./admin";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

async function replaceMessage(
  ctx: Context,
  text: string,
  extra: Parameters<typeof ctx.reply>[1],
) {
  try {
    await ctx.deleteMessage();
  } catch {
    // Message too old or already gone — that's fine
  }
  await ctx.reply(text, extra);
}

function formatTicket(orderId: number): string {
  return `TKT-${String(orderId).padStart(6, "0")}`;
}

async function ensureUser(id: number, username: string | undefined, firstName: string) {
  await db
    .insert(usersTable)
    .values({ telegramId: id, username: username ?? null, firstName })
    .onConflictDoUpdate({
      target: usersTable.telegramId,
      set: { username: username ?? null, firstName },
    });
  return db.query.usersTable.findFirst({ where: eq(usersTable.telegramId, id) });
}

const PLAN_CE: Record<string, string> = {
  "1month":     CE.calendar,
  "1month_rdp": CE.tv,
  "lifetime":   CE.diamond,
};

const PLAN_BE: Record<string, string> = {
  "1month":     BE.calendar,
  "1month_rdp": BE.tv,
  "lifetime":   BE.diamond,
};

// Per-plan button icon (custom_emoji_id)
const PLAN_ICON: Record<string, string> = {
  "1month":     ICON.calendar,
  "1month_rdp": ICON.tv,
  "lifetime":   ICON.diamond,
};

// Coin display labels for buttons (premium icon supplied via COIN_ICON)
const COIN_BUTTON: Record<CoinSymbol, string> = {
  BTC:  "Bitcoin (BTC)",
  ETH:  "Ethereum (ETH)",
  USDT: "USDT TRC20",
  LTC:  "Litecoin (LTC)",
  SOL:  "Solana (SOL)",
  BNB:  "BNB Smart Chain",
};

// ──────────────────────────────────────────────
// Message templates
// ──────────────────────────────────────────────

function welcomeGreeting(firstName: string): string {
  return (
    `${CE.diamond} <b>Welcome to CELLIK R4T, ${firstName}!</b>\n\n` +
    `<blockquote>${CE.skull} <i>Control any Android device — Undetected. Unstoppable.</i></blockquote>`
  );
}

const MAIN_MENU_TEXT =
  `${CE.skull} <b>CELLIK R4T</b> — <i>Android Remote Access Tool</i>\n` +
  `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
  `<blockquote><i>The most advanced Android RAT on the market.\nTrusted by security professionals worldwide.</i></blockquote>\n\n` +
  `${CE.lightning} <b>Why CELLIK R4T?</b>\n` +
  `› 250+ Pre-Built Banking Overlays  ${CE.skull}\n` +
  `› Android 7.0 → 16+ Support  ${CE.usaflag}\n` +
  `› Full Stealth &amp; Hidden Operation  ${CE.shield}\n` +
  `› No Root Required  ${CE.star}\n` +
  `› FUD Crypting Service Included  ${CE.cool}\n` +
  `› No Port Forwarding Needed  ${CE.battery}\n\n` +
  `━━━━━━━━━━━━━━━━━━━━━━━\n` +
  `${CE.money} <b>Plans from $250/mo</b>  ·  ${CE.speak} ${SELLER_USERNAME}\n` +
  `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
  `<i>Select an option below</i> ${CE.wrench}`;

const MAIN_MENU_KEYBOARD = Markup.inlineKeyboard([
  [cbtn("Full Feature List", "show_features", { style: "primary", icon: ICON.controller })],
  [
    ubtn("Website", WEBSITE_URL, { style: "primary", icon: ICON.globe }),
    ubtn("Channel", CHANNEL_URL, { style: "primary", icon: ICON.speak }),
  ],
]);

function buildPlansText(): string {
  return (
    `${CE.diamond2} <b>CELLIK R4T</b> — <i>Choose Your Plan</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    PLANS.map(
      (p) =>
        `${PLAN_CE[p.id] ?? p.emoji} <b>${p.name}</b>  ·  <b>$${p.price}</b>  ·  <i>${p.badge}</i>\n` +
        `<blockquote>${p.highlights.map((h) => `› ${h}`).join("\n")}</blockquote>`,
    ).join("\n\n") +
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${CE.glowstar} <b>Pay directly with crypto</b> — <i>auto-verified on-chain</i>\n` +
    `<i>Tap a plan to choose your coin and get a payment address</i> ${CE.cart}`
  );
}

function plansKeyboard() {
  return Markup.inlineKeyboard([
    ...PLANS.map((plan) => [
      cbtn(`${plan.name} — $${plan.price}`, `plan:${plan.id}`, {
        style: "success",
        icon: PLAN_ICON[plan.id] ?? ICON.diamond,
      }),
    ]),
    [ubtn("Contact Support", SELLER_URL, { style: "primary", icon: ICON.contact })],
  ]);
}

function coinKeyboard(planId: string) {
  return Markup.inlineKeyboard([
    [
      cbtn(COIN_BUTTON.BTC,  `coin:${planId}:BTC`,  { style: "primary", icon: COIN_ICON.BTC }),
      cbtn(COIN_BUTTON.ETH,  `coin:${planId}:ETH`,  { style: "primary", icon: COIN_ICON.ETH }),
    ],
    [cbtn(COIN_BUTTON.USDT, `coin:${planId}:USDT`, { style: "primary", icon: COIN_ICON.USDT })],
    [
      cbtn(COIN_BUTTON.LTC, `coin:${planId}:LTC`, { style: "primary", icon: COIN_ICON.LTC }),
      cbtn(COIN_BUTTON.SOL, `coin:${planId}:SOL`, { style: "primary", icon: COIN_ICON.SOL }),
    ],
    [cbtn(COIN_BUTTON.BNB,  `coin:${planId}:BNB`, { style: "primary", icon: COIN_ICON.BNB })],
    [cbtn("Back to Plans", "show_plans", { style: "primary", icon: ICON.airplane })],
  ]);
}

const FEATURES_EXTRA = Markup.inlineKeyboard([
  [cbtn("Purchase Now", "show_plans", { style: "success", icon: ICON.cart })],
]);

// ──────────────────────────────────────────────
// Register handlers
// ──────────────────────────────────────────────

export function registerCustomerHandlers(bot: Telegraf) {
  // ── /start ──
  bot.start(async (ctx) => {
    const { id, username, first_name } = ctx.from;
    const user = await ensureUser(id, username, first_name);

    if (user?.isBanned) {
      await ctx.reply(`${CE.banned} You have been banned from this service.`, { parse_mode: "HTML" });
      return;
    }

    await ctx.reply(welcomeGreeting(first_name), { parse_mode: "HTML" });
    await ctx.reply(MAIN_MENU_TEXT, { parse_mode: "HTML", ...MAIN_MENU_KEYBOARD });
  });

  // ── /menu ──
  bot.command("menu", async (ctx) => {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.telegramId, ctx.from.id),
    });
    if (user?.isBanned) {
      await ctx.reply(`${CE.banned} You have been banned.`, { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(MAIN_MENU_TEXT, { parse_mode: "HTML", ...MAIN_MENU_KEYBOARD });
  });

  // ── /features ──
  bot.command("features", async (ctx) => {
    await ctx.reply(
      FEATURES_TEXT + `\n\n<i>Ready to get started?</i> ${CE.lightning}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [ubtn("Watch Video Demo", "https://t.me/CELLIKRAT_FEATURES/6", { style: "primary", icon: ICON.camera })],
          [cbtn("Purchase Now", "show_plans", { style: "success", icon: ICON.cart })],
          [ubtn("Contact Support", SELLER_URL, { style: "primary", icon: ICON.contact })],
        ]),
      },
    );
  });

  // ── Button: Back to main menu ──
  bot.action("go_start", async (ctx) => {
    await ctx.answerCbQuery();
    await replaceMessage(ctx, MAIN_MENU_TEXT, { parse_mode: "HTML", ...MAIN_MENU_KEYBOARD });
  });

  // ── Button: Full feature list ──
  bot.action("show_features", async (ctx) => {
    await ctx.answerCbQuery();
    await replaceMessage(
      ctx,
      FEATURES_TEXT + `\n\n<i>Ready to get started?</i> ${CE.lightning}`,
      { parse_mode: "HTML", ...FEATURES_EXTRA },
    );
  });

  // ── Button: Show plans ──
  bot.action("show_plans", async (ctx) => {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.telegramId, ctx.from.id),
    });
    if (user?.isBanned) {
      await ctx.answerCbQuery(`${BE.banned} You are banned from this service.`);
      return;
    }
    await ctx.answerCbQuery();
    await replaceMessage(ctx, buildPlansText(), { parse_mode: "HTML", ...plansKeyboard() });
  });

  // ── Button: Plan selected → coin picker ──
  bot.action(/^plan:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const planId = ctx.match[1] as PlanId;
    const plan = getPlan(planId);
    if (!plan) {
      await ctx.reply(`${CE.explosion} Invalid plan. Please try again.`, { parse_mode: "HTML" });
      return;
    }

    const userId = ctx.from.id;
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.telegramId, userId) });
    if (user?.isBanned) {
      await ctx.reply(`${CE.banned} You have been banned from this service.`, { parse_mode: "HTML" });
      return;
    }

    // Check for existing pending order
    const existing = await db.query.ordersTable.findFirst({
      where: and(eq(ordersTable.telegramId, userId), eq(ordersTable.paymentStatus, "waiting")),
    });

    if (existing) {
      const hasCoin = existing.coin && existing.cryptoExpected;
      const wallet = hasCoin ? WALLETS[existing.coin as CoinSymbol] : null;

      await replaceMessage(
        ctx,
        `${CE.exclamation} <b>Pending Payment Found</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<blockquote>You already have an open order for <b>${existing.planName}</b> ($${existing.planPriceUsd}).\n\n` +
          `${CE.shield} <b>Ticket:</b> <code>${formatTicket(existing.id)}</code>\n\n` +
          (hasCoin && wallet
            ? `${CE.money} <b>Coin:</b> ${wallet.name}\n` +
              `${CE.money} <b>Amount:</b> <code>${existing.cryptoExpected} ${existing.coin}</code>\n` +
              `${CE.globe} <b>Address:</b> <code>${wallet.address}</code>\n\n`
            : "") +
          `<i>Complete your payment or contact support to cancel.</i></blockquote>\n\n` +
          `${CE.speak} Need help? Contact ${SELLER_USERNAME}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            ...(hasCoin && wallet
              ? [[ubtn("Scan QR Code", getPaymentQrUrl(existing.coin as CoinSymbol, existing.cryptoExpected!), { style: "primary", icon: ICON.camera })]]
              : []),
            [cbtn("Back to Plans", "show_plans", { style: "primary", icon: ICON.airplane })],
            [ubtn("Contact Support", SELLER_URL, { style: "primary", icon: ICON.contact })],
          ]),
        },
      );
      return;
    }

    // Show coin selection
    await replaceMessage(
      ctx,
      `${CE.money} <b>CELLIK R4T</b> — <i>Choose Payment Coin</i>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${PLAN_CE[plan.id] ?? plan.emoji} <b>${plan.name}</b>  ·  <b>$${plan.price} USD</b>  ·  <i>${plan.badge}</i>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${CE.shield} <b>Direct to your wallet</b>  ·  ${CE.glowstar} <b>Zero middleman</b>\n` +
        `${CE.lightning} <i>Payment auto-confirmed the moment it lands on-chain.</i>\n\n` +
        `<blockquote><i>Choose your preferred cryptocurrency below:</i></blockquote>`,
      { parse_mode: "HTML", ...coinKeyboard(planId) },
    );
  });

  // ── Button: Coin selected → create order & show invoice ──
  bot.action(/^coin:([^:]+):([^:]+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const planId = ctx.match[1] as PlanId;
    const coinSymbol = ctx.match[2] as CoinSymbol;
    const plan = getPlan(planId);

    if (!plan || !(coinSymbol in WALLETS)) {
      await ctx.reply(`${CE.explosion} Invalid selection. Please try again.`, { parse_mode: "HTML" });
      return;
    }

    const userId = ctx.from.id;
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.telegramId, userId) });
    if (user?.isBanned) {
      await ctx.reply(`${CE.banned} You have been banned from this service.`, { parse_mode: "HTML" });
      return;
    }

    const wallet = WALLETS[coinSymbol];

    // Show loading state while fetching live price
    await replaceMessage(
      ctx,
      `${CE.lightning} <b>Fetching Live Price...</b> ${CE.controller}\n\n` +
        `<blockquote>${PLAN_CE[plan.id] ?? plan.emoji} <b>${plan.name}</b> — $${plan.price}\n` +
        `${CE.money} <i>Getting ${wallet.name} rate from market...</i></blockquote>`,
      { parse_mode: "HTML" },
    );

    let cryptoAmount: string;
    try {
      cryptoAmount = await getCryptoAmount(plan.price, coinSymbol);
    } catch (err) {
      logger.error({ err }, "Failed to fetch crypto price");
      await ctx.reply(
        `${CE.explosion} <b>Price Fetch Failed</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<blockquote><i>Could not get a live price right now. Please try again in a moment.</i></blockquote>\n\n` +
          `${CE.speak} ${SELLER_USERNAME}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [cbtn("Try Again", `plan:${planId}`, { style: "primary", icon: ICON.lightning })],
            [ubtn("Contact Support", SELLER_URL, { style: "primary", icon: ICON.contact })],
          ]),
        },
      );
      return;
    }

    // Create order in DB
    let order: typeof ordersTable.$inferSelect;
    try {
      const [inserted] = await db
        .insert(ordersTable)
        .values({
          telegramId: userId,
          planId: plan.id,
          planName: plan.name,
          planPriceUsd: String(plan.price),
          paymentStatus: "waiting",
          coin: coinSymbol,
          cryptoExpected: cryptoAmount,
        })
        .returning();
      order = inserted!;
    } catch (err) {
      logger.error({ err }, "Failed to create order");
      await ctx.reply(
        `${CE.explosion} <b>Order Creation Failed</b>\n\n` +
          `<blockquote><i>Please try again or contact support.</i></blockquote>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [cbtn("Try Again", `plan:${planId}`, { style: "primary", icon: ICON.lightning })],
            [ubtn("Contact Support", SELLER_URL, { style: "primary", icon: ICON.contact })],
          ]),
        },
      );
      return;
    }

    const ticket = formatTicket(order.id);
    const qrUrl  = getPaymentQrUrl(coinSymbol, cryptoAmount);

    await ctx.reply(
      `${CE.star} <b>Payment Invoice Ready</b> ${CE.diamond}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${PLAN_CE[plan.id] ?? plan.emoji} <b>${plan.name}</b>  ·  <b>$${plan.price} USD</b>  ·  <i>${plan.badge}</i>\n` +
        `${CE.money} <b>Paying with:</b> ${wallet.name}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${CE.lightning} <b>SEND EXACTLY:</b>\n\n` +
        `<blockquote><code>${cryptoAmount} ${coinSymbol}</code></blockquote>\n\n` +
        `${CE.globe} <b>TO THIS ADDRESS:</b>\n\n` +
        `<blockquote><code>${wallet.address}</code></blockquote>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${CE.shield} <b>YOUR TICKET:</b> <code>${ticket}</code>\n` +
        `${CE.calendar} <b>Valid for:</b> 24 hours\n\n` +
        `<blockquote>${CE.glowstar} <i>QR encodes this exact address. Scan it to auto-fill your wallet.\n\n` +
        `${CE.exclamation} Send the exact amount. Payment verified on-chain automatically.\n\n` +
        `After paying, share your TXN hash with ${SELLER_USERNAME} for instant delivery.</i></blockquote>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [ubtn("Scan QR Code", qrUrl, { style: "primary", icon: ICON.camera })],
          [ubtn("Contact Seller", SELLER_URL, { style: "success", icon: ICON.contact })],
          [cbtn("Back to Plans", "show_plans", { style: "primary", icon: ICON.airplane })],
        ]),
      },
    );

    logger.info({ orderId: order.id, planId, coinSymbol, cryptoAmount, userId }, "Order created");
  });
}

// ──────────────────────────────────────────────
// Called by poller (or webhook) on confirmed payment
// ──────────────────────────────────────────────

export async function handlePaymentConfirmed(
  bot: Telegraf,
  orderId: number,
  paymentStatus: string,
  coin: string,
  amountPaid: string,
): Promise<void> {
  // Atomic update: only succeeds when the order is still "waiting".
  // If two concurrent callers (poller tick + force-check) race, exactly one
  // will get a returned row and proceed with notifications; the other exits.
  const [updated] = await db
    .update(ordersTable)
    .set({ paymentStatus, coin: coin || null, amountPaid: amountPaid || null })
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.paymentStatus, "waiting")))
    .returning();

  if (!updated) {
    logger.info({ orderId }, "Payment already processed by concurrent caller — skipping notification");
    return;
  }

  // Use the updated row for all fields so we never reference stale data
  const order = updated;

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.telegramId, order.telegramId),
  });

  try {
    await bot.telegram.sendMessage(
      order.telegramId,
      `${CE.thumbsup} <b>Payment Confirmed!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<i>Thank you for your purchase!</i> ${CE.diamond}\n\n` +
        `<blockquote>${CE.cart} <b>Plan:</b> ${order.planName}\n` +
        `${CE.money} <b>Amount:</b> $${order.planPriceUsd} USD\n` +
        `${CE.money} <b>Coin:</b> ${coin || "N/A"}\n` +
        `${CE.money} <b>Paid:</b> ${amountPaid} ${coin}\n` +
        `${CE.shield} <b>Ticket:</b> <code>${formatTicket(order.id)}</code></blockquote>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<blockquote><i>The seller will contact you shortly at ${SELLER_USERNAME}.</i></blockquote>\n\n` +
        `<i>Please keep this message for reference.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [ubtn("Contact Seller Now", SELLER_URL, { style: "success", icon: ICON.contact })],
          [
            ubtn("Website", WEBSITE_URL, { style: "primary", icon: ICON.globe }),
            ubtn("Official Channel", CHANNEL_URL, { style: "primary", icon: ICON.speak }),
          ],
        ]),
      },
    );
  } catch (err) {
    logger.error({ err, telegramId: order.telegramId }, "Failed to DM buyer");
  }

  const uname = user?.username ? `@${user.username}` : `ID: ${order.telegramId}`;
  await sendAdminAlert(
    bot,
    `${CE.thumbsup} <b>NEW PAYMENT RECEIVED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<blockquote>${CE.cool} <b>Buyer:</b> ${uname}\n` +
      `${CE.globe} <b>Telegram ID:</b> <code>${order.telegramId}</code>\n` +
      `${CE.cart} <b>Plan:</b> ${order.planName}\n` +
      `${CE.money} <b>Amount:</b> $${order.planPriceUsd} USD\n` +
      `${CE.money} <b>Coin:</b> ${coin || "N/A"}\n` +
      `${CE.money} <b>Paid:</b> ${amountPaid} ${coin}\n` +
      `${CE.shield} <b>Ticket:</b> <code>${formatTicket(order.id)}</code>\n` +
      `${CE.star} <b>Status:</b> <i>${paymentStatus}</i></blockquote>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<blockquote>${CE.airplane} <i>Contact the buyer to deliver access!\nUse /confirmorder ${formatTicket(order.id)} once delivered.</i></blockquote>`,
  );

  logger.info({ orderId, paymentStatus, telegramId: order.telegramId }, "Payment notification sent");
}
