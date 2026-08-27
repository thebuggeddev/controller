import {
  ClampToEdgeWrapping,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  type Object3D,
  type Mesh,
  type MeshStandardMaterial,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* ---------------------------------------------------------------- models -- */

let loader: GLTFLoader | null = null;
let draco: DRACOLoader | null = null;

function getLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    // The shipped models keep every triangle of the source scans and lean on
    // Draco for size. Decoding runs in workers, off the main thread, so the
    // interface stays responsive while a 2M-triangle mesh is unpacked.
    draco = new DRACOLoader();
    draco.setDecoderPath('/draco/gltf/');
    draco.preload();
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

const modelCache = new Map<string, Promise<Object3D>>();

/**
 * Anisotropic filtering level applied to every product map.
 *
 * Worth more to perceived sharpness than any amount of extra resolution here: a
 * controller is curved almost everywhere, so most of its surface meets the
 * camera at a glancing angle, and trilinear filtering picks a blurrier mip for
 * all of it. Sixteen taps is the common ceiling and costs little on the one
 * object that matters.
 */
const ANISOTROPY = 16;

export interface LoadOptions {
  onProgress?: (ratio: number) => void;
  /** Clamped against the renderer's capability by the caller. */
  anisotropy?: number;
}

/** Loads (and caches) a controller model. Repeat calls share one network fetch. */
export function loadModel(url: string, options: LoadOptions = {}): Promise<Object3D> {
  const cached = modelCache.get(url);
  if (cached) return cached;

  const promise = new Promise<Object3D>((resolve, reject) => {
    getLoader().load(
      url,
      (gltf) => resolve(prepare(gltf.scene, options.anisotropy ?? ANISOTROPY)),
      (event) => {
        if (options.onProgress && event.total) options.onProgress(event.loaded / event.total);
      },
      reject,
    );
  });

  modelCache.set(url, promise);
  return promise;
}

/**
 * Normalises a freshly loaded controller: the source models are photogrammetry
 * exports with the product resting on the ground plane and centred in X/Z, so
 * the work here is limited to material fidelity rather than re-authoring.
 */
function prepare(root: Object3D, anisotropy: number): Object3D {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;

    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // The product is the whole point of the frame whenever it is in the scene,
    // and models that are not on show are removed from it outright — so culling
    // buys nothing, and switching it off lets the pipeline warm-up park a model
    // off-camera without it dropping out of the compiler's render list.
    mesh.frustumCulled = false;

    const material = mesh.material as MeshStandardMaterial;
    if (!material) return;

    // The scanned metallic/roughness maps read a touch flat under studio light;
    // a small nudge restores the crisp plastic/metal separation of the product
    // photography without discarding the authored maps.
    for (const map of [
      material.map,
      material.normalMap,
      material.roughnessMap,
      material.metalnessMap,
    ]) {
      if (!map) continue;
      map.anisotropy = anisotropy;
      map.needsUpdate = true;
    }

    material.envMapIntensity = 1;
    material.roughness = Math.min(1, material.roughness ?? 1);
    material.metalness = material.metalness ?? 1;
    material.normalScale?.set(1.15, 1.15);

    // Transparency is enabled once, up front, and never toggled again.
    // Blending state is baked into the render pipeline, so flipping it to fade
    // a product in or out would force a shader recompile at exactly the moment
    // the transition starts — the stall that showed up as a flicker. Depth
    // writing stays on throughout so a half-faded controller still occludes
    // itself instead of turning inside out.
    material.transparent = true;
    material.depthWrite = true;
    material.opacity = 1;
    material.needsUpdate = true;
  });
  return root;
}

/* ------------------------------------------------------------ environment -- */

/**
 * Builds a procedural studio environment as an equirectangular HDR texture.
 *
 * Two large rectangular softboxes rather than round blobs: a rectangle is what a
 * real light panel reflects as, and reading that shape back off a glossy shell
 * is a good part of why a product shot looks like one. A narrow strip behind
 * draws the silhouette, a small crisp source adds a specular glint the softboxes
 * are too diffuse to give, and the floor stays dark so the form is described by
 * reflection rather than by ambient wash.
 *
 * Cheaper and far more controllable than shipping an HDR file.
 */
