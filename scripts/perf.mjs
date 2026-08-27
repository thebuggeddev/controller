import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = process.env.SHOT_DIR || '.verify';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel:'chrome', args:['--use-angle=metal','--ignore-gpu-blocklist'] });

const fpsOf = (page) => page.evaluate(() => new Promise(res => {
  let n=0; const t=performance.now();
  const loop=()=>{ n++; if(performance.now()-t < 3000) requestAnimationFrame(loop); else res(Math.round(n/((performance.now()-t)/1000))); };
  requestAnimationFrame(loop);
}));

// A control reading from an empty page. Frame rate here is capped by the
// compositor and by whatever else the machine is doing, so the site's number is
// only meaningful against this ceiling — not against a nominal 60.
const control = await browser.newPage({ viewport:{width:1586,height:992} });
await control.setContent('<body style="background:#111"></body>');
await control.waitForTimeout(800);
const ceiling = await fpsOf(control);
await control.close();
console.log('blank-page ceiling:', ceiling, 'fps');

for (const [tag, w, h, dpr] of [['desktop',1920,1080,2], ['phone',390,844,3]]) {
  const page = await browser.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:dpr, isMobile:w<900, hasTouch:w<900 });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  let modelBytes = 0;
  page.on('response', async r => {
    if (r.url().endsWith('.glb')) modelBytes += Number(r.headers()['content-length'] || 0);
  });
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil:'load' });
  await page.waitForFunction(()=>!document.querySelector('.loader'), null, {timeout:120000});
  const ready = Date.now()-t0;
  const firstPaintBytes = modelBytes;
  await page.waitForTimeout(2000);

  const fps = await fpsOf(page);
  const info = await page.evaluate(()=>({
    backend: window.__backend,
    canvasPx: (()=>{const c=document.querySelector('canvas'); return c? c.width+'x'+c.height : '-';})(),
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576)+'MB' : 'n/a',
  }));
  console.log(tag.padEnd(8), 'ready', ready+'ms', `| fps ${fps}/${ceiling}`,
    '| model bytes at reveal', (firstPaintBytes/1048576).toFixed(1)+'MB',
    '|', JSON.stringify(info), errs.length?('ERR '+errs[0]):'');
  await page.screenshot({path:`${OUT}/perf-${tag}.png`});
  await page.close();
}
await browser.close();
