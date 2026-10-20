import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { SESSION_FEATURES, floorHeight, framebufferScale, pickReferenceSpace, trackingFromPose } from "./webxr-session.js";

const NEAR = 0.05;
const FAR = 5000; // Same range as the 8th Wall bridge; see xr-bridge.js.

/**
 * Drives our three.js scene from a WebXR `immersive-ar` session: ARKit inside
 * an iOS App Clip that adds WebXR (such as Needle Go), or ARCore in Chrome on
 * Android. It offers the same callbacks as `createThreeBridge` in
 * xr-bridge.js, plus `onEnd` when the session closes.
 *
 * The renderer exists before the session so that preparation can finish
 * first: while a session presents, three.js swaps in the XR camera for every
 * render, including warm-up renders to offscreen targets.
 *
 * The host draws the camera image behind the canvas, so frames clear to
 * transparent instead of drawing over a camera feed.
 */
export function createWebXrBridge({
  canvas,
  overlay = null,
  dpr = 1,
  onReady,
  onTracking,
  onBeforeRender = () => {},
  onRendered = () => {},
  onView = () => {},
  onEnd = () => {},
  onError = console.error,
}) {
  // xrCompatible up front avoids three.js calling makeXRCompatible, which can
  // restore the context on some GPUs.
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, xrCompatible: true });
  if (!gl) throw new Error("WebGL 2 is not available in this browser");
  // antialias off: MSAA is pure cost for splats (see Spark perf guide).
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.xr.enabled = true;

  const scene = new THREE.Scene();
  const spark = new SparkRenderer({ renderer, covSplats: true, accumExtSplats: true, sortRadial: true });
  scene.add(spark);
  const camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height || 1, NEAR, FAR);
  scene.add(camera);

  const bufferSize = new THREE.Vector2();
  const state = {
    ready: false,
    session: null,
    referenceSpace: "",
    floorSource: null,
    floorY: null,
    status: "",
    reason: "",
    view: "",
  };

  Promise.resolve().then(() => onReady({ renderer, spark, scene, camera }))
    .then(() => { state.ready = true; }).catch(onError);

  const reportTracking = (pose) => {
    const { trackingStatus, trackingReason } = trackingFromPose(pose);
    if (trackingStatus === state.status && trackingReason === state.reason) return;
    state.status = trackingStatus;
    state.reason = trackingReason;
    onTracking({ status: trackingStatus, reason: trackingReason });
  };

  const updateFloor = (frame) => {
    if (!state.floorSource) return;
    const pose = frame.getHitTestResults(state.floorSource)[0]?.getPose(renderer.xr.getReferenceSpace());
    if (pose) state.floorY = pose.transform.position.y;
  };

  const reportView = () => {
    renderer.getDrawingBufferSize(bufferSize);
    const p = camera.projectionMatrix.elements;
    const aspectError = p[0] !== 0 && bufferSize.y > 0 ? p[5] / p[0] / (bufferSize.x / bufferSize.y) : 0;
    const view = {
      width: bufferSize.x,
      height: bufferSize.y,
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight,
      aspectError,
    };
    const key = JSON.stringify({ ...view, aspectError: aspectError.toFixed(3) });
    if (key === state.view) return;
    state.view = key;
    onView(view);
  };

  const onFrame = (time, frame) => {
    if (!frame) return;
    const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
    reportTracking(pose);
    updateFloor(frame);
    if (!state.ready || !pose) {
      renderer.clear();
      return;
    }
    renderer.xr.updateCamera(camera);
    reportView();
    onBeforeRender(camera);
    renderer.render(scene, camera);
    onRendered();
  };

  const endSession = () => {
    renderer.setAnimationLoop(null);
    state.session = null;
    state.floorSource = null;
    state.floorY = null;
    state.status = "";
    state.reason = "";
    state.view = "";
    document.documentElement.classList.remove("xr-presenting");
    onEnd();
  };

  async function start() {
    if (state.session) return;
    if (!navigator.xr) throw new Error("WebXR is not available in this browser");
    // Request before anything else: browsers only allow it during the Start
    // tap's user activation.
    const session = await navigator.xr.requestSession("immersive-ar", {
      optionalFeatures: [...SESSION_FEATURES],
      ...(overlay ? { domOverlay: { root: overlay } } : {}),
    });
    try {
      state.referenceSpace = await pickReferenceSpace(session);
      const nativeScale = globalThis.XRWebGLLayer?.getNativeFramebufferScaleFactor?.(session) ?? 1;
      renderer.setSize(canvas.width, canvas.height, false);
      renderer.xr.setReferenceSpaceType(state.referenceSpace);
      renderer.xr.setFramebufferScaleFactor(framebufferScale(dpr, window.devicePixelRatio, nativeScale));
      await renderer.xr.setSession(session);
    } catch (err) {
      await session.end().catch(() => {});
      throw err;
    }
    state.session = session;
    session.addEventListener("end", endSession, { once: true });
    if (state.referenceSpace !== "local-floor") {
      state.floorSource = await requestFloorSource(session, renderer.xr.getReferenceSpace());
    }
    document.documentElement.classList.add("xr-presenting");
    renderer.setAnimationLoop(onFrame);
  }

  return {
    kind: "webxr",
    get presenting() { return state.session !== null; },
    get referenceSpace() { return state.referenceSpace; },
    /** World y of the floor, for placing the portal above it. */
    groundY: () => floorHeight(state.referenceSpace, state.floorY),
    start,
  };
}

// A ray straight down from where the session started. The start pose stays
// fixed in "local" space as the viewer walks, so this finds the floor under
// it once the host has detected that surface.
async function requestFloorSource(session, space) {
  if (typeof session.requestHitTestSource !== "function" || typeof globalThis.XRRay !== "function") return null;
  try {
    return await session.requestHitTestSource({
      space,
      offsetRay: new globalThis.XRRay({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
    });
  } catch {
    return null;
  }
}
