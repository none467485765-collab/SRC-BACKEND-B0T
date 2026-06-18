import { pgTable, serial, integer, text, boolean, timestamp, numeric } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id:         serial("id").primaryKey(),
  telegramId: integer("telegram_id").notNull().unique(),
  username:   text("username"),
  firstName:  text("first_name").notNull(),
  isBanned:   boolean("is_banned").notNull().default(false),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
});

export const ordersTable = pgTable("orders", {
  id:            serial("id").primaryKey(),
  telegramId:    integer("telegram_id").notNull().references(() => usersTable.telegramId),
  planId:        text("plan_id").notNull(),
  planName:      text("plan_name").notNull(),
  planPriceUsd:  text("plan_price_usd").notNull(),
  paymentStatus: text("payment_status").notNull().default("waiting"),
  coin:          text("coin"),
  cryptoExpected: text("crypto_expected"),
  amountPaid:    text("amount_paid"),
  deliveredAt:   timestamp("delivered_at"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});

export const scheduledBroadcastsTable = pgTable("scheduled_broadcasts", {
  id:          serial("id").primaryKey(),
  message:     text("message").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status:      text("status").notNull().default("pending"),
  createdBy:   integer("created_by").notNull(),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
