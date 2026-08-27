import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = process.env.SHOT_DIR || '.verify';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel:'chrome', args:['--use-angle=metal','--ignore-gpu-blocklist'] });
const fail = [];
const ok = (n, c) => console.log((c?'  PASS':'  FAIL')+'  '+n) || (c||fail.push(n));
/** Every card in the rail must carry artwork — none may render empty. */
const cards_expected = (rail) => 3;

/* ---- 1. rapid clicking must never overlap model transitions ---- */
{
  const page = await browser.newPage({ viewport:{width:1440,height:900} });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(BASE); await page.waitForTimeout(9000);
  for (let i=0;i<9;i++){ await page.click('.arrow-button--next', {force:true}); await page.waitForTimeout(70); }
  await page.waitForTimeout(6000);
  const st = await page.evaluate(()=>({
    title: document.querySelector('.product-info__line-inner').textContent,
    // The rail shows the alternatives, so the campaign on show is the hidden card.
    hidden: [...document.querySelectorAll('.variant-card')]
      .filter(c => c.getAttribute('aria-hidden') === 'true').map(c => c.dataset.index),
    seg: [...document.querySelectorAll('.carousel__segment')].findIndex(s=>s.classList.contains('is-active')),
    busy: document.querySelector('.arrow-button--next').disabled,
    canvases: document.querySelectorAll('canvas').length,
  }));
  console.log('rapid-click result', JSON.stringify(st), errs.length?('ERR '+errs[0]):'');
  ok('rapid clicking settles consistently',
    st.hidden.length === 1 && st.hidden[0] === String(st.seg) && !st.busy);
  ok('no page errors during rapid clicking', errs.length===0);
  await page.screenshot({path:`${OUT}/beh-rapid.png`});
  await page.close();
}

