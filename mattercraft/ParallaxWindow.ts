import { ContextManager, Observable, isDesignTime, useOnBeforeRender } from "@zcomponent/core";
import { Group } from "@zcomponent/three/lib/components/Group";
import { PointerPresentEvent, useOnPointerClickMissed } from "@zcomponent/three/lib/pointercontext";
import { useCamera } from "@zcomponent/three/lib/scenecontext";
import * as THREE from "three";

// Metres. Large enough that the matte fills the view from any angle.
const MATTE_EXTENT = 30;
const FRAME_COLOR = 0xffffff;

const PROMPT_FOLLOWING = "Tap to place the window";
const PROMPT_PLACED = "Tap again to move it";
const PROMPT_PLACED_MS = 2500;

interface ConstructorProps {}

/**
 * A window floating in the room that looks onto a Gaussian splat scene.
 *
 * This node stands for the viewer's eye at the moment of placement: the
 * aperture sits `windowDistance` in front of it, and the scene nested under it
 * is positioned in the same frame (eye at the origin, looking down -Z), so the
 * values tuned in the desktop preview carry over unchanged.
 *
 * Until the user taps, the node follows the camera, so the window hangs in
 * front of them. A tap fixes it in the room; another tap picks it up again.
 * The heading is kept level so the window never tilts with the phone.
 *
 * An invisible matte around the aperture writes depth but no colour. The camera
 * feed shows through it, while any splat outside the aperture fails the depth
 * test. That only works because every splat sits behind the window plane.
 *
 * Put this node inside the WorldTracker's GroundAnchorGroup, not inside a
 * WorldPlacementGroup, which would fight over the transform. Leave this node's
 * own position and rotation at zero: they are overwritten at runtime.
 *
 * @zcomponent
 * @zicon window
 */
export class ParallaxWindow extends Group {
  /**
   * Aperture width in metres.
   * @zui
   * @zdefault 0.4
   * @zgroup Window
   * @zgrouppriority 20
   */
  public windowWidth = new Observable(0.4);

  /**
   * Aperture height in metres.
   * @zui
   * @zdefault 0.4
   * @zgroup Window
   * @zgrouppriority 20
   */
  public windowHeight = new Observable(0.4);

  /**
   * How far in front of the viewer the window hangs, in metres.
   * @zui
   * @zdefault 1.28
   * @zgroup Window
   * @zgrouppriority 20
   */
  public windowDistance = new Observable(1.28);

  /**
   * Draw a thin border around the aperture on the phone. The border is always
   * drawn in the editor.
   * @zui
   * @zdefault false
   * @zgroup Window
   * @zgrouppriority 20
   */
  public showFrame = new Observable(false);

  private readonly designTime: boolean;
  private readonly matte: THREE.Mesh;
  private readonly frame: THREE.LineLoop;
  private readonly prompt: HTMLDivElement | null;
  private following = true;
  private promptTimer: number | undefined;

  constructor(contextManager: ContextManager, constructorProps: ConstructorProps) {
    super(contextManager, constructorProps);

    this.designTime = isDesignTime(contextManager);
    this.matte = createMatte();
    this.frame = createFrame();
    this.prompt = this.designTime ? null : createPrompt();

    // In the editor the matte would black out the viewport; the border shows
    // where the aperture is instead.
    this.matte.visible = !this.designTime;
    this.element.add(this.matte, this.frame);

    const rebuild = () => this.rebuildAperture();
    this.register(this.windowWidth, rebuild);
    this.register(this.windowHeight, rebuild);
    this.register(this.windowDistance, rebuild);
    this.register(this.showFrame, () => this.applyFrameVisibility());
    rebuild();
    this.applyFrameVisibility();

    if (this.designTime) return;

    const camera = useCamera(contextManager);
    // Handlers must declare the event's arguments, or `register` fails to type.
    this.register(useOnBeforeRender(contextManager), (_dt: number) => {
      if (this.following) this.moveToCamera(camera.value);
    });
    this.register(useOnPointerClickMissed(contextManager), (_event: PointerPresentEvent) => this.toggleFollowing());
    this.setPrompt(PROMPT_FOLLOWING);
  }

