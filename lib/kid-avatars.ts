// Preset emoji avatars for the kid-facing settings page — the single
// allow-list shared by the client picker (renders the grid) and the
// updateKidAvatar server action (validates the submitted value), so a
// forged value can never be stored. profiles.avatar still accepts any
// parent-set string; this list only constrains the kid picker.
export const KID_AVATARS = [
  "🦊",
  "🐻",
  "🐼",
  "🐨",
  "🦁",
  "🐯",
  "🐸",
  "🐵",
  "🦄",
  "🐰",
  "🐱",
  "🐶",
  "🐷",
  "🐥",
  "🦖",
  "🦕",
  "🐙",
  "🦋",
  "🐢",
  "🐠",
  "🚀",
  "⭐",
  "🌈",
  "⚽",
  "🎨",
  "🎸",
  "🍕",
  "🧁",
  "🤖",
  "👽",
] as const;

export type KidAvatar = (typeof KID_AVATARS)[number];

export function isKidAvatar(value: string): value is KidAvatar {
  return (KID_AVATARS as readonly string[]).includes(value);
}
