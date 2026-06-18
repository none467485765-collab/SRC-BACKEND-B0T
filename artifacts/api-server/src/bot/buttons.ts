// ─────────────────────────────────────────────────────────────
// Colored buttons + custom-emoji icons (Telegram Bot API 9.4+)
//
// `style`               — button background color: primary (blue),
//                         success (green), danger (red).
// `icon_custom_emoji_id`— premium custom emoji shown inside the button.
//
// Telegraf 4.16.3 predates Bot API 9.4, so these fields are attached
// to the raw button object and sent through as-is. Telegram clients
// released before Feb 2026 simply ignore them (graceful fallback).
// ─────────────────────────────────────────────────────────────

import { Markup } from "telegraf";

export type BtnStyle = "primary" | "success" | "danger";

// Raw custom-emoji IDs for button icons (all confirmed working)
export const ICON = {
  shield:      "5352888345972187597",
  lightning:   "6276168523471393020",
  diamond:     "5462902520215002477",
  star:        "5370784581341422520",
  glowstar:    "5330194932781050507",
  money:       "6233367447789899509",
  dollar:      "5215696838451014017",
  skull:       "5251591568065845575",
  cool:        "5253871620174402707",
  thumbsup:    "5431676840957724997",
  banned:      "6275767489490063307",
  speak:       "5197304993920616826",
  globe:       "5287292843763713628",
  calendar:    "5251443675161976035",
  camera:      "5854710508065658472",
  battery:     "5370715226209525171",
  controller:  "5350803719170564382",
  tv:          "5413681168505650617",
  contact:     "5213179235996294999",
  wrench:      "5350396951407895212",
  tool:        "5258023599419171861",
  cart:        "5258024802010026053",
  check:       "5368324170671202286",
  brokenheart: "5271788286703082174",
  airplane:    "5217890643321300022",
  trophy:      "5399852280050646232",
  handshake:   "5393514467394875868",
  drop:        "5373135805353041178",
  redhot:      "5398065874303220590",
} as const;

// Per-coin button icon (custom_emoji_id) — distinct premium emoji per coin
export const COIN_ICON: Record<string, string> = {
  BTC:  ICON.money,
  ETH:  ICON.diamond,
  USDT: ICON.dollar,
  LTC:  ICON.drop,
  SOL:  ICON.glowstar,
  BNB:  ICON.star,
};

interface BtnOpts {
  style?: BtnStyle;
  icon?: string;
}

function decorate<T extends Record<string, unknown>>(btn: T, opts?: BtnOpts): T {
  if (opts?.style) (btn as Record<string, unknown>).style = opts.style;
  if (opts?.icon) (btn as Record<string, unknown>).icon_custom_emoji_id = opts.icon;
  return btn;
}

// Colored callback button with optional custom-emoji icon
export function cbtn(text: string, data: string, opts?: BtnOpts) {
  return decorate(Markup.button.callback(text, data) as Record<string, unknown>, opts) as ReturnType<
    typeof Markup.button.callback
  >;
}

// Colored URL button with optional custom-emoji icon
export function ubtn(text: string, url: string, opts?: BtnOpts) {
  return decorate(Markup.button.url(text, url) as Record<string, unknown>, opts) as ReturnType<
    typeof Markup.button.url
  >;
}
