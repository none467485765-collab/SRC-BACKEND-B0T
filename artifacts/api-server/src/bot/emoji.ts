// ─────────────────────────────────────────────────────────────
// Emoji registry
//
// CE  — premium custom emoji wrapped in <tg-emoji> for message text.
//       Only works with parse_mode: "HTML". Displays animated for
//       Premium users; falls back to the plain unicode char for others.
//
// BE  — plain unicode for button labels (Telegram ignores HTML in buttons).
// ─────────────────────────────────────────────────────────────

const tge = (id: string, fallback: string) =>
  `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;

export const CE = {
  // ── Core UI ────────────────────────────────────────────────
  shield:      tge("5352888345972187597", "🛡"),    // confirmed
  lightning:   tge("6276168523471393020", "⚡️"),   // confirmed
  diamond:     tge("5462902520215002477", "💎"),    // confirmed
  diamond2:    tge("5850479475652824718", "💎"),    // confirmed (alt)
  star:        tge("5370784581341422520", "⭐️"),   // confirmed
  glowstar:    tge("5330194932781050507", "🌟"),    // confirmed
  money:       tge("6233367447789899509", "💰"),    // confirmed
  dollar:      tge("5215696838451014017", "💲"),    // confirmed
  skull:       tge("5251591568065845575", "☠️"),    // confirmed
  cool:        tge("5253871620174402707", "😎"),    // confirmed
  thumbsup:    tge("5431676840957724997", "👍"),    // confirmed
  banned:      tge("6275767489490063307", "🚫"),    // confirmed
  speak:       tge("5197304993920616826", "📣"),    // confirmed
  globe:       tge("5287292843763713628", "🌐"),    // confirmed
  calendar:    tge("5251443675161976035", "🗓"),    // confirmed
  camera:      tge("5854710508065658472", "📸"),    // confirmed
  battery:     tge("5370715226209525171", "🔋"),    // confirmed
  controller:  tge("5350803719170564382", "🎮"),    // confirmed
  tv:          tge("5413681168505650617", "📺"),    // confirmed
  contact:     tge("5213179235996294999", "📞"),    // confirmed
  usaflag:     tge("5240190491479261926", "🇺🇸"),  // confirmed
  shock:       tge("5253914436703376580", "😵"),    // confirmed
  explosion:   tge("5219901967916084166", "💥"),    // confirmed
  fire:        tge("5253458624709154474", "🔥"),    // confirmed
  exclamation: tge("5188463524568926712", "⚠️"),   // confirmed
  wrench:      tge("5350396951407895212", "⚙️"),   // confirmed
  tool:        tge("5258023599419171861", "🔧"),    // confirmed
  cart:        tge("5258024802010026053", "🛒"),    // confirmed
  laugh:       tge("5465383954750122781", "😂"),    // confirmed
  smile:       tge("5195297345817816825", "🙂"),    // confirmed
  brokenheart: tge("5271788286703082174", "💔"),    // confirmed
  airplane:    tge("5217890643321300022", "✈️"),   // confirmed
  butterfly:   tge("5289862389552919154", "🦋"),    // confirmed

  // ── Emotions & expressions ─────────────────────────────────
  cry:         tge("6296341890371422476", "😢"),    // confirmed
  shocked:     tge("5465264391450536996", "😱"),    // confirmed
  heart:       tge("6296508771325707891", "❤️"),   // confirmed
  blueheart:   tge("5253790350803228534", "💙"),    // confirmed
  sparkle:     tge("5287441887718838295", "✨"),    // confirmed
  laugh2:      tge("5253537149596228810", "😂"),    // confirmed (alt pack)
  demon:       tge("5253593529631922134", "👹"),    // confirmed
  gun:         tge("5251479963340660118", "🔫"),    // confirmed
  speak2:      tge("5253934163488167292", "🗣"),    // confirmed

  // ── Actions & objects ──────────────────────────────────────
  clap:        tge("5391115556361370746", "👏"),    // confirmed
  handshake:   tge("5393514467394875868", "🤝"),   // confirmed
  ghost:       tge("5400115608790532468", "👻"),    // confirmed
  call:        tge("5391143319029968523", "🤙"),    // confirmed
  eyes:        tge("5390884053329146510", "👀"),    // confirmed
  trophy:      tge("5399852280050646232", "🏆"),    // confirmed
  redhot:      tge("5398065874303220590", "🔴"),    // confirmed
  drop:        tge("5373135805353041178", "💧"),    // confirmed
  dance:       tge("5431823741724149238", "🕺"),    // confirmed
  compass:     tge("5352858062157783478", "🧭"),    // confirmed
  app:         tge("5350556204500263431", "🍏"),    // confirmed
  check:       tge("5368324170671202286", "✅"),    // checkmark
  tv2:         tge("5413681168505650617", "📺"),    // confirmed (alias)
} as const;

// Button labels — plain unicode only (HTML is ignored in Telegram button text)
export const BE = {
  shield:      "🛡",
  lightning:   "⚡️",
  diamond:     "💎",
  diamond2:    "💎",
  star:        "⭐️",
  glowstar:    "🌟",
  money:       "💰",
  dollar:      "💲",
  skull:       "☠️",
  cool:        "😎",
  thumbsup:    "👍",
  banned:      "🚫",
  speak:       "📣",
  globe:       "🌐",
  calendar:    "🗓",
  camera:      "📸",
  battery:     "🔋",
  controller:  "🎮",
  tv:          "📺",
  contact:     "📞",
  usaflag:     "🇺🇸",
  shock:       "😵",
  explosion:   "💥",
  fire:        "🔥",
  exclamation: "⚠️",
  wrench:      "⚙️",
  tool:        "🔧",
  cart:        "🛒",
  laugh:       "😂",
  smile:       "🙂",
  brokenheart: "💔",
  airplane:    "✈️",
  butterfly:   "🦋",
  cry:         "😢",
  shocked:     "😱",
  heart:       "❤️",
  blueheart:   "💙",
  sparkle:     "✨",
  demon:       "👹",
  gun:         "🔫",
  clap:        "👏",
  handshake:   "🤝",
  ghost:       "👻",
  call:        "🤙",
  eyes:        "👀",
  trophy:      "🏆",
  redhot:      "🔴",
  drop:        "💧",
  dance:       "🕺",
  compass:     "🧭",
  app:         "🍏",
  check:       "✅",
} as const;

export type CEKey = keyof typeof CE;
