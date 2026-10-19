import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

async function generateAppIcon() {
  const dir = path.resolve('apps/operator-desktop/build');
  fs.mkdirSync(dir, { recursive: true });

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#09090b"/>
      <stop offset="100%" stop-color="#18181b"/>
    </linearGradient>
    <linearGradient id="lens" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="52" fill="url(#bg)"/>
  <rect x="18" y="18" width="220" height="220" rx="38" fill="none" stroke="#27272a" stroke-width="4"/>
  <rect x="52" y="60" width="152" height="136" rx="28" fill="#18181b" stroke="#3f3f46" stroke-width="6"/>
  <path d="M 96 60 L 108 44 L 148 44 L 160 60 Z" fill="#27272a" stroke="#3f3f46" stroke-width="4"/>
  <circle cx="128" cy="128" r="48" fill="none" stroke="url(#lens)" stroke-width="12"/>
  <circle cx="128" cy="128" r="28" fill="#0f172a"/>
  <circle cx="138" cy="118" r="8" fill="#38bdf8" opacity="0.8"/>
  <circle cx="172" cy="80" r="8" fill="#ef4444"/>
</svg>
`.trim();

  const pngBuf = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  fs.writeFileSync(path.join(dir, 'icon.png'), pngBuf);

  // Pack PNG into ICO format (standard 256x256 Vista+ ICO)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(1, 4); // 1 image

  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(0, 0); // width 256 -> 0
  dirEntry.writeUInt8(0, 1); // height 256 -> 0
  dirEntry.writeUInt8(0, 2); // color count
  dirEntry.writeUInt8(0, 3); // reserved
  dirEntry.writeUInt16LE(1, 4); // color planes
  dirEntry.writeUInt16LE(32, 6); // bits per pixel
  dirEntry.writeUInt32LE(pngBuf.length, 8); // image size
  dirEntry.writeUInt32LE(22, 12); // image offset (6 + 16 = 22)

  const icoBuf = Buffer.concat([header, dirEntry, pngBuf]);
  fs.writeFileSync(path.join(dir, 'icon.ico'), icoBuf);
  console.log('App icon generated successfully at:', path.join(dir, 'icon.ico'), 'size:', icoBuf.length);
}

generateAppIcon().catch((err) => {
  console.error(err);
  process.exit(1);
});