  private rebuildAperture() {
    const width = this.windowWidth.value;
    const height = this.windowHeight.value;
    const distance = this.windowDistance.value;
    if (!(width > 0 && height > 0 && distance > 0)) {
      console.error(`ParallaxWindow: size and distance must be positive, got ${width}x${height} at ${distance}`);
      return;
    }

    this.matte.geometry.dispose();
    this.matte.geometry = matteGeometry(width, height);
    this.matte.position.set(0, 0, -distance);

    this.frame.geometry.dispose();
    this.frame.geometry = frameGeometry(width, height);
    this.frame.position.set(0, 0, -distance);
  }

  private applyFrameVisibility() {
    this.frame.visible = this.designTime || this.showFrame.value;
  }

  /** Puts this node at the camera, level, in its parent's coordinate frame. */
  private moveToCamera(camera: THREE.Camera | undefined) {
    const parent = this.element.parent;
    if (!camera || !parent) return;

    parent.updateWorldMatrix(true, false);
    camera.updateWorldMatrix(true, false);
    const relative = parent.matrixWorld.clone().invert().multiply(camera.matrixWorld);

    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    relative.decompose(position, rotation, new THREE.Vector3());

    this.element.position.copy(position);
    this.element.quaternion.copy(levelHeading(rotation));
  }

  private toggleFollowing() {
    this.following = !this.following;
    this.setPrompt(this.following ? PROMPT_FOLLOWING : PROMPT_PLACED);
    window.clearTimeout(this.promptTimer);
    if (!this.following) {
      this.promptTimer = window.setTimeout(() => this.setPrompt(""), PROMPT_PLACED_MS);
    }
  }

  private setPrompt(text: string) {
    if (!this.prompt) return;
    this.prompt.textContent = text;
    this.prompt.style.display = text ? "block" : "none";
  }

  public dispose() {
    window.clearTimeout(this.promptTimer);
    this.prompt?.remove();
    this.matte.geometry.dispose();
    (this.matte.material as THREE.Material).dispose();
    this.frame.geometry.dispose();
    (this.frame.material as THREE.Material).dispose();
    return super.dispose();
  }
}

/**
 * The camera's rotation reduced to a heading about the vertical axis. Looking
 * straight up or down leaves no heading, so that falls back to -Z.
 */
function levelHeading(rotation: THREE.Quaternion): THREE.Quaternion {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation);
  const flat = new THREE.Vector3(forward.x, 0, forward.z);
  const heading = flat.lengthSq() < 1e-8 ? new THREE.Vector3(0, 0, -1) : flat.normalize();
  const yaw = Math.atan2(-heading.x, -heading.z);
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
}

function createMatte(): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  // Depth must be in place before any splat is drawn.
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

function matteGeometry(width: number, height: number): THREE.ShapeGeometry {
  const outer = new THREE.Shape();
  outer.moveTo(-MATTE_EXTENT, -MATTE_EXTENT);
  outer.lineTo(MATTE_EXTENT, -MATTE_EXTENT);
  outer.lineTo(MATTE_EXTENT, MATTE_EXTENT);
  outer.lineTo(-MATTE_EXTENT, MATTE_EXTENT);
  outer.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-width / 2, -height / 2);
  hole.lineTo(-width / 2, height / 2);
  hole.lineTo(width / 2, height / 2);
  hole.lineTo(width / 2, -height / 2);
  hole.closePath();
  outer.holes.push(hole);

  return new THREE.ShapeGeometry(outer);
}

function createFrame(): THREE.LineLoop {
  return new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: FRAME_COLOR }));
}

function frameGeometry(width: number, height: number): THREE.BufferGeometry {
  const x = width / 2;
  const y = height / 2;
  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-x, -y, 0),
    new THREE.Vector3(x, -y, 0),
    new THREE.Vector3(x, y, 0),
    new THREE.Vector3(-x, y, 0),
  ]);
}

function createPrompt(): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed",
    left: "50%",
    bottom: "calc(env(safe-area-inset-bottom) + 32px)",
    transform: "translateX(-50%)",
    padding: "10px 16px",
    borderRadius: "10px",
    background: "rgba(0, 0, 0, 0.6)",
    color: "#fff",
    font: "14px -apple-system, system-ui, sans-serif",
    pointerEvents: "none",
    zIndex: "1000",
  });
  document.body.appendChild(el);
  return el;
}
