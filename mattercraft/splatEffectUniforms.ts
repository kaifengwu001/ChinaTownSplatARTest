import { dyno } from "@sparkjsdev/spark";
import * as THREE from "three";

/**
 * Per-frame inputs to the effect program. Anything that only changes on the
 * CPU (the band's position, the dissolve threshold, angles as cosines) is
 * precomputed here, keeping the per-splat work small.
 */
export interface EffectUniforms {
  time: dyno.DynoFloat<string>;
  // Camera in the splat mesh's own coordinates, so no per-splat transform is needed.
  cameraPosition: dyno.DynoVec3<THREE.Vector3, string>;
  cameraForward: dyno.DynoVec3<THREE.Vector3, string>;

  bandLogDistance: dyno.DynoFloat<string>; // current band centre, as log(distance)
  bandHalfWidth: dyno.DynoFloat<string>; // in log(distance)
  bandGrow: dyno.DynoFloat<string>;
  bandBrightness: dyno.DynoFloat<string>;

  peripheryCosSharp: dyno.DynoFloat<string>;
  peripheryCosSoft: dyno.DynoFloat<string>;
  peripheryGrow: dyno.DynoFloat<string>;
  peripheryOpacity: dyno.DynoFloat<string>;

  fireflySize: dyno.DynoFloat<string>;
  fireflyFraction: dyno.DynoFloat<string>;
  fireflySpeed: dyno.DynoFloat<string>;
  fireflyBrightness: dyno.DynoFloat<string>;

  dissolveThreshold: dyno.DynoFloat<string>; // splats whose noise is below this are gone
  dissolveSoftness: dyno.DynoFloat<string>;
  dissolveNoiseScale: dyno.DynoFloat<string>;
}

/** User-facing settings, in the units shown in the editor. */
export interface EffectSettings {
  bandNear: number; // capture units
  bandFar: number;
  bandPeriod: number; // seconds per sweep
  bandWidth: number; // half-width as log(distance); 0.25 is about ±28%
  bandGrow: number; // extra size at the band centre; 1 doubles it
  bandBrightness: number;

  peripherySharpDegrees: number;
  peripherySoftDegrees: number;
  peripheryGrow: number;
  peripheryOpacity: number; // 0..1

  fireflySize: number; // splat size / distance
  fireflyFraction: number; // 0..1
  fireflySpeed: number; // radians per second
  fireflyBrightness: number;

  dissolvePeriod: number; // seconds per dissolve and re-form
  dissolveDepth: number; // 0..1
  dissolveSoftness: number; // 0..1
  dissolveNoiseScale: number;
}

// Tuned for the SHARP capture: its splats sit ~12-490 units from the capture
// point (median 41), and the smallest quarter span under 0.001 of their distance.
export const DEFAULT_EFFECT_SETTINGS: Readonly<EffectSettings> = Object.freeze({
  bandNear: 12,
  bandFar: 150,
  bandPeriod: 6,
  bandWidth: 0.25,
  bandGrow: 1,
  bandBrightness: 0.8,
  peripherySharpDegrees: 2,
  peripherySoftDegrees: 8,
  peripheryGrow: 1.5,
  peripheryOpacity: 0.35,
  fireflySize: 0.001,
  fireflyFraction: 0.15,
  fireflySpeed: 2,
  fireflyBrightness: 2.5,
  dissolvePeriod: 10,
  dissolveDepth: 1,
  dissolveSoftness: 0.15,
  dissolveNoiseScale: 0.2,
});

const DEG = Math.PI / 180;

