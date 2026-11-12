// The original is bundled by Vite so the same asset works locally and on Vercel.
// Projection metadata belongs to the COLOR photograph used to produce the SOG,
// even when the original has slightly different dimensions or a different crop.
export const PARTICLE_FLOW_PARAMETERS = Object.freeze([
  { key: "particleCount", label: "Particle count", min: 0, max: 60000, step: 1, value: 11516, unit: "count" },
  { key: "particleSizeMin", label: "Minimum particle size", min: 0.2, max: 24, step: 0.1, value: 3.4, unit: "px" },
  { key: "particleSizeMax", label: "Maximum particle size", min: 0.2, max: 24, step: 0.1, value: 5.1, unit: "px" },
  { key: "rippleDiameter", label: "Ripple diameter", min: 0.5, max: 2.5, step: 0.01, value: 1.01, unit: "percent" },
  { key: "transitionWidth", label: "Transition width", min: 0.04, max: 0.6, step: 0.01, value: 0.14, unit: "percent" },
  { key: "flowStrength", label: "Flow strength", min: 0, max: 3, step: 0.05, value: 0.35, unit: "gain" },
  { key: "flowSpeed", label: "Flow speed", min: 0, max: 3, step: 0.05, value: 1.55, unit: "gain" },
  { key: "rippleTurbulence", label: "Ripple irregularity", min: 0, max: 2, step: 0.05, value: 1.75, unit: "percent" },
].map(Object.freeze));

export const MEMORY_SETTINGS = Object.freeze({
  photoUrl: new URL("../input/apalabassa-original.jpg", import.meta.url).href,
  // The restoration with Peter SooHoo standing in the street, who lived there.
  colorPhotoUrl: new URL("../input/apalabassa-soohoo.webp", import.meta.url).href,
  captureAspect: 1448 / 1086,
  // SHARP assumed a 30mm lens on a 36x24mm sensor, using the image diagonal.
  captureFocalRatio: 30 * Math.hypot(1448, 1086) / Math.hypot(36, 24) / 1448,
  // Where the restored colour photograph's frame lies in the original, as
  // fractions of the original's width and height from its top-left corner:
  // left, top, right, bottom. The restoration cropped the original's top and
  // bottom and stretched it to 4:3. From scripts/register_original.py.
  originalFrame: Object.freeze([0.0044, 0.0569, 0.9979, 0.9660]),
  // The capture's street, from scripts/fit_ground.py in SHARP's OpenCV frame:
  // the ground's up direction, the camera's height above it, and how far ahead
  // the reconstructed street begins. The photographer's camera was level.
  // Update these with the reconstruction. With Peter in the street SHARP sees
  // the scene about 0.8 of the size it saw it without him.
  captureGroundUp: Object.freeze([-0.00991, -0.99995, 0.00159]),
  captureCameraHeight: 1.39,
  captureGroundStart: 2.97,
  // The colour spreads slowly enough to follow (it was 2.7 s), and the street
  // holds flat while the plate holder around it dissolves before it opens.
  colorDuration: 4.2,
  flatHoldDuration: 0.8,
  depthDuration: 3.1,
  // The match cut. The viewer matches the photograph `walkDistance` ahead of
  // where the memory is placed; it floats `photoDistance` beyond that spot and,
  // seen from it, fits inside the sideways screen at `matchFrame` of its
  // height (tuned on a phone: the whole photograph in view). Holding the phone
  // sideways and level, with the photograph's corners within `matchTolerance`
  // degrees of the guide frame's on screen, for `matchHold` seconds starts the
  // activation. `dolly` moves the spot in front of the photographer for a
  // dolly zoom as the photograph opens: 0 matches the photographer's view
  // exactly, 1 is the tap version's 1.8 m, 0.3 was settled on a phone. The
  // photograph, the portal and where the street begins all follow from these
  // and the scene's size; see src/photographer.js.
  walkDistance: 1,
  // The phone at the match, and so the photograph's centre, this high above
  // the floor: where most people hold a phone up to frame a view. The street
  // stays on the floor whatever it is (see photographerLayout).
  matchHeight: 1.55,
  photoDistance: 0.8,
  matchFrame: 0.8,
  dolly: 0.3,
  matchTolerance: 4,
  matchHold: 0.6,
  // The street at 1.04 of its captured size, which puts the photographer's
  // eye 1.39 m x 1.04 = 1.445 m above the floor, the matching height first
  // tuned on a phone with the earlier reconstruction at 0.85.
  sceneScale: 1.04,
  // The spill is a fan of light from the portal's sides: its full angle, and
  // the penumbra angle by which its edges blur wider with distance.
  spillStrength: 6.3,
  spillAngle: 31,
  spillSoftness: 60,
  depthStretch: 1,
  parallaxGain: 1,
  flatEffectStrength: 1,
  ...Object.fromEntries(PARTICLE_FLOW_PARAMETERS.map(({ key, value }) => [key, value])),
});

