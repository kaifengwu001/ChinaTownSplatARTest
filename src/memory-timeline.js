import { MEMORY_SETTINGS } from "./memory-settings.js";

export function memoryDuration(settings = MEMORY_SETTINGS) {
  return settings.colorDuration + settings.flatHoldDuration + settings.depthDuration;
}

const clamp = (value) => Math.min(1, Math.max(0, value));
export const ease = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
// Minimum-jerk curve: zero velocity and acceleration at both ends.
export const spatialEase = (value) => { const t = clamp(value); return t * t * t * (t * (6 * t - 15) + 10); };

/** A deterministic timeline shared by AR and the desktop scrubber. */
export function memoryFrame(seconds, settings = MEMORY_SETTINGS) {
  if (seconds === null) return { phase: "dormant", seconds: 0, color: -0.15, depth: 0, growth: 0, effects: 0 };
  const depthStart = settings.colorDuration + settings.flatHoldDuration;
  const color = clamp(seconds / settings.colorDuration);
  const depth = clamp((seconds - depthStart) / settings.depthDuration);
  const phase = color < 1 ? "colorizing" : seconds < depthStart ? "surface" : depth < 1 ? "expanding" : "active";
  return { phase, seconds: Math.max(0, seconds), color, depth, growth: spatialEase(depth), effects: ease(color / 0.22) };
}
