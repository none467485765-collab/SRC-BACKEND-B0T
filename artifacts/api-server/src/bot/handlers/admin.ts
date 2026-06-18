import { Telegraf, Markup, type Context } from "telegraf";
import type { Message } from "telegraf/types";
import { db } from "@workspace/db";
import { usersTable, ordersTable, scheduledBroadcastsTable } from "@workspace/db/schema";
import { eq, desc, count, and, gte, ilike, ne } from "drizzle-orm";
import { ADMIN_IDS, PLANS, getPlan, SELLER_URL, WALLETS, type CoinSymbol } from "../config";
import { CE, BE } from "../emoji";
import { cbtn, ubtn, ICON, COIN_ICON } from "../buttons";
import { getCryptoAmount, getPaymentQrUrl, checkPaymentReceived } from "../payments";
import { logger } from "../../lib/logger";

// ──────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────

function htmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTicket(orderId: number): string {
  return `TKT-${String(orderId).padStart(6, "0")}`;
}

function parseTicket(input: string): number | null {
  const m = input.match(/^TKT-(\d+)$/i);
  return m ? parseInt(m[1]!, 10) : null;
}

const PLAN_ALIASES: Record<string, string> = {
  "1m": "1month", "1month": "1month", "month": "1month", "starter": "1month",
  "rdp": "1month_rdp", "1month_rdp": "1month_rdp", "1m+rdp": "1month_rdp", "popular": "1month_rdp",
  "lifetime": "lifetime", "life": "lifetime", "lf": "lifetime", "forever": "lifetime",
};

function statusIcon(s: string): string {
  return s === "finished"  ? CE.thumbsup
       : s === "confirmed" ? CE.cool
       : s === "waiting"   ? CE.lightning
       : s === "cancelled" ? CE.brokenheart
       :                     CE.explosion;
}

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ──────────────────────────────────────────────
// Guards & helpers
// ──────────────────────────────────────────────

export function isAdmin(id: number): boolean {
  return ADMIN_IDS.includes(id);
}