export function createUniforms(): EffectUniforms {
  const d = DEFAULT_EFFECT_SETTINGS;
  return {
    time: dyno.dynoFloat(0),
    cameraPosition: dyno.dynoVec3(new THREE.Vector3()),
    cameraForward: dyno.dynoVec3(new THREE.Vector3(0, 0, -1)),
    bandLogDistance: dyno.dynoFloat(Math.log(d.bandNear)),
    bandHalfWidth: dyno.dynoFloat(d.bandWidth),
    bandGrow: dyno.dynoFloat(d.bandGrow),
    bandBrightness: dyno.dynoFloat(d.bandBrightness),
    peripheryCosSharp: dyno.dynoFloat(Math.cos(d.peripherySharpDegrees * DEG)),
    peripheryCosSoft: dyno.dynoFloat(Math.cos(d.peripherySoftDegrees * DEG)),
    peripheryGrow: dyno.dynoFloat(d.peripheryGrow),
    peripheryOpacity: dyno.dynoFloat(d.peripheryOpacity),
    fireflySize: dyno.dynoFloat(d.fireflySize),
    fireflyFraction: dyno.dynoFloat(d.fireflyFraction),
    fireflySpeed: dyno.dynoFloat(d.fireflySpeed),
    fireflyBrightness: dyno.dynoFloat(d.fireflyBrightness),
    dissolveThreshold: dyno.dynoFloat(0),
    dissolveSoftness: dyno.dynoFloat(d.dissolveSoftness),
    dissolveNoiseScale: dyno.dynoFloat(d.dissolveNoiseScale),
  };
}

/** Writes the camera into the uniforms, expressed in the splat mesh's coordinates. */
export function applyCamera(u: EffectUniforms, mesh: THREE.Object3D, camera: THREE.Camera) {
  mesh.updateWorldMatrix(true, false);
  camera.updateWorldMatrix(true, false);
  const toMesh = mesh.matrixWorld.clone().invert();
  u.cameraPosition.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(toMesh);
  u.cameraForward.value.set(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(toMesh);
}

/** Writes validated settings and the animation state at `seconds` into the uniforms. */
export function applySettings(u: EffectUniforms, s: EffectSettings, seconds: number) {
  const d = DEFAULT_EFFECT_SETTINGS;
  u.time.value = seconds;

  const near = positive(s.bandNear, d.bandNear);
  const far = Math.max(positive(s.bandFar, d.bandFar), near * 1.01);
  const sweep = cycle(seconds, s.bandPeriod);
  u.bandLogDistance.value = Math.log(near) + sweep * (Math.log(far) - Math.log(near));
  u.bandHalfWidth.value = positive(s.bandWidth, d.bandWidth);
  u.bandGrow.value = Math.max(0, s.bandGrow);
  u.bandBrightness.value = Math.max(0, s.bandBrightness);

  const sharp = clamp(s.peripherySharpDegrees, 0, 89);
  const soft = clamp(s.peripherySoftDegrees, sharp + 0.1, 90);
  u.peripheryCosSharp.value = Math.cos(sharp * DEG);
  u.peripheryCosSoft.value = Math.cos(soft * DEG);
  u.peripheryGrow.value = Math.max(0, s.peripheryGrow);
  u.peripheryOpacity.value = clamp(s.peripheryOpacity, 0, 1);

  u.fireflySize.value = positive(s.fireflySize, d.fireflySize);
  u.fireflyFraction.value = clamp(s.fireflyFraction, 0, 1);
  u.fireflySpeed.value = Math.max(0, s.fireflySpeed);
  u.fireflyBrightness.value = Math.max(0, s.fireflyBrightness);

  // The threshold swings from just below every splat's noise (all visible) to
  // `dissolveDepth` (that share gone) and back, easing at both ends.
  const softness = clamp(s.dissolveSoftness, 0.01, 1);
  const depth = clamp(s.dissolveDepth, 0, 1);
  const ease = 0.5 - 0.5 * Math.cos(2 * Math.PI * cycle(seconds, s.dissolvePeriod));
  u.dissolveThreshold.value = -softness + ease * (depth + softness);
  u.dissolveSoftness.value = softness;
  u.dissolveNoiseScale.value = positive(s.dissolveNoiseScale, d.dissolveNoiseScale);
}

/** Position within a repeating period, from 0 to 1. */
function cycle(seconds: number, period: number): number {
  const p = positive(period, 1);
  return (seconds % p) / p;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