export function createStudioEnvironment(width = 512): DataTexture {
  const height = width / 2;
  const data = new Float32Array(width * height * 4);

  /** Rectangular panel with a soft edge, in equirectangular angles. */
  const panel = (
    dPhi: number,
    dEl: number,
    halfWidth: number,
    halfHeight: number,
    softness: number,
  ) => {
    const x = 1 - smoothstep(halfWidth - softness, halfWidth, Math.abs(dPhi));
    const y = 1 - smoothstep(halfHeight - softness, halfHeight, Math.abs(dEl));
    return x * y;
  };

  const lobes: {
    azimuth: number;
    elevation: number;
    halfWidth: number;
    halfHeight: number;
    softness: number;
    colour: [number, number, number];
  }[] = [
    // Key softbox, high and to the left — the light that shapes the product.
    // Neutral rather than warm: the finishes here are already strongly coloured
    // and a warm key pushes the gold past where the real product sits.
    { azimuth: -0.9, elevation: 0.85, halfWidth: 0.62, halfHeight: 0.5, softness: 0.42,
      colour: [5.5, 5.45, 5.35] },
    // Cool fill on the right — wide, soft and a real presence rather than a
    // token one. It is what keeps the shadow side from going dead, and its
    // coolness is what stops a saturated finish reading as a single flat hue.
    { azimuth: 1.35, elevation: 0.28, halfWidth: 1.05, halfHeight: 0.72, softness: 0.75,
      colour: [1.15, 1.4, 1.85] },
    // Narrow strip behind, which is what draws the silhouette.
    { azimuth: Math.PI, elevation: 0.16, halfWidth: 1.15, halfHeight: 0.11, softness: 0.16,
      colour: [3.1, 3.0, 2.85] },
    // Small hard source for a specular glint the softboxes cannot give.
    { azimuth: -0.35, elevation: 1.15, halfWidth: 0.1, halfHeight: 0.08, softness: 0.05,
      colour: [11, 10.6, 10 ] },
    // Broad, dim bounce off the floor. Without it every downward-facing surface
    // has nothing to reflect and the undersides of the grips crush to black,
    // which reads as the product fading out at the bottom rather than sitting
    // on something.
    { azimuth: 0, elevation: -1.05, halfWidth: 3.2, halfHeight: 0.62, softness: 0.55,
      colour: [0.42, 0.41, 0.4] },
  ];

  for (let y = 0; y < height; y++) {
    const theta = (y / (height - 1)) * Math.PI;
    const elevation = Math.PI / 2 - theta;
    for (let x = 0; x < width; x++) {
      const phi = (x / width) * Math.PI * 2 - Math.PI;

      // Base: a near-black floor rising to faint charcoal overhead.
      const up = Math.max(0, Math.sin(elevation));
      let r = 0.014 + up * 0.07;
      let g = 0.015 + up * 0.072;
      let b = 0.018 + up * 0.085;

      // A slightly brighter horizon keeps edge highlights alive.
      const horizon = Math.exp(-Math.pow(elevation / 0.26, 2)) * 0.045;
      r += horizon;
      g += horizon;
      b += horizon * 1.12;

      for (const lobe of lobes) {
        let dPhi = phi - lobe.azimuth;
        while (dPhi > Math.PI) dPhi -= Math.PI * 2;
        while (dPhi < -Math.PI) dPhi += Math.PI * 2;
        const amount = panel(
          dPhi,
          elevation - lobe.elevation,
          lobe.halfWidth,
          lobe.halfHeight,
          lobe.softness,
        );
        if (amount <= 0) continue;
        r += lobe.colour[0] * amount;
        g += lobe.colour[1] * amount;
        b += lobe.colour[2] * amount;
      }

      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 1;
    }
  }

  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1)));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ brush -- */

/**
 * Rasterises the brush-stroke artwork into a texture. The SVG carries a
 * turbulence filter for bristle edges, so it is drawn through an <img> to let
 * the browser resolve the filter rather than approximating it in a shader.
 */
export async function loadBrushTexture(url: string, width = 1536): Promise<Texture> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();

  const height = Math.round((width * image.naturalHeight) / image.naturalWidth) || width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(image, 0, 0, width, height);

  const texture = new Texture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
