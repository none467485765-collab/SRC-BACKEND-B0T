export const ADMIN_IDS: number[] = [8449138605, 7093567772];

export const PLANS = [
  {
    id: "1month",
    name: "1 Month",
    price: 250,
    emoji: "🗓",
    badge: "STARTER",
    description: "Full CELLIK R4T access for 1 month",
    highlights: ["All core features", "Remote control", "Banking overlays", "24/7 support"],
  },
  {
    id: "1month_rdp",
    name: "1 Month + RDP",
    price: 300,
    emoji: "📺",
    badge: "POPULAR",
    description: "1 month access + Remote Desktop included",
    highlights: ["Everything in Starter", "Dedicated RDP server", "Better performance", "Remote management"],
  },
  {
    id: "lifetime",
    name: "Lifetime",
    price: 1200,
    emoji: "💎",
    badge: "BEST VALUE",
    description: "Lifetime access — pay once, use forever",
    highlights: ["All features forever", "All future updates", "Priority support", "Best investment"],
  },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];

export function getPlan(id: string) {
  return PLANS.find((p) => p.id === id) ?? null;
}

// ── Direct crypto wallet addresses ──────────────────────────
export const WALLETS = {
  BTC:  { symbol: "BTC",  name: "Bitcoin (BTC)",      address: "bc1q50vz404jt2nv6fzuvjk7s4pwxhyruhdrm4hmvm", decimals: 8 },
  ETH:  { symbol: "ETH",  name: "Ethereum (ETH)",     address: "0xb797Ed0d488d19E0ef8E5a87f833d29723a2625b",  decimals: 18 },
  USDT: { symbol: "USDT", name: "USDT TRC20",         address: "TER25K2HaNkwJzpGm4nVnHaXyybGBXpLBG",         decimals: 6 },
  LTC:  { symbol: "LTC",  name: "Litecoin (LTC)",     address: "ltc1qnqgwh56vl4phlkgc9hc5cvqex3n3j2gvrxw88p", decimals: 8 },
  SOL:  { symbol: "SOL",  name: "Solana (SOL)",       address: "GjLkBqRQZHNFuy9pugg2NGgGZQys1wdDTpPEUajXoPGP", decimals: 9 },
  BNB:  { symbol: "BNB",  name: "BNB Smart Chain",    address: "0xb797Ed0d488d19E0ef8E5a87f833d29723a2625b",  decimals: 18 },
} as const;

export type CoinSymbol = keyof typeof WALLETS;

export const SELLER_USERNAME = "@CellikBackup";
export const SELLER_URL     = "https://t.me/CellikBackup";
export const WEBSITE_URL    = "https://cellikrat.netlify.app/";
export const CHANNEL_URL    = "https://t.me/+LuEyJqC-XIcyODAx";

