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
  photoUrl: new URL("../input/memory-original.jpg", import.meta.url).href,
  colorPhotoUrl: new URL("../input/chop_suey.jpg", import.meta.url).href,
  captureAspect: 1024 / 678,
  // SHARP assumed a 30mm lens on a 36x24mm sensor, using the image diagonal.
  captureFocalRatio: 30 * Math.hypot(1024, 678) / Math.hypot(36, 24) / 1024,
  colorDuration: 2.7,
  flatHoldDuration: 0.35,
  depthDuration: 3.1,
  photoScale: 0.5,
  photoDistance: 0.6,
  portalWidthScale: 1.5,
  portalHeightScale: 2.5,
  portalBottomHeight: 0.5,
  depthStretch: 2,
  parallaxGain: 1,
  flatEffectStrength: 1,
  ...Object.fromEntries(PARTICLE_FLOW_PARAMETERS.map(({ key, value }) => [key, value])),
});

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
  for (const [key, min, max] of [["depthStretch", 0.5, 4], ["parallaxGain", 1, 4], ["flatEffectStrength", 0, 1]]) {
    if (!params.has(key)) continue;
    const value = Number(params.get(key));
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`?${key} must be between ${min} and ${max}`);
    settings[key] = value;
  }
  for (const { key } of PARTICLE_FLOW_PARAMETERS) {
    if (params.has(key)) settings[key] = Number(params.get(key));
  }
  validateParticleFlow(settings);
  return settings;
}

export function memoryDimensions(config, aspect, settings = MEMORY_SETTINGS) {
  const photoWidth = config.windowWidth * settings.photoScale;
  return { photoWidth, photoHeight: photoWidth / aspect,
    portalWidth: config.windowWidth * settings.portalWidthScale,
    portalHeight: config.windowHeight * settings.portalHeightScale };
}
