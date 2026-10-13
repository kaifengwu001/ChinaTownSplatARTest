// The original is bundled by Vite so the same asset works locally and on Vercel.
// Projection metadata belongs to the COLOR photograph used to produce the SOG,
// even when the original has slightly different dimensions or a different crop.
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
  portalWidthScale: 1.5,
  portalHeightScale: 2.5,
  depthStretch: 2,
  parallaxGain: 2,
  flatEffectStrength: 0.25,
});

export function readMemorySettings(search) {
  const params = new URLSearchParams(search);
  const settings = { ...MEMORY_SETTINGS };
  for (const [key, min, max] of [["depthStretch", 0.5, 4], ["parallaxGain", 1, 4], ["flatEffectStrength", 0, 1]]) {
    if (!params.has(key)) continue;
    const value = Number(params.get(key));
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`?${key} must be between ${min} and ${max}`);
    settings[key] = value;
  }
  return settings;
}

export function memoryDimensions(config, aspect, settings = MEMORY_SETTINGS) {
  const photoWidth = config.windowWidth * settings.photoScale;
  return { photoWidth, photoHeight: photoWidth / aspect,
    portalWidth: config.windowWidth * settings.portalWidthScale,
    portalHeight: config.windowHeight * settings.portalHeightScale };
}