export const MEMORY_TUNING_PARAMETERS = Object.freeze([
  { key: "walkDistance", label: "Walk distance", min: 0, max: 4, step: 0.05, unit: "m", group: "Match" },
  { key: "matchHeight", label: "Match height", min: 0.8, max: 2.2, step: 0.01, unit: "m", group: "Match" },
  { key: "photoDistance", label: "Image distance", min: 0.2, max: 3, step: 0.01, unit: "m", group: "Match" },
  { key: "matchFrame", label: "Match frame", min: 0.3, max: 1, step: 0.01, unit: "percent", group: "Match" },
  { key: "dolly", label: "Dolly zoom", min: 0, max: 1.5, step: 0.05, unit: "gain", group: "Match" },
  { key: "matchTolerance", label: "Match tolerance", min: 0.5, max: 15, step: 0.5, unit: "deg", group: "Match" },
  { key: "matchHold", label: "Match hold", min: 0, max: 3, step: 0.05, unit: "s", group: "Match" },
  { key: "sceneScale", label: "Scene size", min: 0.2, max: 3, step: 0.01, unit: "gain", group: "Scene" },
  { key: "spillStrength", label: "Ground spill", min: 0, max: 8, step: 0.05, unit: "gain", group: "Scene" },
  { key: "spillAngle", label: "Spill angle", min: 20, max: 170, step: 1, unit: "deg", group: "Scene" },
  { key: "spillSoftness", label: "Spill edge blur", min: 0, max: 80, step: 1, unit: "deg", group: "Scene" },
  { key: "depthStretch", label: "Depth stretch", min: 0.5, max: 4, step: 0.1, unit: "gain", group: "Scene" },
  { key: "parallaxGain", label: "Parallax strength", min: 1, max: 4, step: 0.1, unit: "gain", group: "Scene" },
  { key: "flatEffectStrength", label: "Flat dream effects", min: 0, max: 1, step: 0.05, unit: "percent", group: "Scene" },
  ...PARTICLE_FLOW_PARAMETERS.map(parameter => ({ ...parameter, group: "Particles" })),
  { key: "colorDuration", label: "Color duration", min: 0.5, max: 6, step: 0.05, unit: "s", group: "Timing" },
  { key: "flatHoldDuration", label: "Flat hold", min: 0, max: 2, step: 0.05, unit: "s", group: "Timing" },
  { key: "depthDuration", label: "Depth duration", min: 0.5, max: 8, step: 0.05, unit: "s", group: "Timing" },
].map(parameter => Object.freeze({ ...parameter, value: MEMORY_SETTINGS[parameter.key] })));

export function validateMemorySettings(settings) {
  for (const { key, min, max } of MEMORY_TUNING_PARAMETERS) {
    if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) throw new Error(`${key} must be between ${min} and ${max}`);
  }
  validateParticleFlow(settings);
}

export function validateParticleFlow(settings) {
  for (const { key, min, max } of PARTICLE_FLOW_PARAMETERS) {
    if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) {
      throw new Error(`${key} must be between ${min} and ${max}`);
    }
  }
  if (!Number.isInteger(settings.particleCount)) throw new Error("particleCount must be a whole number");
  if (settings.particleSizeMin > settings.particleSizeMax) throw new Error("Minimum particle size cannot exceed maximum particle size");
}

export function readMemorySettings(search) {
  const params = new URLSearchParams(search);
  const settings = { ...MEMORY_SETTINGS };
  for (const { key } of MEMORY_TUNING_PARAMETERS) {
    if (params.has(key)) settings[key] = Number(params.get(key));
  }
  validateMemorySettings(settings);
  return settings;
}
