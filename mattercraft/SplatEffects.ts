import { ContextManager, Observable, useOnBeforeRender } from "@zcomponent/core";
import { Group } from "@zcomponent/three/lib/components/Group";
import { useCamera } from "@zcomponent/three/lib/scenecontext";
import type { GsplatModifier } from "@sparkjsdev/spark";
import * as THREE from "three";
import { buildEffectModifier, type EnabledEffects } from "./splatEffectGraph";
import {
  DEFAULT_EFFECT_SETTINGS as D,
  applyCamera,
  applySettings,
  createUniforms,
  type EffectSettings,
} from "./splatEffectUniforms";

interface ConstructorProps {}

/**
 * The parts of Spark's SplatMesh this component touches. `objectModifier` is
 * the one hook shared by Spark 0.1 (a plain field) and Spark 2 (a setter that
 * replaces the modifier list); the splat package sets neither.
 */
interface SplatMeshLike extends THREE.Object3D {
  isInitialized: boolean;
  objectModifier?: GsplatModifier;
  updateGenerator(): void;
  updateVersion(): void;
}

// Frames to keep looking for the splat mesh before reporting a setup error.
// The GaussianSplat node creates its mesh immediately but loads it later.
const SEARCH_FRAMES = 600;

// How many levels up to also search sideways. Releases up to 1.0.0-alpha.4
// put child nodes beside the mesh rather than under it; searching further up
// could pick up a different capture's mesh.
const SIBLING_SEARCH_LEVELS = 2;

/**
 * Dreamlike per-splat effects for a GaussianSplat node: bright bands sweeping
 * through the scene that swell splats at their front and shrink them behind,
 * and a soft translucent periphery around the centre of view. Each effect only
 * changes splat sizes, colours and opacities.
 *
 * Add this as a child of the GaussianSplat node. It injects a Spark object
 * modifier into that node's internal splat mesh, so it depends on how the
 * splat package arranges its three.js objects; releases 1.0.0-alpha.1 to .5
 * are covered.
 *
 * @zcomponent
 * @zicon auto_awesome
 */
export class SplatEffects extends Group {
  /**
   * @zui
   * @zdefault true
   * @zgroup Sweep band
   * @zgrouppriority 30
   */
  public bandEnabled = new Observable(true);
  /**
   * Distance where bands launch, in the capture's own units. Must be above 0.
   * @zui
   * @zdefault 12
   * @zgroup Sweep band
   * @zgrouppriority 30
   */
  public bandNear = new Observable(D.bandNear);
  /**
   * Distance where bands fade out, in the capture's own units.
   * @zui
   * @zdefault 150
   * @zgroup Sweep band
   * @zgrouppriority 30
   */
  public bandFar = new Observable(D.bandFar);
  /**
   * Seconds between one band launching and the next. Several bands can be
   * under way at once.
   * @zui
   * @zdefault 4
   * @zgroup Sweep band
   * @zgrouppriority 30
   */
  public bandPeriod = new Observable(D.bandPeriod);
  /**
   * Share of the near-to-far course a band covers per second; 0.05 crosses
   * in 20 seconds.
   * @zui
   * @zdefault 0.05
   * @zgroup Sweep band
   * @zgrouppriority 30
   */
  public bandSpeed = new Observable(D.bandSpeed);
  /**
   * Depth of the band's front (its far, leading side) as a fraction of
   * distance; 0.2 is about 22%.
   * @zui
   * @zdefault 0.2
   * @zgroup Sweep band
   * @zgrouppriority 30
   */
  public bandFrontWidth = new Observable(D.bandFrontWidth);
  /**
   * Extra splat size at the peak of the front; 1 doubles it.
   * @zui
   * @zdefault 1.75
   * @zgroup Sweep band
   * @zgrouppriority 30
   */
  public bandFrontGrow = new Observable(D.bandFrontGrow);
  /**
   * Depth of the band's back (its near, trailing side) as a fraction of
   * distance; 0.2 is about 22%.
   * @zui
   * @zdefault 0.2
   * @zgroup Sweep band
   * @zgrouppriority 30
   */
  public bandBackWidth = new Observable(D.bandBackWidth);
  /**
   * Share of splat size lost at the deepest point of the back; 1 shrinks
   * splats to nothing.
   * @zui
   * @zdefault 0.12
   * @ztype proportion
   * @zgroup Sweep band
   * @zgrouppriority 30
   */
  public bandBackShrink = new Observable(D.bandBackShrink);
  /**
   * Extra brightness across the band, strongest at its centre.
   * @zui
   * @zdefault 0.5
   * @zgroup Sweep band
   * @zgrouppriority 30
   */
  public bandBrightness = new Observable(D.bandBrightness);

