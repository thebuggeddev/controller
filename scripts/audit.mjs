import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = process.env.SHOT_DIR || '.verify';
fs.mkdirSync(OUT, {recursive:true});
const browser = await chromium.launch({ channel:'chrome', args:['--use-angle=metal','--ignore-gpu-blocklist'] });

const VIEWS = [
  ['loader',    1586, 992, { early: 900 }],
  ['mid',       1586, 992, { mid: true }],
  ['laptop',    1280, 800, {}],
  ['laptop-sm', 1024, 640, {}],
  ['tablet',     834, 1112, { full: true }],
  ['tablet-sm',  768, 1024, { full: true }],
  ['phone',      390, 844, { full: true }],
  ['phone-sm',   360, 740, { full: true }],
  ['phone-land', 844, 390, { full: true }],
  ['ultrawide', 2560, 1080, {}],
];

for (const [tag, w, h, opt] of VIEWS) {
  const page = await browser.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:1, isMobile: w < 900, hasTouch: w < 900 });
  const errs = [];
  page.on('pageerror', e=>errs.push(e.message));
  page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
  await page.goto(BASE, { waitUntil:'load' });
  if (opt.early) { await page.waitForTimeout(opt.early); }
  else { await page.waitForTimeout(10000); }
  if (opt.mid) { await page.click('.arrow-button--next'); await page.waitForTimeout(620); }
  // Full-page captures of a fixed WebGL canvas can be slow under load.
  try {
    await page.screenshot({ path: `${OUT}/aud-${tag}.png`, fullPage: !!opt.full, timeout: 90000 });
  } catch (error) {
    console.log(`  (screenshot skipped for ${tag}: ${error.message.split('\n')[0]})`);
  }
  const m = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
    docH: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  console.log(tag.padEnd(11), `${w}x${h}`.padEnd(10), 'overflowX:', m.overflowX, 'doc', m.docW+'x'+m.docH, errs.length?('ERR '+errs.slice(0,3).join(' | ')):'');
  await page.close();
}
await browser.close();
