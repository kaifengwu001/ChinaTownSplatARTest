/**
 * Viewer configuration. Treated as immutable: `update` returns a new object
 * rather than mutating, so the render loop always reads a consistent snapshot.
 */

export const DEFAULTS = Object.freeze({
  mode: "window", // "window" | "free"

  // Physical window (metres). Tuned by eye for AR: a portrait phone camera
  // sees only ~35 deg horizontally, so the window must be small and close
  // enough to sit inside the view with room around it.
  windowWidth: 0.4,
  windowHeight: 0.4,
  windowDistance: 1.28,

  // Placement of the SHARP scene behind the window plane.
  // SHARP's nearest content sits ~1.5m from the original camera, so it must be
  // pushed back far enough to clear the window or it pokes through the frame.
  sceneOffsetZ: 1.12,
  sceneScale: 0.99,

  // Vertical framing. Pitch re-aims the window at a different band of the photo
  // by rotating about the capture point.
  scenePitchDeg: 11.56,
  sceneOffsetY: -1.4,

  // Viewer motion. SHARP's usable baseline is ~0.5m absolute.
  eyeOffsetX: 0.0,
  swayEnabled: true,
  swayAmplitude: 0.5,
  swayPeriod: 6.0,

  // Turn the head to keep facing the window. Realistic for large offsets and
  // stops the aperture sliding out of frame when evaluating the extremes.
  trackWindow: false,

  cameraFovY: 50,
  showMatte: true,
});

export function update(config, key, value) {
  if (!(key in config)) throw new Error(`Unknown config key: ${key}`);
  return Object.freeze({ ...config, [key]: value });
}

/**
 * Angular geometry of the current window setup, used for the HUD readout.
 *
 * `availableHalfCone` is how much scene SHARP actually reconstructed: it stops
 * at ~1.18x the input image frustum, and the source photo had no EXIF so SHARP
 * assumed a 30mm-equivalent lens (~61.9 deg horizontal).
 */
const SHARP_FRUSTUM_MARGIN = 1.18;
const ASSUMED_HFOV_DEG = 61.9;

export function geometry(config) {
  const { windowWidth, windowHeight, windowDistance, swayAmplitude } = config;
  const halfW = windowWidth / 2;
  const deg = (r) => (r * 180) / Math.PI;

  const windowHalfCone = deg(Math.atan(halfW / windowDistance));
  const neededHalfCone = deg(Math.atan((halfW + swayAmplitude) / windowDistance));
  const availableHalfCone = deg(
    Math.atan(SHARP_FRUSTUM_MARGIN * Math.tan((ASSUMED_HFOV_DEG / 2) * (Math.PI / 180))),
  );

  return {
    windowHalfCone,
    neededHalfCone,
    availableHalfCone,
    headroomDeg: availableHalfCone - neededHalfCone,
    vSubtenseDeg: 2 * deg(Math.atan(windowHeight / 2 / windowDistance)),
    nearestContentZ: -(1.53 * config.sceneScale + config.sceneOffsetZ),
  };
}
