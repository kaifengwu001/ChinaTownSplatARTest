import { dyno, type GsplatModifier } from "@sparkjsdev/spark";
import { bandEffect } from "./splatBandGraph";
import type { EffectUniforms } from "./splatEffectUniforms";

type Float = dyno.DynoVal<"float">;

export interface EnabledEffects {
  band: boolean;
  periphery: boolean;
  fireflies: boolean;
  dissolve: boolean;
}

const TAU = Math.PI * 2;

const f = (value: number): Float => dyno.dynoConst("float", value);
const one = () => f(1);

/**
 * Builds a Spark object modifier that rescales and fades each splat. Only the
 * enabled effects are compiled in, so switched-off effects cost nothing.
 * Splat centres are never moved: the depth sort stays valid, and splats stay
 * behind the window plane where the matte can clip them.
 */
export function buildEffectModifier(u: EffectUniforms, on: EnabledEffects): GsplatModifier {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    if (!gsplat) throw new Error("SplatEffects: modifier received no splat");
    const { index, center, scales, rgb, opacity } = dyno.splitGsplat(gsplat).outputs;

    const toSplat = dyno.sub(center, u.cameraPosition);
    const distance = dyno.max(dyno.length(toSplat), f(1e-3));

    let size: Float = one();
    let alpha: Float = one();
    let glow: Float = one();

    if (on.band) {
      const band = bandEffect(u, distance);
      size = dyno.mul(size, band.size);
      glow = dyno.mul(glow, band.glow);
    }

    if (on.periphery) {
      const cosAngle = dyno.dot(dyno.normalize(toSplat), u.cameraForward);
      const weight = dyno.sub(one(), dyno.smoothstep(u.peripheryCosSoft, u.peripheryCosSharp, cosAngle));
      size = dyno.mul(size, dyno.add(one(), dyno.mul(weight, u.peripheryGrow)));
      alpha = dyno.mul(alpha, dyno.mix(one(), u.peripheryOpacity, weight));
    }

    if (on.fireflies) {
      const { x, y, z } = dyno.split(scales).outputs;
      const angularSize = dyno.div(dyno.max(dyno.max(x, y), z), distance);
      const small = dyno.sub(one(), dyno.smoothstep(dyno.mul(u.fireflySize, f(0.5)), u.fireflySize, angularSize));
      const picked = dyno.step(dyno.sub(one(), u.fireflyFraction), dyno.hashFloat(index));
      const phase = dyno.mul(dyno.hashFloat(dyno.add(index, dyno.dynoConst("int", 7919))), f(TAU));
      const rate = dyno.mul(
        u.fireflySpeed,
        dyno.add(f(0.6), dyno.mul(dyno.hashFloat(dyno.add(index, dyno.dynoConst("int", 104729))), f(0.8))),
      );
      const wave = dyno.add(f(0.5), dyno.mul(f(0.5), dyno.sin(dyno.add(dyno.mul(u.time, rate), phase))));
      const pulse = dyno.pow(wave, f(3)); // mostly dim, with brief bright blinks
      const weight = dyno.mul(small, picked);
      const blink = dyno.mul(weight, pulse);

      size = dyno.mul(size, dyno.add(one(), dyno.mul(blink, f(0.6))));
      glow = dyno.mul(glow, dyno.add(one(), dyno.mul(blink, u.fireflyBrightness)));
      alpha = dyno.mul(alpha, dyno.mix(one(), dyno.add(f(0.15), dyno.mul(pulse, f(0.85))), weight));
    }

    if (on.dissolve) {
      // A smooth drifting field for coherent patches, plus per-splat grain so
      // the patch edges break up rather than cutting cleanly.
      const { x, y, z } = dyno.split(dyno.mul(center, u.dissolveNoiseScale)).outputs;
      const field = dyno.mul(
        dyno.mul(dyno.sin(dyno.add(x, dyno.mul(u.time, f(0.3)))), dyno.sin(dyno.add(dyno.mul(y, f(1.3)), f(1.7)))),
        dyno.sin(dyno.add(dyno.mul(z, f(0.7)), dyno.mul(u.time, f(0.2)))),
      );
      const smooth = dyno.add(dyno.mul(field, f(0.5)), f(0.5));
      const noise = dyno.add(dyno.mul(smooth, f(0.75)), dyno.mul(dyno.hashFloat(index), f(0.25)));
      const keep = dyno.smoothstep(u.dissolveThreshold, dyno.add(u.dissolveThreshold, u.dissolveSoftness), noise);
      size = dyno.mul(size, keep);
      alpha = dyno.mul(alpha, keep);
    }

    return {
      gsplat: dyno.combineGsplat({
        gsplat,
        scales: dyno.mul(scales, size),
        rgb: dyno.mul(rgb, glow),
        opacity: dyno.mul(opacity, alpha),
      }),
    };
  });
}
