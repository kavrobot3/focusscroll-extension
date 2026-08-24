import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.resolve('.output/chrome-mv3');
const destDir = path.resolve('dist');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(srcDir, destDir, { recursive: true });
  const popupHtml = path.join(destDir, 'popup.html');
  const indexHtml = path.join(destDir, 'index.html');
  if (fs.existsSync(popupHtml)) {
    fs.copyFileSync(popupHtml, indexHtml);
  }
}
