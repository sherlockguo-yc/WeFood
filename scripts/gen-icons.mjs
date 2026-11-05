import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../web/public/', import.meta.url));
const faviconSvg = readFileSync(new URL('../web/public/favicon.svg', import.meta.url), 'utf8');
const CLAY = '#A8461F';

const sized = (svg, size) => Buffer.from(svg.replace('<svg ', `<svg width="${size}" height="${size}" `));
const render = (svg, size) => sharp(sized(svg, size)).png().toBuffer();
const solid = size => sharp({ create: { width: size, height: size, channels: 4, background: CLAY } }).png().toBuffer();

async function icon({ size, file, inset = 0, background = false }) {
  const inner = Math.round(size * (1 - inset * 2));
  const glyph = await render(faviconSvg, inner);
  if (!background) {
    await sharp(glyph).png().toFile(publicDir + file);
    return;
  }
  const offset = Math.round((size - inner) / 2);
  const base = await solid(size);
  await sharp(base).composite([{ input: glyph, left: offset, top: offset }]).png().toFile(publicDir + file);
  console.log(`${file}: ${size}x${size}`);
}

await icon({ size: 32, file: 'favicon-32.png' });
await icon({ size: 180, file: 'apple-touch-icon.png', inset: 0.1, background: true });
await icon({ size: 192, file: 'icon-192.png', inset: 0.07, background: true });
await icon({ size: 512, file: 'icon-512.png', inset: 0.07, background: true });
await icon({ size: 512, file: 'icon-maskable-512.png', inset: 0.15, background: true });
console.log('WeFood 图标生成完成');