/* ---- 1b. no invisible product may write depth ---- */
{
  // While a campaign changes, a product that is not on screen still has a
  // depth-only pre-pass attached to it. If that pre-pass is left drawing, the
  // waiting controller stamps its silhouette into the depth buffer and punches
  // that shape out of the one still visible — chunks apparently torn out of the
  // model, on scattered frames, invisible to a screenshot taken either side.
  const page = await browser.newPage({ viewport:{width:1200,height:760} });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(BASE);
  await page.waitForFunction(()=>!document.querySelector('.loader'), null, {timeout:180000});
  await page.waitForTimeout(9000);

  let violations = 0, overlaps = 0, frames = 0;
  for (let pass = 0; pass < 3; pass++) {
    const r = await page.evaluate(async () => {
      const s = window.__scene;
      if (!s) return null;
      const states = []; let stop = false;
      const check = () => {
        const seen = [];
        s.scene.traverse(o => {
          if (!o.isMesh || !o.name.endsWith('__depth')) return;
          const owner = o.parent;
          let hidden = false;
          for (let n = o.parent; n; n = n.parent) if (n.visible === false) hidden = true;
          seen.push({ drawing: o.visible && !hidden, opacity: owner?.material?.opacity ?? 1,
                      ownerDrawing: !hidden && (owner?.visible !== false) });
        });
        states.push(seen);
        if (!stop) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
      document.querySelector('.arrow-button--next').click();
      await new Promise(r => setTimeout(r, 1900));
      stop = true;

      let bad = 0, both = 0;
      for (const st of states) {
        for (const x of st) if (x.drawing && x.opacity <= 0.001) bad++;
        if (st.filter(x => x.drawing || (x.ownerDrawing && x.opacity > 0.001)).length > 1) both++;
      }
      return { frames: states.length, bad, both };
    });
    if (!r) break;
    frames += r.frames; violations += r.bad; overlaps += r.both;
    await page.waitForTimeout(1400);
  }
  console.log(`depth invariant: ${frames} frames sampled, ${violations} invisible-product writes, ${overlaps} two-product frames`);
  ok('no invisible product writes depth during a change', violations === 0);
  ok('never two products writing depth at once', overlaps === 0);
  ok('no page errors while changing campaign', errs.length === 0);
  await page.close();
}

/* ---- 1c. no stray product may ever paint ---- */
{
  // Compiling a material means putting the object in the scene, and the awaits
  // around it let real frames render. Warming a model at the hero position
  // therefore showed it — briefly, twice, once per campaign being prepared.
  // Exactly one product may be painting into the frame at any moment.
  const page = await browser.newPage({ viewport:{width:1200,height:760} });
  await page.goto(BASE);
  await page.waitForFunction(()=>!document.querySelector('.loader'), null, {timeout:180000});

  const watch = (ms) => page.evaluate(async (duration) => {
    const s = window.__scene;
    if (!s) return null;
    const counts = []; let stop = false;
    const tick = () => {
      let painting = 0;
      s.scene.traverse(o => {
        if (!o.isMesh || o.name.endsWith('__depth')) return;
        let hidden = false;
        for (let n = o; n; n = n.parent) if (n.visible === false) hidden = true;
        const group = o.parent?.parent?.parent;
        // A model parked off-camera for compilation does not count as painting.
        const onStage = group && Math.abs(group.position.x) < 5;
        if (!hidden && (o.material?.opacity ?? 1) > 0.02 && onStage) painting++;
      });
      counts.push(painting);
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await new Promise(r => setTimeout(r, duration));
    stop = true;
    return { frames: counts.length, max: Math.max(...counts),
             changes: counts.filter((v,i)=> i && v !== counts[i-1]).length };
  }, ms);

  // The load and idle-preload window, then the settle after a change.
  const load = await watch(8000);
  await page.click('.arrow-button--next');
  await page.waitForTimeout(2200);
  const settled = await watch(3500);

  if (load && settled) {
    console.log(`stray paint: load ${load.frames} frames (max ${load.max}), settled ${settled.frames} frames (max ${settled.max}, ${settled.changes} changes)`);
    ok('only one product paints while loading', load.max <= 1);
    ok('only one product paints once settled', settled.max <= 1 && settled.changes === 0);
  }
  await page.close();
}

/* ---- 1d. the product's presence must never dip ---- */
{
  // Every attempt to hand over between products by opacity left a dip: their
  // fades have to be sequential to avoid ghosting, and sequential fades leave
  // the frames between them carrying almost nothing. Measured, the hero fell to
  // a fifth of its presence and came back — which is what a blink is. The
  // handover is a straight swap now, so exactly one product should be fully
  // opaque on every frame of a change.
  const page = await browser.newPage({ viewport:{width:1200,height:760} });
  await page.goto(BASE);
  await page.waitForFunction(()=>!document.querySelector('.loader'), null, {timeout:180000});
  await page.waitForTimeout(9000);

  let worst = 1, sampled = 0;
  for (let pass = 0; pass < 2; pass++) {
    const r = await page.evaluate(async () => {
      const s = window.__scene;
      if (!s) return null;
      const totals = []; let stop = false;
      const tick = () => {
        let total = 0;
        s.scene.traverse(o => {
          if (!o.isMesh || o.name.endsWith('__depth')) return;
          let hidden = false;
          for (let n = o; n; n = n.parent) if (n.visible === false) hidden = true;
          const g = o.parent?.parent?.parent;
          if (hidden || !g || Math.abs(g.position.x) > 5) return;
          total += o.material?.opacity ?? 1;
        });
        totals.push(total);
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      document.querySelector('.arrow-button--next').click();
      await new Promise(r => setTimeout(r, 2100));
      stop = true;
      return { frames: totals.length, min: Math.min(...totals), max: Math.max(...totals) };
    });
    if (!r) break;
    worst = Math.min(worst, r.min);
    sampled += r.frames;
    await page.waitForTimeout(1400);
  }
  console.log(`product presence: ${sampled} frames, lowest ${worst.toFixed(3)}`);
  ok('the product never dims or doubles during a change', worst > 0.98);
  await page.close();
}

/* ---- 1e. a change must complete on a device that does not preload ---- */
{
  // Phones keep only the campaign on show in memory, so a change there has to
  // fetch and compile a model first — seconds, not a tick. Starting the timeline
  // before that resolved meant every tween had played out by the time the scene
  // had anything to animate: the copy changed, the product did not, and the old
  // one stayed on screen until an unrelated scroll happened to reveal the new
  // one. The model is prepared before the timeline exists now.
  const page = await browser.newPage({
    viewport:{width:390,height:844}, hasTouch:true, isMobile:true, deviceScaleFactor:3,
  });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(BASE);
  await page.waitForFunction(()=>!document.querySelector('.loader'), null, {timeout:180000});
  await page.waitForTimeout(6000);

  const read = () => page.evaluate(() => {
    const s = window.__scene;
    let painting = 0;
    s.scene.traverse(o => {
      if (!o.isMesh || o.name.endsWith('__depth')) return;
      if (o.material?.isMeshBasicNodeMaterial) return;      // the floor planes
      let hidden = false;
      for (let n = o; n; n = n.parent) if (n.visible === false) hidden = true;
      const g = o.parent?.parent?.parent;
      if (g && Math.abs(g.position.x) > 5) return;          // parked for compile
      if (!hidden && (o.material?.opacity ?? 1) > 0.02) painting++;
    });
    return { title: document.querySelector('.product-info__line-inner')?.textContent, painting };
  });

  const before = await read();
  await page.click('.arrow-button--next');
  // The controls stay disabled for as long as the model takes to arrive.
  await page.waitForFunction(
    () => !document.querySelector('.arrow-button--next').disabled, null, {timeout:90000},
  );
  await page.waitForTimeout(1200);
  const after = await read();

  console.log(`cold switch: "${before.title}" -> "${after.title}", ${after.painting} product(s) painting`);
  ok('a cold switch changes the product on screen', after.title !== before.title);
  ok('a cold switch leaves exactly one product painting', after.painting === 1);
  ok('no page errors on a cold switch', errs.length === 0);

  // Switching while scrolled past the hero, then returning, must leave the new
  // product visible — the scroll fade and the change both write opacity.
  await page.evaluate(()=>window.scrollTo(0, 700));
  await page.waitForTimeout(800);
  await page.click('.arrow-button--next');
  await page.waitForFunction(
    () => !document.querySelector('.arrow-button--next').disabled, null, {timeout:90000},
  );
  await page.evaluate(()=>window.scrollTo(0, 0));
  await page.waitForTimeout(1400);
  const restored = await read();
  ok('a change made while scrolled restores on scrolling back', restored.painting === 1);
  await page.close();
}

/* ---- 2. keyboard navigation ---- */
{
  const page = await browser.newPage({ viewport:{width:1440,height:900} });
  await page.goto(BASE); await page.waitForTimeout(9000);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(2400);
  const a = await page.evaluate(()=>document.querySelector('.product-info__line-inner').textContent);
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(2400);
  const b = await page.evaluate(()=>document.querySelector('.product-info__line-inner').textContent);
  ok('arrow keys change and restore the product', a==='GENSHIN' && b==='007 FIRST');
  // focus ring reachability
  const reach = await page.evaluate(async () => {
    const focusables = [...document.querySelectorAll('button, a[href]')].filter(e=>e.offsetParent!==null);
    return focusables.length;
  });
  ok('interactive elements are focusable ('+reach+')', reach >= 12);
  await page.close();
}

/* ---- 3. reduced motion ---- */
{
  const page = await browser.newPage({ viewport:{width:1440,height:900}, reducedMotion:'reduce' });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(BASE); await page.waitForTimeout(8000);
  await page.click('.arrow-button--next'); await page.waitForTimeout(900);
  const st = await page.evaluate(()=>({
    title: document.querySelector('.product-info__line-inner').textContent,
    loader: !!document.querySelector('.loader'),
  }));
  ok('reduced motion resolves the change quickly', st.title==='GENSHIN' && !st.loader);
  ok('reduced motion has no errors', errs.length===0);
  await page.screenshot({path:`${OUT}/beh-reduced.png`});
  await page.close();
}

/* ---- 4. touch swipe + mobile menu ---- */
{
  const page = await browser.newPage({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true });
  await page.goto(BASE); await page.waitForTimeout(9000);
  // Swipe over the copy, not over the product: a gesture on the product turns
  // it instead, which is checked separately below.
  const box = await page.locator('.product-info__description').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const y = Math.round(box.y + box.height / 2);
  const from = Math.round(box.x + box.width * 0.9);
  const to = Math.round(box.x + box.width * 0.08);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:from,y}] });
  for (const t of [0.35, 0.7, 1]) {
    await cdp.send('Input.dispatchTouchEvent', {
      type:'touchMove', touchPoints:[{ x: Math.round(from + (to-from)*t), y }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  // A swipe on a device that does not preload has to fetch a model first, so
  // wait for the change to settle rather than for a fixed interval.
  await page.waitForFunction(
    () => !document.querySelector('.arrow-button--next').disabled, null, {timeout:90000},
  );
  await page.waitForTimeout(1200);
  const swiped = await page.evaluate(()=>document.querySelector('.product-info__line-inner').textContent);
  ok('swipe advances the carousel (got "'+swiped+'")', swiped==='GENSHIN');

  // The product band turns the controller; a swipe elsewhere changes campaign.
  const band = await page.evaluate(() => {
    const r = document.querySelector('.hero__space').getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { onBand: el?.classList.contains('hero__space'), y: Math.round(r.y + r.height / 2) };
  });
  ok('the product band receives the pointer', band.onBand === true);

  const rail = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.variant-card')];
    return {
      shown: cards.filter(c => c.getAttribute('aria-hidden') !== 'true').length,
      withArt: cards.filter(c => c.classList.contains('has-artwork')).length,
    };
  });
  ok('the rail shows both alternatives and no empty card',
    rail.shown === 2 && rail.withArt === cards_expected(rail));

  await page.waitForTimeout(3600);
  const beforeDrag = await page.evaluate(()=>document.querySelector('.product-info__line-inner').textContent);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:300,y:band.y}] });
  for (const x of [250, 200, 150, 110]) {
    await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x,y:band.y}] });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  await page.waitForTimeout(1200);
  const afterDrag = await page.evaluate(()=>document.querySelector('.product-info__line-inner').textContent);
  ok('dragging the product turns it rather than changing campaign', beforeDrag === afterDrag);
  await page.waitForTimeout(3600);

  await page.click('.utility-button--menu');
  await page.waitForTimeout(900);
  const menu = await page.evaluate(()=>({
    open: !document.querySelector('.mobile-menu').hidden,
    exp: document.querySelector('.utility-button--menu').getAttribute('aria-expanded'),
  }));
  ok('mobile menu opens with correct aria', menu.open && menu.exp==='true');
  await page.screenshot({path:`${OUT}/beh-menu.png`});
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  const closed = await page.evaluate(()=>document.querySelector('.mobile-menu').hidden);
  ok('escape closes the mobile menu', closed);
  await page.close();
}

console.log(fail.length ? '\nFAILURES: '+fail.join(', ') : '\nALL BEHAVIOUR CHECKS PASSED');
await browser.close();
