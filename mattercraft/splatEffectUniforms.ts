import { dyno } from "@sparkjsdev/spark";
import * as THREE from "three";

/**
 * Per-frame inputs to the effect program. Anything that only changes on the
 * CPU (the band grid's position, angles as cosines) is precomputed here,
 * keeping the per-splat work small.
 */
export interface EffectUniforms {
  // Camera in the splat mesh's own coordinates, so no per-splat transform is needed.
  cameraPosition: dyno.DynoVec3<THREE.Vector3, string>;
  cameraForward: dyno.DynoVec3<THREE.Vector3, string>;

  // Band distances are all log(distance). Band centres sit at
  // bandLogNear + bandShift + k * bandSpacing, for those between near and far.
  bandLogNear: dyno.DynoFloat<string>;
  bandLogFar: dyno.DynoFloat<string>;
  bandSpacing: dyno.DynoFloat<string>;
  bandShift: dyno.DynoFloat<string>; // 0..bandSpacing, grows with time
  bandEdgeFade: dyno.DynoFloat<string>; // how far bands take to fade in and out
  bandFrontWidth: dyno.DynoFloat<string>;
  bandBackWidth: dyno.DynoFloat<string>;
  bandFrontGrow: dyno.DynoFloat<string>;
  bandBackShrink: dyno.DynoFloat<string>;
  bandBrightness: dyno.DynoFloat<string>;

  peripheryCosSharp: dyno.DynoFloat<string>;
  peripheryCosSoft: dyno.DynoFloat<string>;
  peripheryGrow: dyno.DynoFloat<string>;
  peripheryOpacity: dyno.DynoFloat<string>;
}

/** User-facing settings, in the units shown in the editor. */
export interface EffectSettings {
  bandNear: number; // capture units
  bandFar: number;
  bandPeriod: number; // seconds between one band launching and the next
  bandSpeed: number; // share of the near-to-far course a band covers per second
  // Bands move near to far, so their front is the far side and their back the
  // near side. Widths are in log(distance): 0.2 spans about 22% of distance.
  bandFrontWidth: number;
  bandBackWidth: number;
  bandFrontGrow: number; // extra size at the front's peak; 1 doubles it
  bandBackShrink: number; // 0..1 size lost at the back's trough; 1 shrinks to nothing
  bandBrightness: number;

  peripherySharpDegrees: number;
  peripherySoftDegrees: number;
  peripheryGrow: number;
  peripheryOpacity: number; // 0..1
}

// Tuned by eye in Mattercraft on the SHARP capture, whose splats sit ~12-490
// units from the capture point (median 41). The iOS app mirrors these in
// SplatEffectSettings.swift.
export const DEFAULT_EFFECT_SETTINGS: Readonly<EffectSettings> = Object.freeze({
  bandNear: 12,
  bandFar: 150,
  bandPeriod: 4,
  bandSpeed: 0.05,
  bandFrontWidth: 0.2,
  bandBackWidth: 0.2,
  bandFrontGrow: 1.75,
  bandBackShrink: 0.12,
  bandBrightness: 0.5,
  peripherySharpDegrees: 5,
  peripherySoftDegrees: 22,
  peripheryGrow: 0.2,
  peripheryOpacity: 0.5,
});

const DEG = Math.PI / 180;
// Share of the near-to-far course over which a band fades in, and again out.
const BAND_EDGE_FADE = 0.1;

export function createUniforms(): EffectUniforms {
  const d = DEFAULT_EFFECT_SETTINGS;
  return {
    cameraPosition: dyno.dynoVec3(new THREE.Vector3()),
    cameraForward: dyno.dynoVec3(new THREE.Vector3(0, 0, -1)),
    bandLogNear: dyno.dynoFloat(Math.log(d.bandNear)),
    bandLogFar: dyno.dynoFloat(Math.log(d.bandFar)),
    bandSpacing: dyno.dynoFloat(1),
    bandShift: dyno.dynoFloat(0),
    bandEdgeFade: dyno.dynoFloat(0.1),
    bandFrontWidth: dyno.dynoFloat(d.bandFrontWidth),
    bandBackWidth: dyno.dynoFloat(d.bandBackWidth),
    bandFrontGrow: dyno.dynoFloat(d.bandFrontGrow),
    bandBackShrink: dyno.dynoFloat(d.bandBackShrink),
    bandBrightness: dyno.dynoFloat(d.bandBrightness),
    peripheryCosSharp: dyno.dynoFloat(Math.cos(d.peripherySharpDegrees * DEG)),
    peripheryCosSoft: dyno.dynoFloat(Math.cos(d.peripherySoftDegrees * DEG)),
    peripheryGrow: dyno.dynoFloat(d.peripheryGrow),
    peripheryOpacity: dyno.dynoFloat(d.peripheryOpacity),
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

  applyBandTiming(u, s, seconds);
  u.bandFrontWidth.value = positive(s.bandFrontWidth, d.bandFrontWidth);
  u.bandBackWidth.value = positive(s.bandBackWidth, d.bandBackWidth);
  u.bandFrontGrow.value = Math.max(0, s.bandFrontGrow);
  u.bandBackShrink.value = clamp(s.bandBackShrink, 0, 1);
  u.bandBrightness.value = Math.max(0, s.bandBrightness);

  const sharp = clamp(s.peripherySharpDegrees, 0, 89);
  const soft = clamp(s.peripherySoftDegrees, sharp + 0.1, 90);
  u.peripheryCosSharp.value = Math.cos(sharp * DEG);
  u.peripheryCosSoft.value = Math.cos(soft * DEG);
  u.peripheryGrow.value = Math.max(0, s.peripheryGrow);
  u.peripheryOpacity.value = clamp(s.peripheryOpacity, 0, 1);
}

/**
 * Lays out the band grid: a band launches at `bandNear` every `bandPeriod`
 * seconds and travels outward at `bandSpeed`, however many are already under way.
 */
function applyBandTiming(u: EffectUniforms, s: EffectSettings, seconds: number) {
  const d = DEFAULT_EFFECT_SETTINGS;
  const logNear = Math.log(positive(s.bandNear, d.bandNear));
  const logFar = Math.max(Math.log(positive(s.bandFar, d.bandFar)), logNear + 0.01);
  const course = logFar - logNear;
  const speed = positive(s.bandSpeed, d.bandSpeed) * course; // log(distance) per second
  const spacing = speed * positive(s.bandPeriod, d.bandPeriod);

  u.bandLogNear.value = logNear;
  u.bandLogFar.value = logFar;
  u.bandSpacing.value = spacing;
  u.bandShift.value = (speed * seconds) % spacing;
  u.bandEdgeFade.value = BAND_EDGE_FADE * course;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
