// Copies the QR code library into public/vendor so the site serves it itself
// (no third-party scripts, which the Content-Security-Policy would block anyway).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'qrcode-generator');

if (!existsSync(pkgDir)) {
  console.warn('vendor: qrcode-generator is not installed. Run "npm install". QR codes will be hidden until then.');
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const candidates = [pkg.browser, pkg.unpkg, pkg.jsdelivr, 'qrcode.js', pkg.main, 'dist/qrcode.js']
  .filter((p) => typeof p === 'string')
  .map((p) => join(pkgDir, p));
const source = candidates.find((p) => existsSync(p));

if (!source) {
  console.warn('vendor: could not find qrcode.js inside qrcode-generator. QR codes will be hidden.');
  process.exit(0);
}

mkdirSync(join(root, 'public', 'vendor'), { recursive: true });
copyFileSync(source, join(root, 'public', 'vendor', 'qrcode.js'));
console.log('vendor: copied qrcode.js');
