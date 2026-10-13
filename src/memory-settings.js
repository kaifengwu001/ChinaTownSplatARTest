// The original is bundled by Vite so the same asset works locally and on Vercel.
// Projection metadata belongs to the COLOR photograph used to produce the SOG,
// even when the original has slightly different dimensions or a different crop.
export const MEMORY_SETTINGS = Object.freeze({
  photoUrl: new URL("../input/memory-original.jpg", import.meta.url).href,
  captureAspect: 1024 / 678,
  // SHARP assumed a 30mm lens on a 36x24mm sensor, using the image diagonal.
  captureFocalRatio: 30 * Math.hypot(1024, 678) / Math.hypot(36, 24) / 1024,
  colorDuration: 2.7,
  flatHoldDuration: 0.35,
  depthDuration: 3.1,
});
