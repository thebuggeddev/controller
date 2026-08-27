/**
 * Model pipeline.
 *
 * The supplied controller scans are ~60 MB each: a single 2M-triangle mesh with
 * uncompressed attributes and 4K JPEG maps.
 *
 * The geometry is shipped **whole**. These are dense photogrammetry-style scans
 * whose surface detail lives in the mesh rather than in the normal map, and
 * their vertex normals do not survive decimation — simplifying them at all put
 * shading cracks across the touchpad, D-pad and face buttons. So instead of
 * throwing triangles away, every one is kept and Draco does the work:
 *
 *   weld      merge coincident vertices
 *   resize    textures to 2048² (metallic/roughness to 1024²)
 *   webp      re-encode base colour, normal and metallic/roughness
 *   draco     edgebreaker connectivity + attribute quantisation
 *
 * Quantisation is deliberately generous — 14-bit positions over a ~1 unit model
 * is well under a tenth of a millimetre, so nothing visible is lost.
 *
 * Run with:  npm run models
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODELS = [
  'first-light-controller',
  'genshin-impact-controller',
  'god-of-war-controller',
];

const CLI = join('node_modules', '.bin', 'gltf-transform');
const WORK = join(tmpdir(), 'controller-optimise');
const OUT = join('public', 'models');

mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

const run = (...args) => execFileSync(CLI, args, { stdio: ['ignore', 'ignore', 'inherit'] });
const mb = (file) => (statSync(file).size / 1048576).toFixed(2) + ' MB';

for (const name of MODELS) {
  const source = `${name}.glb`;
  if (!existsSync(source)) {
    console.warn(`skip ${source} — source model not present`);
    continue;
  }
  const step = (suffix) => join(WORK, `${name}.${suffix}.glb`);
  const target = join(OUT, `${name}.glb`);

  run('weld', source, step('weld'));
  // Texture budget, chosen per map rather than uniformly.
  //
  // The source base colour is 8192² and holds real detail — the pebble grain on
  // the grips and the dot texture on the dark panels are legible at 1:1 and gone
  // entirely by 2048. 2560 recovers most of it and is about the right density
  // for the job: the visible face is roughly 40% of the atlas, so it lands near
  // 1600 texels across a product that occupies about 1270 device pixels, which
  // anisotropic filtering then has something to work with. Higher costs real
  // memory for little return — an RGBA texture and its mips take 35 MB at 2560,
  // 50 MB at 3072 and 90 MB at 4096, and controllers stay resident so switching
  // is instant.
  //
  // The normal map holds less than its 4096 source suggests, and the
  // metallic/roughness map is nearly flat, so both are cut further.
  run('resize', step('weld'), step('resize'), '--width', '2560', '--height', '2560');
  run(
    'resize',
    step('resize'),
    step('resize-n'),
    '--width', '2048', '--height', '2048',
    '--pattern', '*normal*',
  );
  run(
    'resize',
    step('resize-n'),
    step('resize-mr'),
    '--width', '1024', '--height', '1024',
    '--pattern', '*_rm*',
  );
  run('webp', step('resize-mr'), step('webp'), '--quality', '92');
  run(
    'draco',
    step('webp'),
    target,
    '--method', 'edgebreaker',
    '--encode-speed', '0',
    '--decode-speed', '5',
    '--quantize-position', '14',
    '--quantize-normal', '10',
    '--quantize-texcoord', '12',
  );

  console.log(`${name}: ${mb(source)} → ${mb(target)}`);
}
