/* eslint-env node */
// Generates sample photos and pushes them into the app's private storage on the
// connected Android device (debug builds only, via `adb run-as`).
//   big.jpg   ~4000x3000 random noise: compresses badly, so it is >10 MB and
//             exercises the "originals can be 18 MB" path.
//   small.jpg 1200x800 gradient.
const { Jimp } = require('jimp');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PKG = 'com.ikrama.assignment';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'field-reports-'));

async function make(name, width, height, pixel) {
  const image = new Jimp({ width, height, color: 0xffffffff });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      image.setPixelColor(pixel(x, y, width, height), x, y);
    }
  }
  const file = path.join(out, name);
  fs.writeFileSync(file, await image.getBuffer('image/jpeg', { quality: 100 }));
  console.log(`${name}: ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
  return file;
}

const rgba = (r, g, b) => ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0; // eslint-disable-line no-bitwise

(async () => {
  const files = [
    await make('big.jpg', 4000, 3000, () =>
      rgba(Math.random() * 256, Math.random() * 256, Math.random() * 256),
    ),
    await make('small.jpg', 1200, 800, (x, y, w, h) =>
      rgba((x / w) * 255, (y / h) * 255, 128),
    ),
  ];
  const adb = (...args) => execFileSync('adb', args, { stdio: 'inherit' });
  adb('shell', 'run-as', PKG, 'mkdir', '-p', 'files/testdata');
  for (const f of files) {
    const name = path.basename(f);
    adb('push', f, `/data/local/tmp/${name}`);
    adb('shell', 'run-as', PKG, 'cp', `/data/local/tmp/${name}`, `files/testdata/${name}`);
  }
  console.log('Pushed to files/testdata on the device.');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
