// Arkusz wszystkich sprite'ów: `node scripts/sprites-sheet.mjs [out.png]` (wymaga dev servera na :5173).
import puppeteer from 'puppeteer-core';
const out = process.argv[2] ?? '.debug/sprites.png';
const qs = process.argv[3] ?? '';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1900,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1900, height: 1000 });
page.on('console', (m) => console.log('console.' + m.type() + ':', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.stack));
await page.goto('http://localhost:5173/sprites.html' + qs, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction('window.__done', { timeout: 20000 });
await page.screenshot({ path: out });
await browser.close();
console.log('zapisano', out);
