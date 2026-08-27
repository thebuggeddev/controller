import {
  Group,
  MathUtils,
  PerspectiveCamera,
  RenderTarget,
  SRGBColorSpace,
  Scene,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import type { Product } from '../data/products';
import { Lighting } from './Lighting';
import { HERO_YAW } from './ProductModel';
import type { ProductModel } from './ProductModel';

const SIZE = 512;

/** Camera yaw applied on top of the hero pose, per thumbnail pose. */
const POSES = {
  front: { yaw: 0.1, pitch: 9, fill: 0.74 },
  angled: { yaw: -0.55, pitch: 13, fill: 0.68 },
} as const;

export type ThumbnailPose = keyof typeof POSES;

/**
 * Renders the variant-card and promotional artwork straight from the real
 * product models, so no placeholder imagery ever ships. Captures happen once
 * per product/pose into an offscreen target and are cached as data URLs.
 */
export class ThumbnailStudio {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(24, 1, 0.05, 40);
  private readonly rig = new Group();
  private readonly lighting = new Lighting();
  private readonly target: RenderTarget;
  private readonly cache = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly renderer: WebGPURenderer,
    environment: Texture,
  ) {
    this.scene.environment = environment;
    this.scene.environmentIntensity = 1.1;
    this.scene.add(this.rig, this.lighting.group);
    this.target = new RenderTarget(SIZE, SIZE, { depthBuffer: true, samples: 4 });
    // Without this the target keeps linear-encoded pixels, which read far too
    // hot once they are dropped straight into an sRGB canvas.
    this.target.texture.colorSpace = SRGBColorSpace;
  }

  async capture(model: ProductModel, product: Product, pose: ThumbnailPose): Promise<string | null> {
    const key = `${product.id}:${pose}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    // Captures are serialised: they share one render target and temporarily
    // reparent the model, so they must never overlap.
    const run = this.queue.then(() => this.render(model, product, pose));
    this.queue = run.catch(() => undefined);
    const result = await run;
    if (result) this.cache.set(key, result);
    return result;
  }

  private async render(
    model: ProductModel,
    product: Product,
    pose: ThumbnailPose,
  ): Promise<string | null> {
    const { yaw, pitch, fill } = POSES[pose];

    // The still is rendered from a clone rather than from the live product.
    // `Object3D.clone` shares geometry and materials, so this costs nothing on
    // the GPU, but it means a capture can never reparent, re-pose or re-opacify
    // a controller that is on screen — which would otherwise corrupt a hero
    // reveal or a campaign change happening at the same moment.
    const stand_in = model.root.clone(true);
    stand_in.position.copy(model.centreOffset);

    try {
      this.lighting.apply(product.theme);
      // Slightly brighter, more frontal light than the hero rig: thumbnails are
      // small and need the silhouette to read instantly.
      this.lighting.key.intensity = product.theme.keyIntensity * 1.05;
      this.lighting.ambient.intensity = 0.75;
      this.scene.environmentIntensity = product.theme.envIntensity;

      this.rig.rotation.set(0, HERO_YAW + yaw, 0);
      this.rig.add(stand_in);

      const halfFov = MathUtils.degToRad(this.camera.fov) / 2;
      const distance = model.size.y / fill / 2 / Math.tan(halfFov);
      const el = MathUtils.degToRad(pitch);
      this.camera.position.set(0, Math.sin(el) * distance, Math.cos(el) * distance);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();

      const previousTarget = this.renderer.getRenderTarget();
      const previousAlpha = this.renderer.getClearAlpha();
      this.renderer.setRenderTarget(this.target);
      this.renderer.setClearAlpha(0);
      await this.renderer.clearAsync();
      await this.renderer.renderAsync(this.scene, this.camera);

      const pixels = (await this.renderer.readRenderTargetPixelsAsync(
        this.target,
        0,
        0,
        SIZE,
        SIZE,
      )) as Uint8Array;

      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setClearAlpha(previousAlpha);

      return toDataURL(pixels, SIZE);
    } catch {
      return null;
    } finally {
      this.rig.clear();
    }
  }

  dispose() {
    this.target.dispose();
    this.cache.clear();
  }
}

/** Turns the GPU read into a trimmed, encoded still. */
function toDataURL(pixels: Uint8Array, size: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const image = ctx.createImageData(size, size);
  image.data.set(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, size * size * 4));
  ctx.putImageData(image, 0, 0);

  // Trim to the product's bounding box so cards can scale it predictably.
  const bounds = opaqueBounds(image.data, size);
  if (!bounds) return canvas.toDataURL('image/webp', 0.92);

  const out = document.createElement('canvas');
  out.width = bounds.w;
  out.height = bounds.h;
  const outCtx = out.getContext('2d');
  if (!outCtx) return canvas.toDataURL('image/webp', 0.92);
  outCtx.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
  return out.toDataURL('image/webp', 0.92);
}

function opaqueBounds(data: Uint8ClampedArray, size: number) {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[(y * size + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return {
    x,
    y,
    w: Math.min(size - x, maxX - minX + pad * 2),
    h: Math.min(size - y, maxY - minY + pad * 2),
  };
}