// Custom emoji helper — wraps a Telegram Premium custom emoji sticker.
// Only works in HTML parse mode.
const ce = (id: string, fallback: string) =>
  `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;

export const FEATURES_TEXT =
  `${ce("5251591568065845575", "☠️")} <b>CELLIK R4T — Full Feature List</b>\n` +
  `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

  `${ce("5350803719170564382", "🎮")} <b>Remote Control</b>\n` +
  `› Real-time screen viewing\n` +
  `› Touch simulation &amp; full remote interaction\n` +
  `› Screen recording (FFMPEG)\n` +
  `› Screenshot capture on demand\n` +
  `› Remote device reboot / shutdown\n\n` +

  `${ce("5854710508065658472", "📸")} <b>Media Access</b>\n` +
  `› Front &amp; back camera access\n` +
  `› Remote photo capture\n` +
  `› Microphone recording\n` +
  `› Live audio streaming\n` +
  `› Gallery browsing\n\n` +

  `${ce("5352858062157783478", "🧭")} <b>File Management</b>\n` +
  `› Full file system browsing\n` +
  `› Upload / download files\n` +
  `› File search &amp; filtering\n` +
  `› Delete, rename &amp; move files\n` +
  `› Directory creation\n\n` +

  `${ce("5253934163488167292", "🗣️")} <b>Communication</b>\n` +
  `› SMS read &amp; send\n` +
  `› Call logs access\n` +
  `› Contact list extraction\n` +
  `› Live chat messaging\n` +
  `› Call forwarding control\n` +
  `› USSD code execution\n\n` +

  `${ce("5350556204500263431", "🍏")} <b>App Management</b>\n` +
  `› View all installed applications\n` +
  `› Launch / close apps remotely\n` +
  `› Install / uninstall APKs\n` +
  `› App usage statistics\n` +
  `› Package &amp; permission information\n\n` +

  `${ce("5251591568065845575", "☠️")} <b>Banking/Crypto Injections</b>\n` +
  `› HTML / JavaScript injection\n` +
  `› Browser overlay injection\n` +
  `› WebView injection\n` +
  `› Accessibility-based injection\n` +
  `› Real-time form &amp; input data capture\n\n` +

  `${ce("5370715226209525171", "🔋")} <b>Device Information</b>\n` +
  `› Full device specifications\n` +
  `› Battery status\n` +
  `› Network (WiFi / mobile) information\n` +
  `› GPS location tracking\n` +
  `› SIM card &amp; IMEI identifiers\n\n` +

  `${ce("5253871620174402707", "😎")} <b>Monitoring</b>\n` +
  `› System-wide keylogger (all apps)\n` +
  `› Clipboard monitoring\n` +
  `› Notification reading\n` +
  `› App activity tracking\n\n` +

  `${ce("5352888345972187597", "🛡")} <b>Permissions &amp; Access</b>\n` +
  `› Accessibility service integration\n` +
  `› Device admin privileges\n` +
  `› Auto-start on boot\n` +
  `› Battery optimization bypass\n` +
  `› Notification listener &amp; overlay access\n\n` +

  `${ce("5253593529631922134", "👹")} <b>Stealth Features</b>\n` +
  `› Hidden app icon mode\n` +
  `› Background service operation\n` +
  `› Persistent encrypted connection\n` +
  `› Auto-reconnect on disconnect\n` +
  `› Excluded from recent apps\n` +
  `› Silent operation (no user alerts)\n\n` +

  `${ce("5330194932781050507", "🌟")} <b>Custom Overlays</b>\n` +
  `› 250+ Pre-Built overlays\n` +
  `› Custom Overlay Maker &amp; Editor\n` +
  `› Real-time overlay preview\n\n` +

  `${ce("6276168523471393020", "⚡️")} <b>Advanced Controls</b>\n` +
  `› Custom notification injection\n` +
  `› Screen lock / unlock\n` +
  `› Flashlight, vibration &amp; volume control\n` +
  `› VPN detection &amp; proxy support\n` +
  `› DDoS capability\n` +
  `› Toast message display\n\n` +

  `${ce("5287292843763713628", "🌐")} <b>Connection &amp; Networking</b>\n` +
  `› HTTP / HTTPS &amp; WebSocket support\n` +
  `› Automatic reconnection\n` +
  `› Multiple server support\n` +
  `› Encrypted connections\n\n` +

  `${ce("5370784581341422520", "⭐️")} <b>Compatibility</b>\n` +
  `› Android 7.0 → 16+\n` +
  `› Multi-language (EN, AR, ZH, RU, TR, PT, ES)\n` +
  `› Works on all major brands\n` +
  `› No root required\n\n` +

  `${ce("5462902520215002477", "💎")} <b>EXTRAS</b>\n` +
  `› ANTI Delete / Anti Kill Mode\n` +
  `› No Port Forwarding Needed\n` +
  `› Social Media Monitoring\n` +
  `› Play Store Integration\n` +
  `› FUD Crypting Service Included\n\n` +

  `━━━━━━━━━━━━━━━━━━━━━━━`;
