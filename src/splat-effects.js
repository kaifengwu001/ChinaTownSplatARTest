import { buildEffectModifier } from "../mattercraft/splatEffectGraph.ts";
import { dyno } from "@sparkjsdev/spark";
import {
  DEFAULT_EFFECT_SETTINGS,
  applyCamera,
  applySettings,
  createUniforms,
} from "../mattercraft/splatEffectUniforms.ts";

export const EFFECT_NAMES = Object.freeze(["band", "periphery"]);

/**
 * Parses `?fx=band,periphery` (or `?fx=none`) into the enabled effects.
 * Absent means all of them, since the tuned look is the default.
 */
export function readEnabledEffects(value) {
  const requested = value === null ? EFFECT_NAMES : value.split(",").filter((name) => name && name !== "none");
  const unknown = requested.filter((name) => !EFFECT_NAMES.includes(name));
  if (unknown.length) throw new Error(`Unknown effect ${unknown.join(", ")}; use ${EFFECT_NAMES.join(", ")} or none`);
  return Object.freeze(Object.fromEntries(EFFECT_NAMES.map((name) => [name, requested.includes(name)])));
}

/**
 * Puts the effect program shared with the Mattercraft component on a Spark
 * SplatMesh. Returns `update(camera, seconds, strength = 1)` before each render.
 * Strength lets memory activation introduce the ambient look after expansion.
 */
export function attachEffects(mesh, enabled, settings = DEFAULT_EFFECT_SETTINGS) {
  if (!EFFECT_NAMES.some((name) => enabled[name])) return () => {};

  const uniforms = createUniforms();
  const strength = dyno.dynoFloat(1);
  const effect = buildEffectModifier(uniforms, enabled);
  const modifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const original = dyno.splitGsplat(gsplat).outputs;
    const changed = dyno.splitGsplat(effect.apply({ gsplat }).gsplat).outputs;
    return { gsplat: dyno.combineGsplat({
      gsplat,
      scales: dyno.mix(original.scales, changed.scales, strength),
      rgb: dyno.mix(original.rgb, changed.rgb, strength),
      opacity: dyno.mix(original.opacity, changed.opacity, strength),
    }) };
  });
  mesh.objectModifiers = [...(mesh.objectModifiers ?? []), modifier];
  mesh.updateGenerator();

  return (camera, seconds, amount = 1) => {
    strength.value = amount;
    applySettings(uniforms, settings, seconds);
    applyCamera(uniforms, mesh, camera);
    mesh.updateVersion();
  };
}
