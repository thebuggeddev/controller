import {
  Box3,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicNodeMaterial,
  Vector3,
  type MeshStandardMaterial,
  type Object3D,
} from 'three/webgpu';

/**
 * Depth-only material used for the pre-pass. Shared by every proxy: it writes
 * nothing but depth, so one instance serves all of them.
 */
const DEPTH_ONLY = new MeshBasicNodeMaterial();
DEPTH_ONLY.colorWrite = false;
DEPTH_ONLY.depthWrite = true;
DEPTH_ONLY.depthTest = true;
DEPTH_ONLY.transparent = false;
// Nudge the pre-pass fractionally further from the camera. Two different
// shaders will not agree on depth to the last bit, and without a bias the real
// surface loses the comparison in patches — which reads as chunks torn out of
// the product.
DEPTH_ONLY.polygonOffset = true;
DEPTH_ONLY.polygonOffsetFactor = 1;
DEPTH_ONLY.polygonOffsetUnits = 4;

/**
 * Camera-facing rotation for the hero pose.
 *
 * The supplied models are authored with the controller's face along +Z, so the
 * product already presents its front to a camera on that axis.
 */
export const HERO_YAW = 0;
export const HERO_YAW_OFFSET = 0;

/**
 * A single controller in the scene.
 *
 * `group` is what the transition animates — it pivots around the product's own
 * optical centre, while `inner` keeps the model resting on the floor plane.
 */
export class ProductModel {
  readonly group = new Group();
  private readonly inner = new Group();
  private readonly materials: MeshStandardMaterial[] = [];
  /**
   * Depth-only stand-ins, one per mesh, shown only while the product is fading.
   *
   * A blended solid has no idea it is solid: its triangles are drawn in whatever
   * order they sit in the buffer, so a far surface can be laid down first and a
   * near one blended over the top of it. The result is that you see *into* the
   * controller — its far shell and inner faces showing through the near shell as
   * transparent patches. Laying the silhouette into the depth buffer first, with
   * colour writes off, means only the frontmost surface survives the depth test
   * when the real pass runs, and the product dissolves as one skin.
   *
   * They stay hidden while the product is opaque, where they would be pure cost.
   */
  private readonly depthProxies: Mesh[] = [];

  /** Height of the product's optical centre above the floor. */
  readonly centreY: number;
  /** Translation that puts the product's optical centre on the origin. */
  readonly centreOffset = new Vector3();
  /** Overall width of the product, used to frame the camera. */
  readonly size = new Vector3();

  constructor(readonly root: Object3D) {
    const box = new Box3().setFromObject(root);
    box.getSize(this.size);
    const centre = box.getCenter(new Vector3());
    this.centreY = centre.y;

    // Re-pivot: the group sits at the optical centre, the model is pushed back
    // down so its base still meets y = 0.
    this.centreOffset.set(-centre.x, -centre.y, -centre.z);
    this.inner.position.copy(this.centreOffset);
    this.inner.add(root);

    this.group.position.set(0, centre.y, 0);
    this.group.rotation.y = HERO_YAW + HERO_YAW_OFFSET;
    this.group.add(this.inner);

    const proxied: { mesh: Mesh }[] = [];
    root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as MeshStandardMaterial;
      if (!material) return;
      this.materials.push(material);
      proxied.push({ mesh });
    });

    for (const { mesh } of proxied) {
      const proxy = new Mesh(mesh.geometry, DEPTH_ONLY);
      proxy.name = `${mesh.name || 'mesh'}__depth`;
      proxy.visible = false;
      // Ahead of the real mesh, and opaque, so the depth buffer is already
      // filled by the time the blended pass runs.
      proxy.renderOrder = -1;
      // Parented to the mesh at identity rather than placed beside it: the two
      // passes must agree on depth to the last bit, and sharing a transform
      // outright is the only way to be sure of that.
      mesh.add(proxy);
      this.depthProxies.push(proxy);
    }
  }

  /** Rest pose the transition animates back to. */
  resetPose() {
    this.group.rotation.set(0, HERO_YAW + HERO_YAW_OFFSET, 0);
    this.group.position.set(0, this.centreY, 0);
    this.group.scale.setScalar(1);
  }

  setEnvIntensity(value: number) {
    for (const material of this.materials) material.envMapIntensity = value;
  }

  /**
   * Applies a linear multiplier to the base colour. Used to bring a scanned
   * finish in line with the product's real photography.
   */
  setFinish(finish?: [number, number, number]) {
    for (const material of this.materials) {
      if (finish) material.color.setRGB(finish[0], finish[1], finish[2], LinearSRGBColorSpace);
      else material.color.setRGB(1, 1, 1, LinearSRGBColorSpace);
    }
  }

  /**
   * Fades the product.
   *
   * The materials are transparent from the start and stay that way, so opacity
   * itself is only a uniform update. What does change is who owns the depth
   * buffer: while fading, the pre-pass writes it and the blended pass merely
   * tests against it, which is what stops the product showing its own insides.
   *
   * A product at zero opacity is taken out of the scene entirely rather than
   * merely drawn as nothing. Its depth pre-pass is still a solid object as far
   * as the depth buffer is concerned, and an invisible controller waiting to
   * enter would otherwise stamp its own silhouette into the buffer and punch
   * that shape straight out of the one still on screen.
   */
  setOpacity(value: number) {
    const visible = value > 0.001;
    this.group.visible = visible;
    for (const material of this.materials) material.opacity = value;
    this.setDepthMode(value < 0.999 && visible);
  }

  /**
   * Chooses which pass owns the depth buffer, independently of opacity.
   *
   * Opacity normally implies the answer, but the two are separable and the
   * pipeline warm-up needs them apart: it has to compile both depth states
   * without ever making the product visible.
   */
  setDepthMode(fading: boolean) {
    for (const material of this.materials) material.depthWrite = !fading;
    for (const proxy of this.depthProxies) proxy.visible = fading && this.group.visible;
  }

  /** Returns the product to full opacity once a fade has finished. */
  settle() {
    this.setOpacity(1);
  }

  dispose() {
    this.root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
    });
    for (const proxy of this.depthProxies) proxy.removeFromParent();
    this.depthProxies.length = 0;
    for (const material of this.materials) {
      material.map?.dispose();
      material.normalMap?.dispose();
      material.roughnessMap?.dispose();
      material.metalnessMap?.dispose();
      material.dispose();
    }
    this.group.removeFromParent();
  }
}
