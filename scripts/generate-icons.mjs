// Generates PWA icons from the NibrasTube logo (primary rounded square +
// white play-circle) using sharp. Run: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRIMARY = "#ca3500"; // --primary from app/globals.css

const svg = (size, { rounded, glyphScale }) => {
  const r = rounded ? size * 0.22 : 0;
  const c = size / 2;
  const glyphR = size * glyphScale;
  const t = glyphR * 0.52; // half-height of play triangle
  const tip = c + glyphR * 0.62;
  const back = c - glyphR * 0.38;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${PRIMARY}"/>
  <circle cx="${c}" cy="${c}" r="${glyphR}" fill="#ffffff"/>
  <path d="M ${back} ${c - t} L ${tip} ${c} L ${back} ${c + t} Z" fill="${PRIMARY}" stroke="${PRIMARY}" stroke-width="${size * 0.04}" stroke-linejoin="round"/>
</svg>`;
};

// Standard icon: rounded corners, glyph ~46% of canvas
const standard = (size) => svg(size, { rounded: true, glyphScale: 0.24 });
// Maskable/apple: full-bleed background, glyph kept inside safe zone
const maskable = (size) => svg(size, { rounded: false, glyphScale: 0.2 });

const icons = [
  ["public/icons/icon-192.png", standard(192)],
  ["public/icons/icon-512.png", standard(512)],
  ["public/icons/icon-maskable-192.png", maskable(192)],
  ["public/icons/icon-maskable-512.png", maskable(512)],
  ["app/apple-icon.png", maskable(180)],
];

await mkdir(join(root, "public/icons"), { recursive: true });

for (const [path, source] of icons) {
  await sharp(Buffer.from(source)).png().toFile(join(root, path));
  console.log(`wrote ${path}`);
}

await writeFile(join(root, "app/icon.svg"), standard(512));
console.log("wrote app/icon.svg");