function adminOnly(fn: (ctx: Context) => Promise<void>) {
  return async (ctx: Context) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) {
      await ctx.reply(
        `${CE.banned} <b>Access Denied</b>\n\n<blockquote><i>This command is restricted to administrators only.</i></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }
    await fn(ctx);
  };
}

async function replaceMessage(
  ctx: Context,
  text: string,
  extra: Parameters<typeof ctx.reply>[1],
) {
  try { await ctx.deleteMessage(); } catch { /* already gone */ }
  await ctx.reply(text, extra);
}

// ──────────────────────────────────────────────
// Alert helper
// ──────────────────────────────────────────────

export async function sendAdminAlert(bot: Telegraf, message: string): Promise<void> {
  for (const adminId of ADMIN_IDS) {
    try {
      await bot.telegram.sendMessage(adminId, message, { parse_mode: "HTML" });
    } catch (err) {
      logger.error({ err, adminId }, "Failed to send admin alert");
    }
  }
}

// ──────────────────────────────────────────────
// Stats builder
// ──────────────────────────────────────────────

async function buildStats() {
  const sevenDaysAgo   = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalFinished] = await db.select({ count: count() }).from(ordersTable)
    .where(and(eq(ordersTable.paymentStatus, "finished"), ne(ordersTable.planId, "test")));
  const [totalConfirmed] = await db.select({ count: count() }).from(ordersTable)
    .where(and(eq(ordersTable.paymentStatus, "confirmed"), ne(ordersTable.planId, "test")));
  const [recentPaid7d] = await db.select({ count: count() }).from(ordersTable)
    .where(and(eq(ordersTable.paymentStatus, "finished"), ne(ordersTable.planId, "test"), gte(ordersTable.createdAt, sevenDaysAgo)));
  const [recentPaid30d] = await db.select({ count: count() }).from(ordersTable)
    .where(and(eq(ordersTable.paymentStatus, "finished"), ne(ordersTable.planId, "test"), gte(ordersTable.createdAt, thirtyDaysAgo)));
  const [totalPending] = await db.select({ count: count() }).from(ordersTable)
    .where(and(eq(ordersTable.paymentStatus, "waiting"), ne(ordersTable.planId, "test")));
  const [totalUsers] = await db.select({ count: count() }).from(usersTable);
  const [bannedUsers] = await db.select({ count: count() }).from(usersTable)
    .where(eq(usersTable.isBanned, true));

  const planStats = await Promise.all(
    PLANS.map(async (plan) => {
      const [s] = await db.select({ count: count() }).from(ordersTable)
        .where(and(eq(ordersTable.planId, plan.id), eq(ordersTable.paymentStatus, "finished")));
      return { plan, count: s.count };
    }),
  );

  const totalRevenue   = planStats.reduce((acc, { plan, count: c }) => acc + plan.price * c, 0);
  const totalSales     = totalFinished.count;
  const totalPaidCount = totalFinished.count + totalConfirmed.count;

  return { totalSales, totalPaidCount, recentPaid: recentPaid7d, recentPaid30d, totalPending, totalUsers, bannedUsers, planStats, totalRevenue };
}

// ──────────────────────────────────────────────
// Admin panel menu
// ──────────────────────────────────────────────

function adminMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      cbtn("Statistics", "admin:stats", { style: "primary", icon: ICON.star }),
      cbtn("Revenue", "admin:revenue", { style: "success", icon: ICON.money }),
    ],
    [
      cbtn("Orders", "admin:orders:0", { style: "primary", icon: ICON.cart }),
      cbtn("Pending", "admin:pending:0", { style: "primary", icon: ICON.lightning }),
    ],
    [
      cbtn("Users", "admin:users:0", { style: "primary", icon: ICON.cool }),
      cbtn("Broadcast", "admin:broadcast_info", { style: "primary", icon: ICON.speak }),
    ],
    [cbtn("Test Gateways", "admin:testgw", { style: "primary", icon: ICON.tool })],
    [cbtn("Commands", "admin:help", { style: "primary", icon: ICON.wrench })],
  ]);
}

function buildAdminMenuText(firstName: string, userCount: number, orderCount: number, pendingCount: number): string {
  return (
    `${CE.shield} <b>CELLIK R4T — Admin Panel</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${CE.cool} <i>Welcome back,</i> <b>${htmlEscape(firstName)}</b>\n\n` +
    `${CE.star} <b>Quick Overview</b>\n` +
    `<blockquote>${CE.cool} Total Users: <b>${userCount}</b>\n` +
    `${CE.cart} Total Sales: <b>${orderCount}</b>\n` +
    `${CE.lightning} Pending: <b>${pendingCount}</b></blockquote>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Select an option below</i> ${CE.wrench}`
  );
}

const ADMIN_HELP_TEXT =
  `${CE.shield} <b>Admin Commands</b>\n` +
  `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

  `${CE.star} <b>Overview</b>\n` +
  `<blockquote>/stats — <i>statistics &amp; revenue</i>\n` +
  `/revenue — <i>full revenue report</i>\n` +
  `/users — <i>recent user list</i>\n` +
  `/orders — <i>all recent orders</i>\n` +
  `/pending — <i>pending orders only</i></blockquote>\n\n` +

  `${CE.globe} <b>Lookup</b>\n` +
  `<blockquote>/lookup &lt;TKT-XXXXXX&gt; — <i>by ticket ID</i>\n` +
  `/lookup &lt;user_id&gt; — <i>by Telegram ID</i>\n` +
  `/lookup &lt;@username&gt; — <i>by username</i></blockquote>\n\n` +

  `${CE.cart} <b>Order Management</b>\n` +
  `<blockquote>/confirmorder &lt;TKT-XXXXXX&gt; — <i>confirm &amp; notify user</i>\n` +
  `/cancelorder &lt;TKT-XXXXXX&gt; [reason] — <i>cancel &amp; notify</i>\n` +
  `/adduser &lt;user_id&gt; &lt;plan&gt; — <i>grant manual access</i></blockquote>\n\n` +

  `${CE.speak} <b>Messaging</b>\n` +
  `<blockquote>/message &lt;user_id&gt; &lt;text&gt; — <i>DM any user via bot</i>\n` +
  `/broadcast &lt;text&gt; — <i>send to all users</i></blockquote>\n\n` +

  `${CE.banned} <b>User Management</b>\n` +
  `<blockquote>/ban &lt;user_id&gt; [reason] — <i>ban user</i>\n` +
  `/unban &lt;user_id&gt; — <i>unban user</i></blockquote>\n\n` +

  `${CE.calendar} <b>Scheduled Broadcasts</b>\n` +
  `<blockquote>/schedule &lt;time&gt; &lt;message&gt; — <i>queue a broadcast (e.g. 2h, 30m, 1d)</i>\n` +
  `/schedules — <i>view pending broadcasts</i>\n` +
  `/cancelschedule &lt;ID&gt; — <i>cancel a queued broadcast</i></blockquote>\n\n` +

  `━━━━━━━━━━━━━━━━━━━━━━━\n` +
  `<i>All commands are admin-only.</i>`;

// ──────────────────────────────────────────────
// Register handlers
// ──────────────────────────────────────────────

export function registerAdminHandlers(bot: Telegraf) {

  // ════════════════════════════════
  // PANEL COMMANDS
  // ════════════════════════════════

  bot.command("admin", adminOnly(async (ctx) => {
    const [totalOrders] = await db.select({ count: count() }).from(ordersTable)
      .where(and(eq(ordersTable.paymentStatus, "finished"), ne(ordersTable.planId, "test")));
    const [totalUsers] = await db.select({ count: count() }).from(usersTable);
    const [pending] = await db.select({ count: count() }).from(ordersTable)
      .where(and(eq(ordersTable.paymentStatus, "waiting"), ne(ordersTable.planId, "test")));

    await ctx.reply(
      buildAdminMenuText(ctx.from!.first_name, totalUsers.count, totalOrders.count, pending.count),
      { parse_mode: "HTML", ...adminMenuKeyboard() },
    );
  }));

  // ── /stats ──
  bot.command("stats", adminOnly(async (ctx) => {
    const { totalSales, recentPaid, recentPaid30d, totalPending, totalUsers, bannedUsers, planStats, totalRevenue } = await buildStats();
    await ctx.reply(
      `${CE.star} <b>CELLIK R4T — Statistics</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${CE.money} <b>Revenue &amp; Sales</b>\n` +
        `<blockquote>${CE.money} Total Profit: <b>$${totalRevenue.toLocaleString()} USD</b>\n` +
        `${CE.cart} Total Sales: <b>${totalSales}</b> orders\n` +
        `${CE.calendar} Last 30 days: <b>${recentPaid30d.count}</b> sales\n` +
        `${CE.calendar} Last 7 days: <b>${recentPaid.count}</b> sales\n` +
        `${CE.lightning} Pending: <b>${totalPending.count}</b> orders</blockquote>\n\n` +
        `${CE.star} <b>Sales by Plan</b>\n` +
        `<blockquote>${planStats.map(({ plan, count: c }) =>
          `${plan.emoji} <b>${plan.name}</b>: <b>${c}x</b> = <b>$${(plan.price * c).toLocaleString()}</b>`,
        ).join("\n")}</blockquote>\n\n` +
        `${CE.globe} <b>Users</b>\n` +
        `<blockquote>${CE.cool} Registered: <b>${totalUsers.count}</b>\n` +
        `${CE.banned} Banned: <b>${bannedUsers.count}</b></blockquote>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: "HTML" },
    );
  }));

  // ── /revenue ──
  bot.command("revenue", adminOnly(async (ctx) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000);

    const [total30d] = await db.select({ count: count() }).from(ordersTable)
      .where(and(eq(ordersTable.paymentStatus, "finished"), ne(ordersTable.planId, "test"), gte(ordersTable.createdAt, thirtyDaysAgo)));
    const [total7d] = await db.select({ count: count() }).from(ordersTable)
      .where(and(eq(ordersTable.paymentStatus, "finished"), ne(ordersTable.planId, "test"), gte(ordersTable.createdAt, sevenDaysAgo)));

    const planStats = await Promise.all(
      PLANS.map(async (plan) => {
        const [all] = await db.select({ count: count() }).from(ordersTable)
          .where(and(eq(ordersTable.planId, plan.id), eq(ordersTable.paymentStatus, "finished")));
        const [last30] = await db.select({ count: count() }).from(ordersTable)
          .where(and(
            eq(ordersTable.planId, plan.id),
            eq(ordersTable.paymentStatus, "finished"),
            gte(ordersTable.createdAt, thirtyDaysAgo),
          ));
        return { plan, total: all.count, last30: last30.count };
      }),
    );

    const totalRevAll = planStats.reduce((a, { plan, total }) => a + plan.price * total, 0);
    const totalRev30d = planStats.reduce((a, { plan, last30 }) => a + plan.price * last30, 0);

    await ctx.reply(
      `${CE.money} <b>Full Revenue Report</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${CE.diamond} <b>All-Time</b>\n` +
        `<blockquote>${CE.money} Revenue: <b>$${totalRevAll.toLocaleString()} USD</b>\n` +
        `${CE.cart} Orders: <b>${planStats.reduce((a, { total }) => a + total, 0)}</b></blockquote>\n\n` +
        `${CE.calendar} <b>Last 30 Days</b>\n` +
        `<blockquote>${CE.money} Revenue: <b>$${totalRev30d.toLocaleString()} USD</b>\n` +
        `${CE.cart} Orders: <b>${total30d.count}</b></blockquote>\n\n` +
        `${CE.lightning} <b>Last 7 Days</b>\n` +
        `<blockquote>${CE.cart} Orders: <b>${total7d.count}</b></blockquote>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${CE.star} <b>Breakdown by Plan</b>\n\n` +
        planStats.map(({ plan, total, last30 }) =>
          `${plan.emoji} <b>${plan.name}</b> <i>($${plan.price})</i>\n` +
          `<blockquote>All-time: <b>${total}</b> ${CE.airplane} <b>$${(plan.price * total).toLocaleString()}</b>\n` +
          `Last 30d: <b>${last30}</b> ${CE.airplane} <b>$${(plan.price * last30).toLocaleString()}</b></blockquote>`,
        ).join("\n\n") +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: "HTML" },
    );
  }));

  // ── /pending ──
  bot.command("pending", adminOnly(async (ctx) => {
    const rows = await db.query.ordersTable.findMany({
      where: eq(ordersTable.paymentStatus, "waiting"),
      orderBy: [desc(ordersTable.createdAt)],
      limit: 15,
    });

    if (rows.length === 0) {
      await ctx.reply(
        `${CE.thumbsup} <b>No Pending Orders</b>\n\n<blockquote><i>All orders are up to date.</i></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    await ctx.reply(
      `${CE.lightning} <b>Pending Orders</b> <i>(${rows.length})</i>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        rows.map((o) =>
          `${CE.lightning} <b>${formatTicket(o.id)}</b> — <i>${o.planName}</i>\n` +
          `<blockquote>${CE.money} <b>$${o.planPriceUsd}</b>  ·  ${CE.cool} <code>${o.telegramId}</code>\n` +
          `${CE.calendar} ${fmtDate(o.createdAt)}</blockquote>`,
        ).join("\n\n") +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>/confirmorder &lt;TKT&gt; · /cancelorder &lt;TKT&gt; [reason]</i>`,
      { parse_mode: "HTML" },
    );
  }));

  // ── /orders ──
  bot.command("orders", adminOnly(async (ctx) => {
    const rows = await db.query.ordersTable.findMany({
      orderBy: [desc(ordersTable.createdAt)],
      limit: 10,
    });
    if (rows.length === 0) {
      await ctx.reply(`${CE.cart} <i>No orders yet.</i>`, { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(
      `${CE.cart} <b>Latest Orders</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        rows.map((o) =>
          `${statusIcon(o.paymentStatus)}${o.deliveredAt ? ` ${CE.airplane}` : ""} <b>${formatTicket(o.id)}</b> — <i>${o.planName}</i>\n` +
          `<blockquote>${CE.money} <b>$${o.planPriceUsd}</b>  ·  ${CE.cool} <code>${o.telegramId}</code></blockquote>`,
        ).join("\n\n"),
      { parse_mode: "HTML" },
    );
  }));

  // ── /users ──
  bot.command("users", adminOnly(async (ctx) => {
    const rows = await db.query.usersTable.findMany({
      orderBy: [desc(usersTable.createdAt)],
      limit: 10,
    });
    if (rows.length === 0) {
      await ctx.reply(`${CE.globe} <i>No users yet.</i>`, { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(
      `${CE.globe} <b>Latest Users</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        rows.map((u) =>
          `${u.isBanned ? CE.banned : CE.cool} <b>${htmlEscape(u.firstName)}</b>${u.username ? ` <i>(@${htmlEscape(u.username)})</i>` : ""}\n` +
          `<blockquote>${CE.globe} <code>${u.telegramId}</code>${u.isBanned ? `  ·  ${CE.banned} <b>BANNED</b>` : ""}</blockquote>`,
        ).join("\n\n"),
      { parse_mode: "HTML" },
    );
  }));

  // ════════════════════════════════
  // LOOKUP
  // ════════════════════════════════

  bot.command("lookup", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const arg = msg.text.split(/\s+/)[1]?.trim();

    if (!arg) {
      await ctx.reply(
        `${CE.globe} <b>Lookup</b>\n\n` +
          `<blockquote>/lookup TKT-000001 — <i>by ticket ID</i>\n` +
          `/lookup 123456789 — <i>by Telegram ID</i>\n` +
          `/lookup @username — <i>by username</i></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const ticketNum = parseTicket(arg);
    if (ticketNum !== null) {
      const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, ticketNum) });
      if (!order) {
        await ctx.reply(`${CE.explosion} Ticket <code>${htmlEscape(arg)}</code> not found.`, { parse_mode: "HTML" });
        return;
      }
      const user = await db.query.usersTable.findFirst({ where: eq(usersTable.telegramId, order.telegramId) });
      await ctx.reply(buildOrderDetail(order, user ?? null), { parse_mode: "HTML" });
      return;
    }

    if (arg.startsWith("@")) {
      const uname = arg.slice(1);
      const user = await db.query.usersTable.findFirst({ where: ilike(usersTable.username, uname) });
      if (!user) {
        await ctx.reply(`${CE.explosion} Username <code>${htmlEscape(arg)}</code> not found.`, { parse_mode: "HTML" });
        return;
      }
      await replyWithUserProfile(ctx, user);
      return;
    }

    const numericId = parseInt(arg, 10);
    if (!isNaN(numericId)) {
      const user = await db.query.usersTable.findFirst({ where: eq(usersTable.telegramId, numericId) });
      if (!user) {
        await ctx.reply(`${CE.explosion} User ID <code>${numericId}</code> not found.`, { parse_mode: "HTML" });
        return;
      }
      await replyWithUserProfile(ctx, user);
      return;
    }

    await ctx.reply(`${CE.explosion} Invalid argument: <code>${htmlEscape(arg)}</code>`, { parse_mode: "HTML" });
  }));

  // ════════════════════════════════
  // ORDER MANAGEMENT
  // ════════════════════════════════

  // ── /confirmorder <TKT-XXXXXX> ──
  bot.command("confirmorder", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const parts = msg.text.split(/\s+/);
    const arg = parts[1] ?? "";
    const ticketNum = parseTicket(arg);
    const orderId = ticketNum ?? parseInt(arg, 10);

    if (!orderId || isNaN(orderId)) {
      await ctx.reply(
        `<blockquote>${CE.wrench} <b>Usage:</b> /confirmorder &lt;TKT-XXXXXX&gt;\n<i>Example: /confirmorder TKT-000001</i></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, orderId) });
    if (!order) {
      await ctx.reply(`${CE.explosion} Ticket <code>${formatTicket(orderId)}</code> not found.`, { parse_mode: "HTML" });
      return;
    }
    if (order.paymentStatus === "confirmed" || order.paymentStatus === "cancelled") {
      await ctx.reply(
        `${CE.exclamation} <code>${formatTicket(orderId)}</code> is already <b>${order.paymentStatus}</b> — cannot confirm.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    await db.update(ordersTable)
      .set({ paymentStatus: "finished" })
      .where(eq(ordersTable.id, orderId));

    logger.info({ adminId: ctx.from!.id, orderId }, "Order manually confirmed");

    try {
      await bot.telegram.sendMessage(
        order.telegramId,
        `${CE.thumbsup} <b>Payment Confirmed!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<i>Your order has been manually confirmed by our team.</i>\n\n` +
          `<blockquote>${CE.cart} <b>Plan:</b> ${order.planName}\n` +
          `${CE.money} <b>Amount:</b> $${order.planPriceUsd} USD\n` +
          `${CE.shield} <b>Ticket:</b> <code>${formatTicket(orderId)}</code></blockquote>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<blockquote><i>The seller will contact you shortly.</i></blockquote>\n\n` +
          `<i>Thank you for choosing CELLIK R4T!</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[ubtn("Contact Seller", SELLER_URL, { style: "primary", icon: ICON.contact })]]),
        },
      );
    } catch (err) {
      logger.error({ err }, "Failed to DM buyer on confirm");
    }

    await ctx.reply(
      `${CE.thumbsup} <b>Order Confirmed</b>\n\n` +
        `<blockquote><code>${formatTicket(orderId)}</code> — <i>${order.planName}</i>\n` +
        `${CE.cool} Buyer <code>${order.telegramId}</code> has been notified.</blockquote>\n\n` +
        `<i>Use /deliver ${formatTicket(orderId)} once access is delivered.</i>`,
      { parse_mode: "HTML" },
    );
  }));

  // ── /cancelorder <TKT-XXXXXX> [reason] ──
  bot.command("cancelorder", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const parts = msg.text.split(/\s+/);
    const arg = parts[1] ?? "";
    const ticketNum = parseTicket(arg);
    const orderId = ticketNum ?? parseInt(arg, 10);
    const reason = parts.slice(2).join(" ").trim() || "No reason provided";

    if (!orderId || isNaN(orderId)) {
      await ctx.reply(
        `<blockquote>${CE.wrench} <b>Usage:</b> /cancelorder &lt;TKT-XXXXXX&gt; [reason]\n<i>Example: /cancelorder TKT-000001 Duplicate order</i></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, orderId) });
    if (!order) {
      await ctx.reply(`${CE.explosion} Ticket <code>${formatTicket(orderId)}</code> not found.`, { parse_mode: "HTML" });
      return;
    }
    if (order.paymentStatus === "cancelled") {
      await ctx.reply(`${CE.exclamation} <code>${formatTicket(orderId)}</code> is <i>already cancelled</i>.`, { parse_mode: "HTML" });
      return;
    }

    await db.update(ordersTable)
      .set({ paymentStatus: "cancelled" })
      .where(eq(ordersTable.id, orderId));

    logger.info({ adminId: ctx.from!.id, orderId, reason }, "Order cancelled");

    try {
      await bot.telegram.sendMessage(
        order.telegramId,
        `${CE.brokenheart} <b>Order Cancelled</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<i>Your order has been cancelled.</i>\n\n` +
          `<blockquote>${CE.cart} <b>Plan:</b> ${order.planName}\n` +
          `${CE.shield} <b>Ticket:</b> <code>${formatTicket(orderId)}</code>\n` +
          `${CE.wrench} <b>Reason:</b> <i>${htmlEscape(reason)}</i></blockquote>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<blockquote><i>If you believe this is a mistake, please contact support.</i></blockquote>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[ubtn("Contact Support", SELLER_URL, { style: "primary", icon: ICON.contact })]]),
        },
      );
    } catch (err) {
      logger.error({ err }, "Failed to DM buyer on cancel");
    }

    await ctx.reply(
      `${CE.brokenheart} <b>Order Cancelled</b>\n\n` +
        `<blockquote><code>${formatTicket(orderId)}</code> — <i>${order.planName}</i>\n` +
        `${CE.wrench} <b>Reason:</b> <i>${htmlEscape(reason)}</i>\n` +
        `${CE.cool} Buyer <code>${order.telegramId}</code> has been notified.</blockquote>`,
      { parse_mode: "HTML" },
    );
  }));

  // ── /adduser <user_id> <plan> ──
  bot.command("adduser", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const parts = msg.text.split(/\s+/);
    const userId = parseInt(parts[1] ?? "", 10);
    const planAlias = (parts[2] ?? "").toLowerCase();

    if (!userId || !planAlias) {
      await ctx.reply(
        `${CE.wrench} <b>Usage:</b> /adduser &lt;user_id&gt; &lt;plan&gt;\n\n` +
          `<blockquote><b>Plan options:</b>\n` +
          `<code>1month</code> or <code>1m</code> — <i>$250</i>\n` +
          `<code>rdp</code> or <code>1month_rdp</code> — <i>$300</i>\n` +
          `<code>lifetime</code> or <code>lf</code> — <i>$1200</i></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const planId = PLAN_ALIASES[planAlias];
    if (!planId) {
      await ctx.reply(
        `${CE.explosion} Unknown plan <code>${htmlEscape(planAlias)}</code>.\n\n<blockquote><i>Valid: </i><code>1month</code>, <code>rdp</code>, <code>lifetime</code></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const plan = getPlan(planId);
    if (!plan) {
      await ctx.reply(`${CE.explosion} Plan configuration error.`);
      return;
    }

    await db.insert(usersTable)
      .values({ telegramId: userId, firstName: "User" })
      .onConflictDoNothing();

    const [order] = await db.insert(ordersTable)
      .values({
        telegramId: userId,
        planId: plan.id,
        planName: plan.name,
        planPriceUsd: String(plan.price),
        paymentStatus: "finished",
      })
      .returning();

    logger.info({ adminId: ctx.from!.id, userId, planId: plan.id, orderId: order.id }, "Manual access granted");

    try {
      await bot.telegram.sendMessage(
        userId,
        `${CE.diamond} <b>Access Granted!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<i>You have been granted access to</i> <b>CELLIK R4T</b>.\n\n` +
          `<blockquote>${CE.cart} <b>Plan:</b> ${plan.name}\n` +
          `${CE.shield} <b>Ticket:</b> <code>${formatTicket(order.id)}</code></blockquote>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<blockquote><i>The seller will contact you shortly to deliver your access.</i></blockquote>\n\n` +
          `<i>Thank you for choosing CELLIK R4T!</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[ubtn("Contact Seller", SELLER_URL, { style: "primary", icon: ICON.contact })]]),
        },
      );
    } catch (err) {
      logger.warn({ err, userId }, "Could not DM user on manual grant");
    }

    await ctx.reply(
      `${CE.thumbsup} <b>Access Granted</b>\n\n` +
        `<blockquote>${CE.cool} User: <code>${userId}</code>\n` +
        `${CE.cart} Plan: <b>${plan.name}</b> <i>($${plan.price})</i>\n` +
        `${CE.shield} Ticket: <code>${formatTicket(order.id)}</code></blockquote>\n\n` +
        `<i>Use /deliver ${formatTicket(order.id)} once access is delivered.</i>`,
      { parse_mode: "HTML" },
    );
  }));

  // ── /deliver <TKT-XXXXXX> ──
  bot.command("deliver", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const arg = msg.text.split(/\s+/)[1] ?? "";
    const ticketNum = parseTicket(arg);
    const orderId = ticketNum ?? parseInt(arg, 10);

    if (!orderId || isNaN(orderId)) {
      await ctx.reply(
        `<blockquote>${CE.wrench} <b>Usage:</b> /deliver &lt;TKT-XXXXXX&gt;\n<i>Example: /deliver TKT-000001</i></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, orderId) });
    if (!order) {
      await ctx.reply(`${CE.explosion} Ticket <code>${formatTicket(orderId)}</code> not found.`, { parse_mode: "HTML" });
      return;
    }
    if (order.deliveredAt) {
      await ctx.reply(
        `${CE.exclamation} <code>${formatTicket(orderId)}</code> was <i>already delivered</i> on ${fmtDate(order.deliveredAt)}.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    await db.update(ordersTable)
      .set({ deliveredAt: new Date() })
      .where(eq(ordersTable.id, orderId));

    logger.info({ adminId: ctx.from!.id, orderId }, "Order marked as delivered");

    try {
      await bot.telegram.sendMessage(
        order.telegramId,
        `${CE.airplane} <b>Order Delivered!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<i>Your</i> <b>${order.planName}</b> <i>access has been delivered!</i>\n\n` +
          `<blockquote>${CE.shield} <b>Ticket:</b> <code>${formatTicket(orderId)}</code></blockquote>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<blockquote><i>If you have any questions, reach out at @CellikBackup.</i></blockquote>\n\n` +
          `<i>Thank you for choosing CELLIK R4T!</i>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      logger.error({ err }, "Failed to DM buyer about delivery");
    }

    await ctx.reply(
      `${CE.airplane} <b>Delivered</b>\n\n` +
        `<blockquote><code>${formatTicket(orderId)}</code> — <i>${order.planName}</i>\n` +
        `${CE.cool} Buyer <code>${order.telegramId}</code> has been notified.</blockquote>`,
      { parse_mode: "HTML" },
    );
  }));

  // ════════════════════════════════
  // MESSAGING
  // ════════════════════════════════

  // ── /message <user_id> <text> ──
  bot.command("message", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const parts = msg.text.split(/\s+/);
    const userId = parseInt(parts[1] ?? "", 10);
    const text = parts.slice(2).join(" ").trim();

    if (!userId || !text) {
      await ctx.reply(
        `<blockquote>${CE.wrench} <b>Usage:</b> /message &lt;user_id&gt; &lt;your message text&gt;</blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.telegramId, userId) });
    if (!user) {
      await ctx.reply(`${CE.explosion} User <code>${userId}</code> not found.`, { parse_mode: "HTML" });
      return;
    }

    try {
      await bot.telegram.sendMessage(
        userId,
        `${CE.speak} <b>Message from CELLIK R4T Team</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<blockquote>${htmlEscape(text)}</blockquote>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<i>Reply by contacting @CellikBackup</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[ubtn("Reply", SELLER_URL, { style: "primary", icon: ICON.contact })]]),
        },
      );

      const displayName = user.username ? `@${user.username}` : user.firstName;
      await ctx.reply(
        `${CE.thumbsup} <b>Message Delivered</b>\n\n` +
          `<blockquote>To: <b>${htmlEscape(displayName)}</b> (<code>${userId}</code>)\n` +
          `<i>"${htmlEscape(text)}"</i></blockquote>`,
        { parse_mode: "HTML" },
      );

      logger.info({ adminId: ctx.from!.id, userId, text }, "Admin DM sent");
    } catch (err) {
      logger.error({ err, userId }, "Failed to send admin DM");
      await ctx.reply(
        `${CE.explosion} Could not send message to <code>${userId}</code>.\n<blockquote><i>User may have blocked the bot.</i></blockquote>`,
        { parse_mode: "HTML" },
      );
    }
  }));

  // ── /broadcast <text> ──
  bot.command("broadcast", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const text = msg.text.replace(/^\/broadcast\s*/, "").trim();

    if (!text) {
      await ctx.reply(
        `<blockquote>${CE.wrench} <b>Usage:</b> /broadcast &lt;your message&gt;</blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const users = await db.query.usersTable.findMany({
      where: eq(usersTable.isBanned, false),
    });

    let sent = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await bot.telegram.sendMessage(
          user.telegramId,
          `${CE.speak} <b>CELLIK R4T — Announcement</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `<blockquote>${htmlEscape(text)}</blockquote>`,
          { parse_mode: "HTML" },
        );
        sent++;
      } catch {
        failed++;
      }
      // Respect Telegram's ~30 msg/s rate limit
      await new Promise((r) => setTimeout(r, 50));
    }

    logger.info({ adminId: ctx.from!.id, sent, failed }, "Broadcast completed");
    await ctx.reply(
      `${CE.speak} <b>Broadcast Complete</b>\n\n` +
        `<blockquote>${CE.thumbsup} Delivered: <b>${sent}</b>\n` +
        `${CE.explosion} Failed: <b>${failed}</b></blockquote>`,
      { parse_mode: "HTML" },
    );
  }));

  // ════════════════════════════════
  // USER MANAGEMENT
  // ════════════════════════════════

  // ── /ban <user_id> [reason] ──
  bot.command("ban", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const parts = msg.text.split(/\s+/);
    const targetId = parseInt(parts[1] ?? "", 10);
    const reason = parts.slice(2).join(" ").trim() || "Violation of terms";

    if (!targetId) {
      await ctx.reply(
        `<blockquote>${CE.wrench} <b>Usage:</b> /ban &lt;user_id&gt; [reason]</blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.telegramId, targetId) });
    if (!user) {
      await ctx.reply(`${CE.explosion} User <code>${targetId}</code> not found.`, { parse_mode: "HTML" });
      return;
    }
    if (user.isBanned) {
      await ctx.reply(`${CE.exclamation} User <code>${targetId}</code> is <i>already banned</i>.`, { parse_mode: "HTML" });
      return;
    }

    await db.update(usersTable).set({ isBanned: true }).where(eq(usersTable.telegramId, targetId));

    logger.info({ adminId: ctx.from!.id, targetId, reason }, "User banned");

    const name = user.username ? `@${user.username}` : user.firstName;
    await ctx.reply(
      `${CE.banned} <b>User Banned</b>\n\n` +
        `<blockquote><b>${htmlEscape(name)}</b> (<code>${targetId}</code>)\n` +
        `${CE.wrench} <b>Reason:</b> <i>${htmlEscape(reason)}</i></blockquote>`,
      { parse_mode: "HTML" },
    );
  }));

  // ── /unban <user_id> ──
  bot.command("unban", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const args = msg.text.split(/\s+/).slice(1);
    const targetId = parseInt(args[0] ?? "", 10);

    if (!targetId) {
      await ctx.reply(
        `<blockquote>${CE.wrench} <b>Usage:</b> /unban &lt;user_id&gt;</blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.telegramId, targetId) });
    if (!user) {
      await ctx.reply(`${CE.explosion} User <code>${targetId}</code> not found.`, { parse_mode: "HTML" });
      return;
    }

    await db.update(usersTable).set({ isBanned: false }).where(eq(usersTable.telegramId, targetId));

    logger.info({ adminId: ctx.from!.id, targetId }, "User unbanned");

    const name = user.username ? `@${user.username}` : user.firstName;
    await ctx.reply(
      `${CE.thumbsup} <b>User Unbanned</b>\n\n` +
        `<blockquote><b>${htmlEscape(name)}</b> (<code>${targetId}</code>) can now use the bot again.</blockquote>`,
      { parse_mode: "HTML" },
    );
  }));

  // ════════════════════════════════
  // PANEL CALLBACKS (delete → resend)
  // ════════════════════════════════

  bot.action("admin:stats", adminOnly(async (ctx) => {
    await ctx.answerCbQuery();
    const { totalSales, recentPaid, recentPaid30d, totalPending, totalUsers, bannedUsers, planStats, totalRevenue } = await buildStats();

    await replaceMessage(
      ctx,
      `${CE.star} <b>CELLIK R4T — Statistics</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${CE.money} <b>Revenue &amp; Sales</b>\n` +
        `<blockquote>${CE.money} Total Profit: <b>$${totalRevenue.toLocaleString()} USD</b>\n` +
        `${CE.cart} Total Sales: <b>${totalSales}</b> orders\n` +
        `${CE.calendar} Last 30 days: <b>${recentPaid30d.count}</b> sales\n` +
        `${CE.calendar} Last 7 days: <b>${recentPaid.count}</b> sales\n` +
        `${CE.lightning} Pending: <b>${totalPending.count}</b> orders</blockquote>\n\n` +
        `${CE.star} <b>Sales by Plan</b>\n` +
        `<blockquote>${planStats.map(({ plan, count: c }) =>
          `${plan.emoji} <b>${plan.name}</b>: <b>${c}x</b> = <b>$${(plan.price * c).toLocaleString()}</b>`,
        ).join("\n")}</blockquote>\n\n` +
        `${CE.globe} <b>Users</b>\n` +
        `<blockquote>${CE.cool} Registered: <b>${totalUsers.count}</b>  ·  ${CE.banned} Banned: <b>${bannedUsers.count}</b></blockquote>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[cbtn("Back to Panel", "admin:menu", { style: "primary", icon: ICON.airplane })]]),
      },
    );
  }));

  bot.action("admin:revenue", adminOnly(async (ctx) => {
    await ctx.answerCbQuery();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const planStats = await Promise.all(
      PLANS.map(async (plan) => {
        const [all] = await db.select({ count: count() }).from(ordersTable)
          .where(and(eq(ordersTable.planId, plan.id), eq(ordersTable.paymentStatus, "finished")));
        const [last30] = await db.select({ count: count() }).from(ordersTable)
          .where(and(eq(ordersTable.planId, plan.id), eq(ordersTable.paymentStatus, "finished"), gte(ordersTable.createdAt, thirtyDaysAgo)));
        return { plan, total: all.count, last30: last30.count };
      }),
    );
    const totalRevAll = planStats.reduce((a, { plan, total }) => a + plan.price * total, 0);
    const totalRev30d = planStats.reduce((a, { plan, last30 }) => a + plan.price * last30, 0);

    await replaceMessage(
      ctx,
      `${CE.money} <b>Revenue Report</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${CE.diamond} <b>All-Time</b>\n` +
        `<blockquote>${CE.money} <b>$${totalRevAll.toLocaleString()} USD</b></blockquote>\n\n` +
        `${CE.calendar} <b>Last 30 Days</b>\n` +
        `<blockquote>${CE.money} <b>$${totalRev30d.toLocaleString()} USD</b></blockquote>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        planStats.map(({ plan, total, last30 }) =>
          `${plan.emoji} <b>${plan.name}</b> <i>($${plan.price})</i>\n` +
          `<blockquote>All-time: <b>${total}</b> ${CE.airplane} <b>$${(plan.price * total).toLocaleString()}</b>\n` +
          `Last 30d: <b>${last30}</b> ${CE.airplane} <b>$${(plan.price * last30).toLocaleString()}</b></blockquote>`,
        ).join("\n\n") +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[cbtn("Back to Panel", "admin:menu", { style: "primary", icon: ICON.airplane })]]),
      },
    );
  }));

  bot.action(/^admin:orders:(\d+)$/, async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) { await ctx.answerCbQuery("⛔ Access denied."); return; }
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1] ?? "0", 10);
    const pageSize = 5;
    const rows = await db.query.ordersTable.findMany({
      orderBy: [desc(ordersTable.createdAt)],
      limit: pageSize + 1,
      offset: page * pageSize,
    });
    const hasNext = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);

    if (!pageRows.length) {
      await replaceMessage(ctx, `${CE.cart} <i>No orders found.</i>`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[cbtn("Back", "admin:menu", { style: "primary", icon: ICON.airplane })]]),
      });
      return;
    }

    const navRow = [];
    if (page > 0) navRow.push(cbtn("Prev", `admin:orders:${page - 1}`, { style: "primary", icon: ICON.airplane }));
    if (hasNext) navRow.push(cbtn("Next", `admin:orders:${page + 1}`, { style: "primary", icon: ICON.lightning }));

    await replaceMessage(
      ctx,
      `${CE.cart} <b>Orders</b> <i>(page ${page + 1})</i>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        pageRows.map((o) =>
          `${statusIcon(o.paymentStatus)}${o.deliveredAt ? ` ${CE.airplane}` : ""} <b>${formatTicket(o.id)}</b> — <i>${o.planName}</i>\n` +
          `<blockquote>${CE.money} <b>$${o.planPriceUsd}</b>  ·  ${CE.cool} <code>${o.telegramId}</code>\n` +
          `${CE.calendar} ${fmtDate(o.createdAt)}</blockquote>`,
        ).join("\n\n") +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          ...(navRow.length ? [navRow] : []),
          [cbtn("Back to Panel", "admin:menu", { style: "primary", icon: ICON.airplane })],
        ]),
      },
    );
  });

  bot.action(/^admin:pending:(\d+)$/, async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) { await ctx.answerCbQuery("⛔ Access denied."); return; }
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1] ?? "0", 10);
    const pageSize = 5;
    const rows = await db.query.ordersTable.findMany({
      where: eq(ordersTable.paymentStatus, "waiting"),
      orderBy: [desc(ordersTable.createdAt)],
      limit: pageSize + 1,
      offset: page * pageSize,
    });
    const hasNext = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);

    if (!pageRows.length) {
      await replaceMessage(ctx, `${CE.thumbsup} <b>No Pending Orders</b>\n\n<blockquote><i>All clear!</i></blockquote>`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[cbtn("Back", "admin:menu", { style: "primary", icon: ICON.airplane })]]),
      });
      return;
    }

    const navRow = [];
    if (page > 0) navRow.push(cbtn("Prev", `admin:pending:${page - 1}`, { style: "primary", icon: ICON.airplane }));
    if (hasNext) navRow.push(cbtn("Next", `admin:pending:${page + 1}`, { style: "primary", icon: ICON.lightning }));

    await replaceMessage(
      ctx,
      `${CE.lightning} <b>Pending Orders</b> <i>(page ${page + 1})</i>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        pageRows.map((o) =>
          `${CE.lightning} <b>${formatTicket(o.id)}</b> — <i>${o.planName}</i>\n` +
          `<blockquote>${CE.money} <b>$${o.planPriceUsd}</b>  ·  ${CE.cool} <code>${o.telegramId}</code>\n` +
          `${CE.calendar} ${fmtDate(o.createdAt)}</blockquote>`,
        ).join("\n\n") +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>/confirmorder &lt;TKT&gt; · /cancelorder &lt;TKT&gt; [reason]</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          ...(navRow.length ? [navRow] : []),
          [cbtn("Back to Panel", "admin:menu", { style: "primary", icon: ICON.airplane })],
        ]),
      },
    );
  });

  bot.action(/^admin:users:(\d+)$/, async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) { await ctx.answerCbQuery("⛔ Access denied."); return; }
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1] ?? "0", 10);
    const pageSize = 5;
    const rows = await db.query.usersTable.findMany({
      orderBy: [desc(usersTable.createdAt)],
      limit: pageSize + 1,
      offset: page * pageSize,
    });
    const hasNext = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);

    if (!pageRows.length) {
      await replaceMessage(ctx, `${CE.globe} <i>No users found.</i>`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[cbtn("Back", "admin:menu", { style: "primary", icon: ICON.airplane })]]),
      });
      return;
    }

    const navRow = [];
    if (page > 0) navRow.push(cbtn("Prev", `admin:users:${page - 1}`, { style: "primary", icon: ICON.airplane }));
    if (hasNext) navRow.push(cbtn("Next", `admin:users:${page + 1}`, { style: "primary", icon: ICON.lightning }));

    await replaceMessage(
      ctx,
      `${CE.globe} <b>Users</b> <i>(page ${page + 1})</i>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        pageRows.map((u) =>
          `${u.isBanned ? CE.banned : CE.cool} <b>${htmlEscape(u.firstName)}</b>${u.username ? ` <i>(@${htmlEscape(u.username)})</i>` : ""}\n` +
          `<blockquote>${CE.globe} <code>${u.telegramId}</code>  ·  ${CE.calendar} ${fmtDate(u.createdAt)}${u.isBanned ? `\n${CE.banned} <b>BANNED</b>` : ""}</blockquote>`,
        ).join("\n\n") +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          ...(navRow.length ? [navRow] : []),
          [cbtn("Back to Panel", "admin:menu", { style: "primary", icon: ICON.airplane })],
        ]),
      },
    );
  });

  bot.action("admin:broadcast_info", adminOnly(async (ctx) => {
    await ctx.answerCbQuery();
    await replaceMessage(
      ctx,
      `${CE.speak} <b>Broadcast Message</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<i>Send a message to</i> <b>all non-banned users</b>.\n\n` +
        `<blockquote>${CE.wrench} <b>Usage:</b>\n<code>/broadcast Your message here</code></blockquote>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[cbtn("Back to Panel", "admin:menu", { style: "primary", icon: ICON.airplane })]]),
      },
    );
  }));

  bot.action("admin:help", adminOnly(async (ctx) => {
    await ctx.answerCbQuery();
    await replaceMessage(ctx, ADMIN_HELP_TEXT, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[cbtn("Back to Panel", "admin:menu", { style: "primary", icon: ICON.airplane })]]),
    });
  }));

  bot.action("admin:menu", adminOnly(async (ctx) => {
    await ctx.answerCbQuery();
    const [totalOrders] = await db.select({ count: count() }).from(ordersTable)
      .where(and(eq(ordersTable.paymentStatus, "finished"), ne(ordersTable.planId, "test")));
    const [totalUsers] = await db.select({ count: count() }).from(usersTable);
    const [pending] = await db.select({ count: count() }).from(ordersTable)
      .where(and(eq(ordersTable.paymentStatus, "waiting"), ne(ordersTable.planId, "test")));

    await replaceMessage(
      ctx,
      buildAdminMenuText(ctx.from!.first_name, totalUsers.count, totalOrders.count, pending.count),
      { parse_mode: "HTML", ...adminMenuKeyboard() },
    );
  }));

  // ════════════════════════════════
  // TEST PAYMENT GATEWAYS
  // ════════════════════════════════

  const TEST_AMOUNT_USD = 5;

  const TEST_COINS: { symbol: CoinSymbol; label: string }[] = [
    { symbol: "BTC",  label: "Bitcoin (BTC)"     },
    { symbol: "ETH",  label: "Ethereum (ETH)"    },
    { symbol: "USDT", label: "USDT TRC20"        },
    { symbol: "LTC",  label: "Litecoin (LTC)"    },
    { symbol: "SOL",  label: "Solana (SOL)"      },
    { symbol: "BNB",  label: "BNB Smart Chain"   },
  ];

  bot.action("admin:testgw", adminOnly(async (ctx) => {
    await ctx.answerCbQuery();
    await replaceMessage(
      ctx,
      `🧪 <b>Test Payment Gateways</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<blockquote><i>Generates a live <b>$${TEST_AMOUNT_USD} USD</b> invoice for each coin using real-time prices and your actual wallet addresses.\n\n` +
        `Select a coin to test its gateway:</i></blockquote>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            cbtn(TEST_COINS[0]!.label, `admin:testgw:BTC`, { style: "primary", icon: COIN_ICON.BTC }),
            cbtn(TEST_COINS[1]!.label, `admin:testgw:ETH`, { style: "primary", icon: COIN_ICON.ETH }),
          ],
          [cbtn(TEST_COINS[2]!.label, `admin:testgw:USDT`, { style: "primary", icon: COIN_ICON.USDT })],
          [
            cbtn(TEST_COINS[3]!.label, `admin:testgw:LTC`, { style: "primary", icon: COIN_ICON.LTC }),
            cbtn(TEST_COINS[4]!.label, `admin:testgw:SOL`, { style: "primary", icon: COIN_ICON.SOL }),
          ],
          [cbtn(TEST_COINS[5]!.label, `admin:testgw:BNB`, { style: "primary", icon: COIN_ICON.BNB })],
          [cbtn("Back to Panel", "admin:menu", { style: "primary", icon: ICON.airplane })],
        ]),
      },
    );
  }));

  bot.action(/^admin:testgw:([A-Z]+)$/, adminOnly(async (ctx) => {
    await ctx.answerCbQuery("Fetching live price…");

    const coin = (ctx as any).match[1] as CoinSymbol;
    const wallet = WALLETS[coin];
    if (!wallet) {
      await ctx.reply(`${CE.explosion} Unknown coin: ${coin}`, { parse_mode: "HTML" });
      return;
    }

    // Fetch live price
    let cryptoAmount: string;
    try {
      cryptoAmount = await getCryptoAmount(TEST_AMOUNT_USD, coin);
    } catch (err) {
      logger.error({ err, coin }, "Test gateway price fetch failed");
      await ctx.reply(
        `${CE.explosion} <b>Price fetch failed for ${coin}</b>\n\n` +
          `<blockquote><i>CoinGecko may be rate-limiting. Try again in a moment.</i></blockquote>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[cbtn("Back to Coins", "admin:testgw", { style: "primary", icon: ICON.airplane })]]),
        },
      );
      return;
    }

    const adminId = ctx.from!.id;

    // Ensure admin has a user row (required by FK)
    await db.insert(usersTable)
      .values({ telegramId: adminId, firstName: ctx.from!.first_name ?? "Admin" })
      .onConflictDoNothing();

    // Create a real waiting order so the poller auto-verifies it on-chain
    const [testOrder] = await db.insert(ordersTable)
      .values({
        telegramId: adminId,
        planId: "test",
        planName: `🧪 TEST $${TEST_AMOUNT_USD}`,
        planPriceUsd: String(TEST_AMOUNT_USD),
        paymentStatus: "waiting",
        coin,
        cryptoExpected: cryptoAmount,
      })
      .returning();

    const qrUrl = getPaymentQrUrl(coin, cryptoAmount);

    await replaceMessage(
      ctx,
      `${CE.wrench} <b>Gateway Test — ${wallet.name}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<blockquote>${CE.money} <b>Test Amount:</b> $${TEST_AMOUNT_USD} USD\n` +
        `${CE.dollar} <b>Crypto Amount:</b> <code>${cryptoAmount} ${coin}</code>\n` +
        `${CE.globe} <b>Wallet Address:</b>\n<code>${wallet.address}</code></blockquote>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${CE.shield} <b>Infrastructure Checks:</b>\n` +
        `<blockquote>${CE.check} Live price fetched (CoinGecko)\n` +
        `${CE.check} Wallet address loaded\n` +
        `${CE.check} QR code link generated\n` +
        `${CE.check} Crypto amount calculated\n` +
        `${CE.check} Order created in DB (Ticket <code>${testOrder!.id}</code>)</blockquote>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${CE.lightning} <b>Auto-Verification:</b>\n` +
        `<blockquote><i>Send exactly <b>${cryptoAmount} ${coin}</b> to the address above.\n` +
        `The poller checks every <b>90 seconds</b> — you will receive a payment confirmation here automatically once detected on-chain.</i></blockquote>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [ubtn("Scan QR Code", qrUrl, { style: "primary", icon: ICON.camera })],
          [cbtn("Force Check Now", `admin:forcecheck:${testOrder!.id}`, { style: "primary", icon: ICON.lightning })],
          [cbtn("Mark as Paid", `admin:forcepay:${testOrder!.id}`, { style: "success", icon: ICON.check })],
          [cbtn("Test Another Coin", "admin:testgw", { style: "primary", icon: ICON.tool })],
          [cbtn("Back to Panel", "admin:menu", { style: "primary", icon: ICON.airplane })],
        ]),
      },
    );

    logger.info({ coin, cryptoAmount, orderId: testOrder!.id, adminId }, "Admin gateway test order created");
  }));

  // ════════════════════════════════
  // FORCE CHECK / MANUAL CONFIRM
  // ════════════════════════════════

  bot.action(/^admin:forcecheck:(\d+)$/, adminOnly(async (ctx) => {
    await ctx.answerCbQuery("Checking on-chain…");
    const orderId = parseInt((ctx as any).match[1]!, 10);

    const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, orderId) });
    if (!order) {
      await ctx.reply(`${CE.explosion} Order #${orderId} not found.`, { parse_mode: "HTML" });
      return;
    }
    if (order.paymentStatus !== "waiting") {
      await ctx.reply(
        `${CE.shield} Order <code>${formatTicket(orderId)}</code> is already <b>${order.paymentStatus}</b> — no action needed.`,
        { parse_mode: "HTML" },
      );
      return;
    }
    if (!order.coin || !order.cryptoExpected) {
      await ctx.reply(`${CE.explosion} Order has no coin/amount stored.`, { parse_mode: "HTML" });
      return;
    }

    await ctx.reply(`${CE.lightning} <b>Checking on-chain for order <code>${formatTicket(orderId)}</code>...</b>`, { parse_mode: "HTML" });

    let found = false;
    try {
      found = await checkPaymentReceived(order.coin as CoinSymbol, order.cryptoExpected, order.createdAt);
    } catch (err) {
      logger.warn({ err, orderId }, "Force-check failed");
    }

    if (found) {
      await db.update(ordersTable)
        .set({ paymentStatus: "finished", amountPaid: order.cryptoExpected })
        .where(eq(ordersTable.id, orderId));

      for (const adminId of ADMIN_IDS) {
        try {
          await ctx.telegram.sendMessage(
            adminId,
            `${CE.thumbsup} <b>Payment Confirmed!</b>\n` +
              `<blockquote>${CE.cart} <b>Ticket:</b> <code>${formatTicket(orderId)}</code>\n` +
              `${CE.money} <b>Plan:</b> ${order.planName}\n` +
              `${CE.money} <b>Paid:</b> ${order.cryptoExpected} ${order.coin}</blockquote>`,
            { parse_mode: "HTML" },
          );
        } catch { /* ignore */ }
      }
      logger.info({ orderId }, "Force-check: payment confirmed on-chain");
    } else {
      await ctx.reply(
        `${CE.explosion} <b>Not detected on-chain yet</b>\n\n` +
          `<blockquote>Checked <b>${order.coin}</b> for <code>${order.cryptoExpected} ${order.coin}</code>.\n\n` +
          `The transaction may still be propagating (0-conf), or the API is rate-limited.\n` +
          `You can wait and try again, or use <b>Mark as Paid</b> to confirm manually.</blockquote>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [cbtn("Retry Check", `admin:forcecheck:${orderId}`, { style: "primary", icon: ICON.lightning })],
            [cbtn("Mark as Paid", `admin:forcepay:${orderId}`, { style: "success", icon: ICON.check })],
          ]),
        },
      );
    }
  }));

  bot.action(/^admin:forcepay:(\d+)$/, adminOnly(async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = parseInt((ctx as any).match[1]!, 10);
    const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, orderId) });
    if (!order) {
      await ctx.reply(`${CE.explosion} Order #${orderId} not found.`, { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(
      `${CE.exclamation} <b>Manually confirm payment?</b>\n\n` +
        `<blockquote>${CE.cart} <b>Ticket:</b> <code>${formatTicket(orderId)}</code>\n` +
        `${CE.money} <b>Plan:</b> ${order.planName} ($${order.planPriceUsd})\n` +
        `${CE.money} <b>Coin:</b> ${order.coin ?? "N/A"}\n` +
        `${CE.money} <b>Expected:</b> ${order.cryptoExpected ?? "N/A"} ${order.coin ?? ""}</blockquote>\n\n` +
        `<i>This skips on-chain verification and marks the order paid immediately.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [cbtn("Yes, Confirm Payment", `admin:forcepay:yes:${orderId}`, { style: "success", icon: ICON.check })],
          [cbtn("Cancel", "admin:menu", { style: "danger", icon: ICON.banned })],
        ]),
      },
    );
  }));

  bot.action(/^admin:forcepay:yes:(\d+)$/, adminOnly(async (ctx) => {
    await ctx.answerCbQuery("Confirming…");
    const orderId = parseInt((ctx as any).match[1]!, 10);

    const order = await db.query.ordersTable.findFirst({ where: eq(ordersTable.id, orderId) });
    if (!order) {
      await ctx.reply(`${CE.explosion} Order #${orderId} not found.`, { parse_mode: "HTML" });
      return;
    }
    if (order.paymentStatus !== "waiting") {
      await ctx.reply(
        `${CE.shield} Already <b>${order.paymentStatus}</b> — nothing to do.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    await db.update(ordersTable)
      .set({ paymentStatus: "finished", amountPaid: order.cryptoExpected ?? "manual" })
      .where(eq(ordersTable.id, orderId));

    try {
      await ctx.telegram.sendMessage(
        order.telegramId,
        `${CE.thumbsup} <b>Payment Confirmed!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<i>Thank you for your purchase!</i> ${CE.diamond}\n\n` +
          `<blockquote>${CE.cart} <b>Plan:</b> ${order.planName}\n` +
          `${CE.money} <b>Amount:</b> $${order.planPriceUsd} USD\n` +
          `${CE.money} <b>Coin:</b> ${order.coin ?? "N/A"}\n` +
          `${CE.shield} <b>Ticket:</b> <code>${formatTicket(order.id)}</code></blockquote>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `<blockquote><i>The seller will contact you shortly at @CellikBackup.</i></blockquote>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      logger.warn({ err, telegramId: order.telegramId }, "Could not DM buyer after force-pay");
    }

    await ctx.reply(
      `${CE.thumbsup} <b>Order <code>${formatTicket(orderId)}</code> marked as paid.</b>\n\n` +
        `<blockquote>Buyer has been notified.\nUse /confirmorder ${formatTicket(orderId)} once you've delivered access.</blockquote>`,
      { parse_mode: "HTML" },
    );
    logger.info({ orderId, adminId: ctx.from!.id }, "Order manually confirmed by admin");
  }));

  // ════════════════════════════════
  // SCHEDULED BROADCASTS
  // ════════════════════════════════

  // ── /schedule <time> <message> ──
  // Time formats: "2h", "30m", "1d", or absolute "2026-06-17T15:00"
  bot.command("schedule", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const parts = msg.text.split(/\s+/);
    const timeArg = parts[1] ?? "";
    const message = parts.slice(2).join(" ").trim();

    if (!timeArg || !message) {
      await ctx.reply(
        `${CE.calendar} <b>Schedule a Broadcast</b>\n\n` +
          `<blockquote>${CE.wrench} <b>Usage:</b>\n` +
          `<code>/schedule &lt;time&gt; &lt;message&gt;</code>\n\n` +
          `${CE.lightning} <b>Time formats:</b>\n` +
          `› <code>30m</code> — in 30 minutes\n` +
          `› <code>2h</code> — in 2 hours\n` +
          `› <code>1d</code> — in 1 day\n` +
          `› <code>2026-06-17T15:00</code> — exact UTC datetime\n\n` +
          `${CE.speak} <b>Example:</b>\n` +
          `<code>/schedule 2h 🔥 New update just dropped! Check it out.</code></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    let scheduledAt: Date;
    const relMatch = timeArg.match(/^(\d+)(m|h|d)$/i);
    if (relMatch) {
      const num = parseInt(relMatch[1]!, 10);
      const unit = relMatch[2]!.toLowerCase();
      const ms = unit === "m" ? num * 60_000
                : unit === "h" ? num * 3_600_000
                : num * 86_400_000;
      scheduledAt = new Date(Date.now() + ms);
    } else {
      scheduledAt = new Date(timeArg);
      if (isNaN(scheduledAt.getTime())) {
        await ctx.reply(
          `${CE.explosion} <b>Invalid time format</b>\n\n` +
            `<blockquote>Use <code>30m</code>, <code>2h</code>, <code>1d</code>, or an ISO datetime like <code>2026-06-17T15:00</code></blockquote>`,
          { parse_mode: "HTML" },
        );
        return;
      }
      if (scheduledAt <= new Date()) {
        await ctx.reply(
          `${CE.explosion} <b>Scheduled time is in the past</b>\n\n<blockquote><i>Please provide a future time.</i></blockquote>`,
          { parse_mode: "HTML" },
        );
        return;
      }
    }

    const [row] = await db
      .insert(scheduledBroadcastsTable)
      .values({ message, scheduledAt, createdBy: ctx.from!.id })
      .returning();

    const when = scheduledAt.toUTCString();
    await ctx.reply(
      `${CE.thumbsup} <b>Broadcast Scheduled</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<blockquote>${CE.shield} <b>ID:</b> <code>#${row!.id}</code>\n` +
        `${CE.calendar} <b>Sends at:</b> <i>${when}</i>\n\n` +
        `${CE.speak} <b>Message preview:</b>\n${htmlEscape(message.slice(0, 200))}${message.length > 200 ? "…" : ""}</blockquote>\n\n` +
        `<i>Use /schedules to view pending · /cancelschedule ${row!.id} to cancel</i>`,
      { parse_mode: "HTML" },
    );
    logger.info({ id: row!.id, scheduledAt, adminId: ctx.from!.id }, "Broadcast scheduled");
  }));

  // ── /schedules ──
  bot.command("schedules", adminOnly(async (ctx) => {
    const rows = await db.query.scheduledBroadcastsTable.findMany({
      where: eq(scheduledBroadcastsTable.status, "pending"),
      orderBy: [desc(scheduledBroadcastsTable.scheduledAt)],
      limit: 10,
    });

    if (rows.length === 0) {
      await ctx.reply(
        `${CE.calendar} <b>No Pending Broadcasts</b>\n\n<blockquote><i>No scheduled broadcasts queued.\nUse /schedule to add one.</i></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    await ctx.reply(
      `${CE.calendar} <b>Pending Broadcasts (${rows.length})</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        rows.map((r) =>
          `${CE.lightning} <b>#${r.id}</b> — <i>${r.scheduledAt.toUTCString()}</i>\n` +
          `<blockquote>${htmlEscape(r.message.slice(0, 100))}${r.message.length > 100 ? "…" : ""}</blockquote>`,
        ).join("\n\n") +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>/cancelschedule &lt;ID&gt; to cancel one</i>`,
      { parse_mode: "HTML" },
    );
  }));

  // ── /cancelschedule <id> ──
  bot.command("cancelschedule", adminOnly(async (ctx) => {
    const msg = ctx.message as Message.TextMessage;
    const arg = msg.text.split(/\s+/)[1]?.trim();
    const id = arg ? parseInt(arg, 10) : NaN;

    if (isNaN(id)) {
      await ctx.reply(
        `<blockquote>${CE.wrench} <b>Usage:</b> /cancelschedule &lt;ID&gt;\n<i>Get IDs from /schedules</i></blockquote>`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const row = await db.query.scheduledBroadcastsTable.findFirst({
      where: eq(scheduledBroadcastsTable.id, id),
    });

    if (!row) {
      await ctx.reply(`${CE.explosion} Scheduled broadcast <code>#${id}</code> not found.`, { parse_mode: "HTML" });
      return;
    }
    if (row.status !== "pending") {
      await ctx.reply(
        `${CE.exclamation} Broadcast <code>#${id}</code> is already <i>${row.status}</i> — cannot cancel.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    await db
      .update(scheduledBroadcastsTable)
      .set({ status: "cancelled" })
      .where(eq(scheduledBroadcastsTable.id, id));

    await ctx.reply(
      `${CE.thumbsup} <b>Broadcast Cancelled</b>\n\n` +
        `<blockquote><code>#${id}</code> has been removed from the queue.</blockquote>`,
      { parse_mode: "HTML" },
    );
    logger.info({ id, adminId: ctx.from!.id }, "Scheduled broadcast cancelled");
  }));

  // ════════════════════════════════
  // ADMIN TERMINAL — fires on any plain text from an admin
  // ════════════════════════════════

  bot.on("text", async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) return;
    if (ctx.message.text.startsWith("/")) return;

    const { totalSales, totalRevenue, totalPending, recentPaid } = await buildStats();

    await ctx.reply(
      `${CE.shield} <b>ADMIN TERMINAL ACTIVATED</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${CE.lightning} <i>Secure admin session established.</i>\n\n` +
        `<blockquote>${CE.cool} <b>Admin:</b> ${htmlEscape(ctx.from.first_name)}\n` +
        `${CE.globe} <b>ID:</b> <code>${ctx.from.id}</code>\n` +
        `${CE.shield} <b>Level:</b> <i>Super Admin</i></blockquote>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${CE.money} <b>Live Snapshot</b>\n` +
        `<blockquote>${CE.money} Profit: <b>$${totalRevenue.toLocaleString()} USD</b>\n` +
        `${CE.cart} Total Sales: <b>${totalSales}</b>\n` +
        `${CE.calendar} Last 7 days: <b>${recentPaid.count}</b> sales\n` +
        `${CE.lightning} Pending: <b>${totalPending.count}</b></blockquote>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Use /admin to open the panel.</i>`,
      { parse_mode: "HTML", ...adminMenuKeyboard() },
    );
  });
}

