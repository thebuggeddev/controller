# PS5 DualSense — 3D Product Showcase

An interactive, cinematic showcase for three limited-edition DualSense controllers —
**007 First Light**, **Genshin Impact** and **God of War** — built as a faithful,
responsive reproduction of the supplied reference design.

The hero product is a real 3D render: the supplied `.glb` models are loaded and lit
in the browser with three.js, and the atmosphere behind them — the radial glow,
the brush artwork, the vignette, the illuminated floor — is written in TSL and
evaluated per pixel, so a campaign change is a tween of shader inputs rather than
a swap of flat assets.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle
npm run preview    # serve the production build

npm run models     # rebuild the .glb assets from the source scans
npm run photos     # cut the studio photography out of its background
npm run brush      # regenerate the background brush artwork
npm run verify     # drive the running site and check layout, behaviour, perf
```

---

## What's here

```
index.html
public/
  models/*.glb            Draco-compressed controller models (see "Model pipeline")
  draco/gltf/             vendored Draco decoder (worker + wasm)
  photography/*.webp      cut-out studio shots, front and back per campaign
  brush/brush-strokes.svg generated background artwork
  fonts/                  self-hosted Archivo + Inter (no external requests)
src/
  main.ts                 entry — styles + app
  App.ts                  component tree, and the single timeline a campaign change runs on
  data/products.ts        every per-campaign value: copy, price, model, colour identity, lighting
  core/
    store.ts              minimal reactive state (index, phase, menu)
    theme.ts              bridges a product's identity into CSS custom properties
    motion.ts             shared easings, transition beats, reduced-motion handling
    dom.ts                element helpers
  ui/                     Header, MobileMenu, ProductInfo, ProductVariants,
                          CarouselControls, ProductIndicator, PromoCard,
                          SpecCards, Loader, icons
  three/
    ProductScene.ts       renderer, camera framing, render loop, transition choreography
    ProductModel.ts       per-model pose, pivot and fade
    Background.ts         TSL atmosphere bound to scene.backgroundNode
    GroundGlow.ts         TSL floor illumination + contact occlusion
    Lighting.ts           three-point studio rig + coloured floor bounce
    Environment.ts        (in assets.ts) procedural studio environment
    Thumbnails.ts         offscreen stills rendered from the real models
    assets.ts             model loading, procedural studio environment, brush rasterisation
  styles/
    tokens.css            the design system — colours, type, spacing, radii, motion
    base.css layout.css components.css responsive.css
scripts/
  optimize-models.mjs     the model pipeline (npm run models)
  prepare-photography.mjs cuts the studio shots out of their background (npm run photos)
  make-brush.mjs          generates the brush artwork (npm run brush)
  audit.mjs behaviour.mjs verification passes (npm run verify)
```

---

## Design system

Everything is driven from `src/styles/tokens.css`. Desktop values are derived from
the **1600 × 1000 reference canvas** and expressed as `clamp()` against viewport
units, so the composition keeps its proportions between a laptop and an ultrawide
instead of merely reflowing. Measured against the reference screenshot, the
built page lands the variant card at `1172, 366, 196 × 258` (reference:
`1172, 366, 196 × 258`), the promotional card at `88, 787, 275 × 176`, and the
title block within a couple of pixels.

Product identity flows one way:

```
products.ts  →  CSS custom properties  →  every component
             →  shader uniforms        →  background, floor, lighting
```

A campaign change tweens both ends of that on **one GSAP timeline**, so the copy,
the price, the specs, the thumbnails, the atmosphere and the model resolve as a
single motion. `--accent` alone re-skins the nav borders, category label, CTA,
arrows, progress bar and platform marker.

---

## The 3D layer

- **Renderer** — `WebGPURenderer` from `three/webgpu`, which uses WebGPU where the
  browser supports it and falls back to WebGL2 automatically. The active backend is
  reported on `window.__backend`.
- **Framing** — the camera is solved, not hand-placed: `frameCamera()` derives the
  distance that makes the product occupy the reference's share of the viewport,
  pulls back if a narrow window would crowd it, and uses `setViewOffset` to
  place the product off-centre by skewing the projection rather than translating
  the model, which keeps its perspective honest.
- **Image quality** — four things carry it, in roughly that order of return:

  - **Anisotropic filtering at 16×** on every product map. Worth more than any
    amount of extra resolution here: a controller is curved almost everywhere, so
    most of its surface meets the camera at a glancing angle, where trilinear
    filtering picks a blurrier mip for all of it.
  - **A shaded-pixel budget of 5 M** rather than 3.6 M. At the old ceiling a
    retina desktop window was being held to about 1.5× density rather than the 2×
    it asked for — a real cost on the one object in the frame.
  - **Softbox lighting.** The environment is built from rectangular panels rather
    than round blobs, because a rectangle is what a real light reflects as, and
    reading that shape back off a glossy shell is a good part of why a product
    shot looks like one. A narrow strip behind draws the silhouette, a small hard
    source adds a glint the softboxes are too diffuse to give, and a broad dim
    bounce off the floor keeps the undersides of the grips from crushing to black.
  - **Bloom**, at a high threshold and low strength, so only genuine highlights
    contribute and the product gains a sheen rather than a glow.

- **TSL** — the background node layers base charcoal, atmospheric falloff, the
  brush artwork, the product's radial glow, a transition light-sweep, a vignette
  and hash grain. The floor is a second TSL material: a soft pool, a thin
  elliptical contour, a wider bleed, and a separate occlusion pass that grounds
  the controller in the atmosphere.
- **Direct control** — the product can be turned by dragging it anywhere on the
  stage. A throw carries momentum (capped, so a flick coasts well under a
  quarter-turn rather than spinning), pitch is held to a shallow band and eases
  back level, and after a short pause the product drifts home to the nearest
  whole turn. The rotation composes with the idle drift and pointer parallax
  rather than replacing them, so letting go returns it to exactly the motion it
  had before — the hero composition restores itself without ever snapping back.
- **Transition** — one full revolution with the product swapped at the far side
  of it. The controller accelerates into a turn, and as it comes round edge-on —
  the fastest part of the arc, and the only moment its face is hidden — the next
  product takes over and decelerates the remaining half-turn into the hero pose.
  A shallow drift in depth goes with it, so the pivot happens in the space rather
  than on a flat plane.

  **Nothing cross-fades.** Every attempt to hand over by opacity dipped. Two
  products at different angles cannot overlap without ghosting, so their fades
  have to be sequential — and sequential fades leave the frames between them
  carrying almost nothing. Measured in the running page, the product's total
  presence fell to 0.21 across the handover and came back: the hero dimmed to a
  fifth and recovered, which is exactly what reads as a blink. Curves, offsets
  and non-zero entry points all moved the dip around without removing it,
  because the dip is inherent to the shape of the problem.

  Swapping outright removes it. Presence is a constant 1.0 on every frame of a
  change — one product, fully opaque, always — so there is no dip to read as a
  blink, no overlap to read as a ghost, and no partial transparency for the
  model to show its own insides through. `npm run verify` asserts it.

## Product photography

Six studio shots were supplied — a front and back pair for each of the three
controllers, all on a white sweep. `npm run photos` turns them into cut-outs the
dark interface can use, wired in through an optional `photography` field on the
product config: the front shot fills a campaign's variant card, the back shot
becomes its promotional artwork. Campaigns without photography fall back to
stills rendered from their own model, so the field stays additive.

**Keying them was the interesting part.** The obvious approach — measure how far
a pixel sits from the sweep's tone — does not survive these images. Four of the
six controllers are largely white on a near-white sweep, and the product's whites
do not sit to one side of the sweep, they *straddle* it: the palest part of a
Genshin grip reads 0.938 against a sweep of 0.934, while its shaded flank reads
0.87 and the contact shadow beneath reaches 0.88. Tone alone cannot separate
them, and every threshold either eats the product or keeps the background.

What separates them is the boundary. The sweep and its shadow vary by a value or
two per pixel; the silhouette drops twenty to thirty in one or two. So the
background is flood-filled inward from the frame edge through a Sobel edge map
used as a *barrier* — it flows freely across the sweep and down into the shadow,
and stops at the product's contour whatever tone lies on either side.

That needs two more refinements to hold:

- **Two barriers, not one.** Promote weak edges without limit and the silhouette
  is watertight — but the contact shadow's falloff is a long chain of weak
  gradient that *touches* the hard edge where a grip meets the surface, so the
  whole smear inherits barrier status and the fill can never reach it, leaving
  pale patches beside the grips. Cap the promotion and the shadow goes, but the
  silhouette springs a leak and the fill runs deep into the product, hollowing
  out anything near the sweep's tone — the Genshin touchpad, for one. So both are
  built. The sealed barrier defines the product; the open one says which pixels
  are shadow; and the open verdict is accepted only where it can be reached from
  the true exterior, and only in the lowest quarter of the frame. Contact shadow
  is a fact about the base, so that last constraint is the physics rather than a
  fudge — and it is what makes a touchpad in the upper half simply ineligible.
- **A base fade.** The very last of the shadow cannot be told from the product by
  tone at all: both it and the grip tips resting in it measure 0.73 to 0.74, and
  any threshold that removes one removes the other — or, set the other way, bites
  a notch out of the lit white above it. So neither is singled out; the base is
  ramped away over a short band, which costs a few rows of grip that were sitting
  in deep shadow anyway and reads as a product grounded on the surface.
- **A resolved edge.** What comes out of a flood fill and two rounds of
  four-connected dilation is a hard, stair-stepped, faintly diamond-shaped
  boundary — legible as a ragged outline once the cut-out sits on a dark card.
  Blurring the mask and re-thresholding it through a smoothstep rounds that off
  and leaves a genuinely anti-aliased edge. The cut is biased just inside the
  silhouette: land it outside and the edge pixels carry a little of the white
  sweep, which reads as a pale halo on a dark ground.

The photographs also served as a **colour reference for the render**. Comparing
the brightest third of the gold in each showed the scan rendering at hue 34.5°
and saturation 0.459 where the real finish sits at 37.6° and 0.406 — a little too
red and a little too saturated. `theme.finish` corrects both, normalised so
luminance is unchanged: brightness is the one thing not worth matching, because a
product on a white sweep is lit nothing like a product in a dark room.

## Model pipeline

The supplied scans are ~60 MB each — one 2M-triangle mesh with uncompressed
attributes and 4K JPEG maps. `npm run models` rebuilds the shipped assets:

| stage | effect |
| --- | --- |
| `weld` | merge coincident vertices |
| `resize` | base colour to 2560², normal to 2048², metallic/roughness to 1024² |
| `webp` | re-encode base colour, normal and metallic/roughness |
| `draco` | edgebreaker connectivity + attribute quantisation |

**Result: 60 MB → ~5 MB per model, with every triangle of the source kept.**

**On texture budget.** The source base colour is 8192² and holds real detail —
the pebble grain on the grips and the dot texture on the dark panels are legible
at 1:1 and gone entirely by 2048. 2560 recovers most of it and is about the right
density for the job: the visible face is roughly 40% of the atlas, so it lands
near 1600 texels across a product occupying about 1270 device pixels, which
anisotropic filtering then has something to work with. Higher costs real memory
for little return — an RGBA texture and its mips take 35 MB at 2560, 50 MB at
3072 and 90 MB at 4096. The normal map holds less than its 4096 source suggests
and the metallic/roughness map is nearly flat, so both are cut further.

**Why nothing is simplified.** These are dense photogrammetry-style scans whose
surface detail lives in the *mesh*, not in the normal map, and their vertex
normals do not survive decimation. An earlier build simplified to 10% and looked
clean in a thumbnail but broke apart at hero size — the touchpad, D-pad and face
buttons split into shading cracks. Disabling the normal map confirmed the damage
was geometric, not a tangent-frame problem, and it was still visible at 60%.
Draco makes the question moot: full 2M-triangle geometry compresses to **less**
than the 60%-simplified meshopt build did (5.0 MB vs 6.4 MB), so the fidelity
comes for free.

Quantisation is deliberately generous — 14-bit positions over a ~1 unit model is
well under a tenth of a millimetre. Decoding runs in workers via a vendored
decoder in `public/draco/`, so a 2M-triangle unpack never blocks the interface;
it costs roughly half a second per model, paid once at load.

The trade-off worth knowing: at hero size the product covers ~270k pixels and
carries 2M triangles, which is far denser than the screen can resolve. It is
comfortable on current hardware and it is what makes close-up rotation hold up,
but if you ever need to target low-end mobile, this is the first place to look.

## Performance

Measured on the production build, hardware-accelerated Chrome:

| | ready | fps | canvas |
| --- | --- | --- | --- |
| 1920 × 1080 @2× | ~1.7 s | 60 / 60 | 2529 × 1423 |
| 390 × 844 @3× | ~1.6 s | 60 / 60 | 682 × 1477 |

`perf.mjs` takes a control reading from an empty page first, because frame rate
under an automated browser is capped by the compositor and by whatever else the
machine is doing. The site matches that ceiling in both profiles; comparing the
raw number against a nominal 60 would be misleading.

- The WebGL layer is code-split: the first bundle is **36 KB gzip** and the
  loading composition paints from HTML and CSS alone; three.js (267 KB gzip)
  arrives behind it.
- Materials are made transparent once, at load, and never toggled. Blending
  state is baked into the render pipeline, so flipping `transparent` to fade a
  product would force a shader recompile at the exact moment a transition starts.
- **A fading product is drawn twice.** A blended solid has no idea it is solid:
  its triangles go down in buffer order, so a far surface can be laid first and a
  near one blended over it — and you see *into* the controller, its far shell and
  inner faces showing through as transparent patches. So while a product is
  fading, a depth-only pre-pass lays the silhouette in first with colour writes
  off, and the blended pass only tests against it. Only the frontmost surface
  survives, and the product dissolves as one skin.

  Three details are what make it work rather than make it worse:

  - **A product at zero opacity leaves the scene entirely**, rather than merely
    drawing as nothing. Its pre-pass is still a solid object as far as the depth
    buffer is concerned, so a controller waiting to enter would stamp its own
    silhouette into the buffer and punch that shape straight out of the one still
    on screen. This was the actual cause of the torn-looking model, and it is
    asserted every frame by `npm run verify`.
  - **The proxy is parented to the mesh at identity**, not placed beside it — the
    two passes have to agree on depth to the last bit, and sharing a transform
    outright is the only way to be sure.
  - **The pre-pass carries a small depth bias**, because two different shaders
    will not agree to the last bit anyway; without it the real surface loses the
    comparison in patches.

  The proxies are hidden while the product is opaque, where they would be pure
  cost; at 2× on a 2 M-triangle model the pass costs a couple of frames at the
  p95 (22 ms against 17 ms idle) and no stall. Both pipeline states are
  pre-compiled at load, since fading and settled are genuinely different
  pipelines.
- Each model is compiled against the live scene the moment it finishes loading
  (`compileAsync`), so its shader is built and its textures uploaded before it is
  ever shown — otherwise that cost lands on the frame it enters on, and the
  product appears untextured for a beat before snapping to its finish.

  **It is compiled parked far outside the frustum.** Compiling a material means
  putting the object in the scene, and the awaits around it let real frames
  render in between — so warming a model at the hero position *showed* it, twice
  on its way through the two depth states, once per campaign being prepared.
  That was a flicker on load and a double blink after a change. Off-camera it
  still compiles and paints nothing; frustum culling is switched off on the
  meshes so the compiler still finds them there. `npm run verify` asserts that
  exactly one product is ever painting into the frame.
- Device pixel ratio is capped at 2× on desktop, 1.75× on phones, and further
  clamped by a total-pixel budget so a large high-density window cannot blow past it.
- Rendering pauses when the tab is hidden.
- Only the campaign on show gates the reveal — the rail's artwork is
  photography, so it fills immediately without waiting on a model. The other two
  models are fetched in their own right once the browser is idle.
- **Not on a phone, though.** Every resident controller costs around 60 MB of
  texture memory; three of them is a fair trade on a desktop for instant
  switching, and most of the budget on a phone. Below 1024px — or on a device
  reporting 4 GB or less, or a metered connection — only the campaign on show is
  kept and the others load when chosen. Measured, that is 66 MB of heap on a
  phone profile against 173 MB on desktop.
- **Lighting intensities are per-campaign, because albedo is.** The gold shell is
  dark and takes a strong key; the two white shells reflect most of what reaches
  them and blow out on the same rig. On a shared rig a tenth of the God of War
  surface sat above 0.96 luma with no detail left in it — it is under 1% now.

---

## The variant rail

The rail shows the campaigns you are **not** looking at. The product on show is
already the hero, so a card for it would be redundant — with three campaigns
that means two cards, always. The one up next reads larger and nearer, the one
after it sits smaller and further back, which is where the composition gets its
sense of a catalogue continuing past the edge of the frame.

Cards keep their identity across a change and are tweened between fixed slots, so
switching campaigns shuffles the rail rather than rebuilding it. Slot geometry is
measured from a zero-height probe rather than read off `--card-w`: a custom
property holding a `clamp()` is returned verbatim by `getComputedStyle` and only
resolved where it is used, so reading it directly silently yields a fallback.

## Responsive behaviour

Desktop is the fixed reference stage. Below 1024px the page becomes a scrolling
column — the canvas stays fixed behind it, and the product **dissolves as content
scrolls up to meet it**, so copy never crosses the model while the atmosphere
remains. A change owns the product's opacity outright while it runs: writing it
from the scroll handler at the same time was enough to reveal a controller the
change meant to keep hidden, or hide one it had just brought in. The band the product is framed into is measured from the DOM and fed back
to the camera, so the model always lands exactly in the space the layout reserves.

- **Tablet** keeps the desktop closing row (promotional card beside the specs).
- **Phone** follows the brief's hierarchy: header → title → 3D → variants →
  carousel → description → CTA + price → specs → promotional card.
- Desktop's pill nav becomes a full-screen overlay driven by a menu button.
- Horizontal swipe changes product; a drag over the product itself turns it
  instead, and the variant rail scrolls natively on touch.

## Accessibility

Semantic buttons and anchors throughout, labelled controls, a `tablist` variant
carousel with roving focus, arrow-key navigation, `Escape` to close the menu,
visible focus rings, and a live region on the product copy. With
`prefers-reduced-motion: reduce` the transitions collapse to near-instant, idle
drift, pointer parallax and drag momentum stop, and the scroll dissolve is
disabled — the layout stays fully functional.

## Verification

`npm run verify` drives the running site with Playwright and checks: no horizontal
overflow at ten viewport sizes from 360 × 740 to 2560 × 1080, rapid clicking
settling to a consistent state with no overlapping transitions, keyboard
navigation, reduced motion, touch swipe, the mobile menu's open/close and ARIA
state, and frame rate and load time on a desktop and a phone profile.

It also walks the live scene graph frame by frame and asserts two invariants that
screenshots cannot see:

- **Depth.** No invisible product ever writes depth, and two products never write
  it at once — otherwise a controller waiting to enter punches its own silhouette
  out of the one on screen, on scattered frames.
- **Paint.** Exactly one product is ever painting into the frame, across the load
  and idle-preload window and after a change has settled — otherwise a model
  being compiled shows up where it should not.
- **Presence.** The product's total opacity never leaves 1.0 during a change —
  below it the hero dims and reads as a blink, above it two products are sharing
  the frame and ghosting.
- **Cold switching.** On a phone profile, where no campaign is preloaded, a
  change still swaps the product on screen and leaves exactly one painting — and
  a change made while scrolled past the hero is still there on scrolling back.

Both bugs leave no trace in a screenshot taken a frame either side of one, and a
sampled-screenshot pass gave the first a clean bill twice before this existed.
Set `BASE_URL` to point the suite at the production preview.

---

## Notes on the reproduction

- **The PlayStation mark** in the header and loader is an original "PS" monogram
  drawn in the spirit of the platform logo. The exact trademark artwork was not
  supplied, and it is not reproduced here.
- **The brush artwork** behind the product is generated (`npm run brush`), not
  supplied: `scripts/make-brush.mjs` samples cubic centre-lines, offsets them by a
  taper profile modulated with low-frequency noise, and roughens the edges with a
  turbulence displacement filter. It is tinted per campaign in the shader.
- **Promotional and thumbnail artwork** is rendered from the supplied models, for
  the same reason — no key art was provided, and no stock imagery is used.
- **Copy** is transcribed from the reference screenshots, with two spelling
  corrections ("tomorow" → "tomorrow", "teyvat" → "Teyvat").
