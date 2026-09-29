import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";

const NEAR = 0.05;
// SHARP's far content can sit tens of metres behind the capture point, and the
// whole scene is scaled and pushed back further still.
const FAR = 1000;

/**
 * An 8th Wall camera pipeline module that renders our own three.js scene on
 * top of the camera feed.
 *
 * Used instead of `XR8.Threejs.pipelineModule()`, which builds its renderer
 * from `window.THREE` and is frozen inside a closed binary, so there is no
 * guarantee it works with the three.js version Spark needs. This module mirrors
 * what that one does: share 8th Wall's GL context, copy the tracked pose and
 * projection onto a camera each frame, and draw after the camera feed.
 *
 * `onReady` receives `{ renderer, scene, camera }` once the GL context exists.
 * `onTracking` receives `{ status, reason }` whenever either changes.
 * `onBeforeRender` receives the camera just before each frame is drawn.
 * `onRendered` is called after each frame is drawn.
 * `onView` receives `{ width, height, cssWidth, cssHeight, aspectError }` when
 * the render size or projection changes; `aspectError` is the ratio of the
 * projection's aspect to the buffer's, and anything but 1 means stretching.
 */
export function createThreeBridge({
  onReady,
  onTracking,
  onBeforeRender = () => {},
  onRendered = () => {},
  onView = () => {},
}) {
  const state = { renderer: null, scene: null, camera: null, status: "", reason: "", size: "", view: "" };

  const syncProjection = (width, height) => {
    state.size = `${width}x${height}`;
    state.renderer.setSize(width, height, false);
    window.XR8.XrController.updateCameraProjectionMatrix({
      origin: state.camera.position,
      facing: state.camera.quaternion,
      cam: { pixelRectWidth: width, pixelRectHeight: height, nearClipPlane: NEAR, farClipPlane: FAR },
    });
  };

  const applyPose = ({ rotation, position, intrinsics }) => {
    const { camera } = state;
    camera.projectionMatrix.fromArray(intrinsics);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    camera.position.set(position.x, position.y, position.z);
  };

  const reportTracking = ({ trackingStatus = "", trackingReason = "" }) => {
    if (trackingStatus === state.status && trackingReason === state.reason) return;
    state.status = trackingStatus;
    state.reason = trackingReason;
    onTracking({ status: trackingStatus, reason: trackingReason });
  };

  // The canvas buffer can be resized by us, by 8th Wall, or by Safari's toolbar
  // showing and hiding. three.js keeps its own viewport size, so any drift
  // between it and the buffer renders a stretched image.
  const followCanvas = (canvas) => {
    if (`${canvas.width}x${canvas.height}` !== state.size) syncProjection(canvas.width, canvas.height);
  };

  const reportView = (canvas) => {
    const p = state.camera.projectionMatrix.elements;
    const aspectError = p[0] !== 0 ? p[5] / p[0] / (canvas.width / canvas.height) : 0;
    const view = {
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      aspectError,
    };
    const key = JSON.stringify({ ...view, aspectError: aspectError.toFixed(3) });
    if (key === state.view) return;
    state.view = key;
    onView(view);
  };

  return {
    name: "parallax-three",

    onStart: ({ canvas, canvasWidth, canvasHeight, GLctx }) => {
      // antialias off: MSAA is pure cost for splats (see Spark perf guide).
      const renderer = new THREE.WebGLRenderer({ canvas, context: GLctx, antialias: false });
      renderer.autoClear = false;

      const scene = new THREE.Scene();
      scene.add(new SparkRenderer({ renderer }));

      // Starting pose must match the origin handed to 8th Wall below, so the
      // tracked world and our scene share one frame.
      const camera = new THREE.PerspectiveCamera(60, canvasWidth / canvasHeight, NEAR, FAR);
      camera.position.set(0, 0, 0);
      scene.add(camera);

      Object.assign(state, { renderer, scene, camera });
      syncProjection(canvasWidth, canvasHeight);
      onReady({ renderer, scene, camera });
    },

    onCanvasSizeChange: ({ canvasWidth, canvasHeight }) => {
      if (state.renderer) syncProjection(canvasWidth, canvasHeight);
    },

    onUpdate: ({ processCpuResult }) => {
      const reality = processCpuResult?.reality;
      if (!reality?.intrinsics || !state.camera) return;
      applyPose(reality);
      reportTracking(reality);
    },

    onRender: () => {
      const { renderer, scene, camera } = state;
      if (!renderer) return;
      // 8th Wall has just drawn the camera feed with its own GL state; three's
      // cached state is stale, and the colour buffer must be kept.
      renderer.resetState();
      followCanvas(renderer.domElement);
      reportView(renderer.domElement);
      renderer.clearDepth();
      onBeforeRender(camera);
      renderer.render(scene, camera);
      onRendered();
    },
  };
}