  /**
   * @zui
   * @zdefault true
   * @zgroup Soft periphery
   * @zgrouppriority 29
   */
  public peripheryEnabled = new Observable(true);
  /**
   * Angle from the centre of view kept fully sharp.
   * @zui
   * @zdefault 5
   * @zgroup Soft periphery
   * @zgrouppriority 29
   */
  public peripherySharpDegrees = new Observable(D.peripherySharpDegrees);
  /**
   * Angle at which the effect reaches full strength.
   * @zui
   * @zdefault 22
   * @zgroup Soft periphery
   * @zgrouppriority 29
   */
  public peripherySoftDegrees = new Observable(D.peripherySoftDegrees);
  /**
   * Extra splat size at full strength; 1 doubles it.
   * @zui
   * @zdefault 0.2
   * @zgroup Soft periphery
   * @zgrouppriority 29
   */
  public peripheryGrow = new Observable(D.peripheryGrow);
  /**
   * Opacity multiplier at full strength.
   * @zui
   * @zdefault 0.5
   * @ztype proportion
   * @zgroup Soft periphery
   * @zgrouppriority 29
   */
  public peripheryOpacity = new Observable(D.peripheryOpacity);

  private readonly uniforms = createUniforms();
  private mesh: SplatMeshLike | null = null;
  private modifier: GsplatModifier | null = null;
  private framesSearched = 0;
  private failed = false;
  private elapsed = 0;

  constructor(contextManager: ContextManager, constructorProps: ConstructorProps) {
    super(contextManager, constructorProps);

    const rebuild = (_enabled: boolean) => this.install();
    this.register(this.bandEnabled, rebuild);
    this.register(this.peripheryEnabled, rebuild);

    const camera = useCamera(contextManager);
    this.register(useOnBeforeRender(contextManager), (dt: number) => this.frame(dt, camera.value));
  }

  private frame(dt: number, camera: THREE.Camera | undefined) {
    if (this.failed) return;
    if (!this.mesh) {
      this.mesh = this.findMesh();
      if (!this.mesh) return;
    }
    if (!this.mesh.isInitialized) return;
    if (!this.modifier) this.install();
    if (!this.modifier || !camera) return;

    this.elapsed += dt / 1000;
    applySettings(this.uniforms, this.settings(), this.elapsed);
    applyCamera(this.uniforms, this.mesh, camera);
    this.mesh.updateVersion();
  }

  private findMesh(): SplatMeshLike | null {
    let level = 0;
    for (let node = this.element.parent; node; node = node.parent, level += 1) {
      if (isSplatMesh(node)) return node;
      if (level < SIBLING_SEARCH_LEVELS) {
        const sibling = node.children.find(isSplatMesh);
        if (sibling) return sibling;
      }
    }
    this.framesSearched += 1;
    if (this.framesSearched >= SEARCH_FRAMES) {
      this.failed = true;
      console.error("SplatEffects: no splat mesh found above this node. Add it as a child of a GaussianSplat node.");
    }
    return null;
  }

  /** Compiles the program for the enabled effects and puts it on the mesh. */
  private install() {
    const mesh = this.mesh;
    if (!mesh?.isInitialized || this.failed) return;

    const next = buildEffectModifier(this.uniforms, this.enabledEffects());
    try {
      mesh.objectModifier = next;
      mesh.updateGenerator();
      this.modifier = next;
    } catch (err) {
      this.failed = true;
      this.modifier = null;
      mesh.objectModifier = undefined;
      mesh.updateGenerator();
      console.error("SplatEffects: Spark rejected the effect program.", err);
    }
  }

  private enabledEffects(): EnabledEffects {
    return {
      band: this.bandEnabled.value,
      periphery: this.peripheryEnabled.value,
    };
  }

  private settings(): EffectSettings {
    return {
      bandNear: this.bandNear.value,
      bandFar: this.bandFar.value,
      bandPeriod: this.bandPeriod.value,
      bandSpeed: this.bandSpeed.value,
      bandFrontWidth: this.bandFrontWidth.value,
      bandFrontGrow: this.bandFrontGrow.value,
      bandBackWidth: this.bandBackWidth.value,
      bandBackShrink: this.bandBackShrink.value,
      bandBrightness: this.bandBrightness.value,
      peripherySharpDegrees: this.peripherySharpDegrees.value,
      peripherySoftDegrees: this.peripherySoftDegrees.value,
      peripheryGrow: this.peripheryGrow.value,
      peripheryOpacity: this.peripheryOpacity.value,
    };
  }

  public dispose() {
    const mesh = this.mesh;
    if (mesh && this.modifier) {
      mesh.objectModifier = undefined;
      if (mesh.isInitialized) mesh.updateGenerator();
    }
    return super.dispose();
  }
}

// Duck-typed rather than `instanceof SplatMesh`: the splat package may bundle
// its own copy of Spark, and a class check against ours would then fail.
function isSplatMesh(node: THREE.Object3D): node is SplatMeshLike {
  const candidate = node as Partial<SplatMeshLike>;
  return (
    "isInitialized" in candidate &&
    typeof candidate.updateGenerator === "function" &&
    typeof candidate.updateVersion === "function"
  );
}
