import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

async function generateIcons() {
  const imagesDir = path.resolve('src/assets/images');
  let sourceImage = '';

  if (fs.existsSync(imagesDir)) {
    const files = fs.readdirSync(imagesDir);
    const logoFile = files.find(f => f.startsWith('focus_scroll_logo') && (f.endsWith('.jpg') || f.endsWith('.png')));
    if (logoFile) {
      sourceImage = path.join(imagesDir, logoFile);
    }
  }

  if (!sourceImage || !fs.existsSync(sourceImage)) {
    console.error('Source image not found in src/assets/images');
    process.exit(1);
  }

  const outDir = path.resolve('public/icon');
  fs.mkdirSync(outDir, { recursive: true });

  const sizes = [16, 32, 48, 96, 128, 256, 512];

  for (const size of sizes) {
    const destPath = path.join(outDir, `${size}.png`);
    await sharp(sourceImage)
      .resize(size, size, { fit: 'cover' })
      .png({ quality: 95 })
      .toFile(destPath);
    console.log(`Generated: ${destPath}`);
  }

  // Also copy main logo.png to public/
  await sharp(sourceImage)
    .resize(512, 512, { fit: 'cover' })
    .png({ quality: 95 })
    .toFile(path.resolve('public/logo.png'));
  console.log('Generated public/logo.png');

  // Also generate crisp SVG icon for super crisp rendering in popup
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <defs>
    <linearGradient id="fsGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="50%" stop-color="#0284c7" />
      <stop offset="100%" stop-color="#4f46e5" />
    </linearGradient>
    <linearGradient id="glowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.9" />
      <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.3" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.5" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
  <!-- Background Rounded Shield -->
  <rect width="48" height="48" rx="12" fill="#090d16" />
  <rect x="0.75" y="0.75" width="46.5" height="46.5" rx="11.25" stroke="url(#fsGrad)" stroke-width="1.5" stroke-opacity="0.6" />
  
  <!-- Outer Focus Reticle Ring -->
  <circle cx="24" cy="24" r="15" stroke="url(#fsGrad)" stroke-width="2.5" stroke-dasharray="7 3.5" stroke-linecap="round" filter="url(#glow)" />
  
  <!-- Middle Pulse Ring -->
  <circle cx="24" cy="24" r="9.5" stroke="#22d3ee" stroke-width="2" stroke-opacity="0.85" stroke-dasharray="12 4" stroke-linecap="round" />
  
  <!-- Center Play/Pause Mindfulness Focus Core -->
  <path d="M21 17.5L30 24L21 30.5V17.5Z" fill="url(#fsGrad)" />
  <circle cx="24" cy="24" r="2" fill="#ffffff" />
</svg>`;

  fs.writeFileSync(path.resolve('public/logo.svg'), svgContent);
  fs.writeFileSync(path.resolve('public/icon/logo.svg'), svgContent);
  console.log('Generated public/logo.svg');
}

generateIcons().catch(err => {
  console.error(err);
  process.exit(1);
});