// ──────────────────────────────────────────────
// Lookup helpers
// ──────────────────────────────────────────────

function buildOrderDetail(
  order: Awaited<ReturnType<typeof db.query.ordersTable.findFirst>> & object,
  user: Awaited<ReturnType<typeof db.query.usersTable.findFirst>> | null,
): string {
  return (
    `${CE.globe} <b>Order Lookup</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<blockquote>${CE.shield} <b>Ticket:</b> <code>${formatTicket(order.id)}</code>\n` +
    `${statusIcon(order.paymentStatus)} <b>Status:</b> <i>${order.paymentStatus}${order.deliveredAt ? " — delivered" : ""}</i>\n\n` +
    `${CE.cart} <b>Plan:</b> ${order.planName}\n` +
    `${CE.money} <b>Price:</b> $${order.planPriceUsd} USD\n` +
    (order.coin ? `${CE.money} <b>Coin:</b> <i>${order.coin}</i>\n` : ``) +
    (order.amountPaid ? `${CE.money} <b>Paid:</b> ${order.amountPaid}\n` : ``) +
    `\n${CE.cool} <b>Buyer:</b> ${user?.username ? `@${user.username}` : user?.firstName ?? "Unknown"}\n` +
    `${CE.globe} <b>Telegram ID:</b> <code>${order.telegramId}</code>\n\n` +
    `${CE.calendar} <b>Created:</b> <i>${fmtDate(order.createdAt)}</i>\n` +
    (order.deliveredAt ? `${CE.airplane} <b>Delivered:</b> <i>${fmtDate(order.deliveredAt)}</i>\n` : ``) +
    `</blockquote>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━`
  );
}

