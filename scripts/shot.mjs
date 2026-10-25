// Zrzut ekranu gry + logi konsoli: `node scripts/shot.mjs [url] [out.png]`
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '.debug/shot.png';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('console', (m) => !/GL Driver|\[vite\]/.test(m.text()) && console.log('console.' + m.type() + ':', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('requestfailed', (r) => console.log('requestfailed:', r.url(), r.failure()?.errorText));
page.on('response', (r) => r.status() >= 400 && console.log('http', r.status(), r.url()));
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 6000));
if (process.argv.includes('--play')) {
  // Postaw kilka wież wokół środka ekranu i wypuść falę.
  // Pola budowy najbliżej Syrenki, przeliczone na piksele ekranu.
  const spots = await page.evaluate(() => {
    const { level, map } = window.__game;
    const g = level.goal.pos;
    return level.cells.centers
      .map((c) => [c, (c[0] - g[0]) ** 2 + (c[1] - g[1]) ** 2])
      .sort((a, b) => a[1] - b[1])
      .filter((_, i) => i % 7 === 0)
      .slice(0, 4)
      .map(([c]) => map.project(c))
      .map((p) => [p.x, p.y]);
  });
  for (const [k, [x, y]] of ['1', '2', '1', '3'].map((k, i) => [k, spots[i]])) {
    await page.keyboard.press(k);
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
  }
  await page.keyboard.press('Space');
  await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 25000)));
}
console.log('game:', await page.evaluate(() => {
  const { state: s, map } = window.__game;
  return { time: s.time.toFixed(1), phase: s.phase, enemies: s.enemies.length, onScreen: s.enemies.filter((e) => { const p = map.project(e.pos); return p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight; }).length, towers: s.towers.length, sample: JSON.stringify(s.enemies.slice(0,3).map((e) => ({ k: e.kind, pos: e.pos, scr: map.project(e.pos), start: e.path[0], end: e.path.at(-1) }))), proj: s.projectiles.length };
}));
console.log('canvas:', await page.evaluate(() => {
  const c = document.getElementById('game');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
  const cs = getComputedStyle(c);
  return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, painted: n, z: cs.zIndex, pos: cs.position };
}));
await page.screenshot({ path: out });
console.log('zapisano', out);
await browser.close();