async function replyWithUserProfile(
  ctx: Context,
  user: NonNullable<Awaited<ReturnType<typeof db.query.usersTable.findFirst>>>,
): Promise<void> {
  const orders = await db.query.ordersTable.findMany({
    where: eq(ordersTable.telegramId, user.telegramId),
    orderBy: [desc(ordersTable.createdAt)],
    limit: 5,
  });

  const header =
    `${CE.globe} <b>User Profile</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<blockquote>${user.isBanned ? CE.banned : CE.cool} <b>${htmlEscape(user.firstName)}</b>${user.username ? ` <i>(@${htmlEscape(user.username)})</i>` : ""}\n` +
    `${CE.globe} <code>${user.telegramId}</code>\n` +
    (user.isBanned ? `${CE.banned} <b>Status:</b> <i>BANNED</i>\n` : ``) +
    `${CE.calendar} <b>Joined:</b> <i>${fmtDate(user.createdAt)}</i></blockquote>\n\n`;

  const ordersSection =
    orders.length === 0
      ? `<i>No orders yet.</i>\n`
      : `${CE.money} <b>Orders (${orders.length})</b>\n` +
        `<blockquote>${orders.map((o) =>
          `${statusIcon(o.paymentStatus)}${o.deliveredAt ? ` ${CE.airplane}` : ""} <code>${formatTicket(o.id)}</code> — <i>${o.planName}</i> ($${o.planPriceUsd})`,
        ).join("\n")}</blockquote>\n`;

  await ctx.reply(header + ordersSection + `━━━━━━━━━━━━━━━━━━━━━━━`, { parse_mode: "HTML" });
}
