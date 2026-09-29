import { dyno, type GsplatModifier } from "@sparkjsdev/spark";
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

/** 1 at `offset` 0, falling smoothly to 0 at `halfWidth`; 1 for negative offsets. */
const falloff = (offset: Float, halfWidth: Float): Float =>
  dyno.sub(one(), dyno.smoothstep(f(0), halfWidth, offset));

/**
 * 0 at `offset` 0, peaking at 1 halfway to `width`, and 0 again at `width` and
 * beyond; 0 for negative offsets. Starting and ending at 0 keeps the band's two
 * sides from meeting in a hard seam.
 */
const hump = (offset: Float, width: Float): Float => {
  const x = dyno.clamp(dyno.div(offset, width), f(0), one());
  return dyno.mul(dyno.mul(f(4), x), dyno.sub(one(), x));
};

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
      // Log distance, because the capture spans roughly 12 to 500 scene units
      // and a linear sweep would spend most of its time in the sparse far field.
      // Positive offsets are ahead of the band centre (farther away), negative
      // ones behind it: the front swells splats, the back shrinks them.
      const ahead = dyno.sub(dyno.log(distance), u.bandLogDistance);
      const behind = dyno.neg(ahead);
      const swell = dyno.mul(hump(ahead, u.bandFrontWidth), u.bandFrontGrow);
      const trough = dyno.mul(hump(behind, u.bandBackWidth), u.bandBackShrink);
      size = dyno.mul(size, dyno.sub(dyno.add(one(), swell), trough));

      const lit = dyno.mul(falloff(ahead, u.bandFrontWidth), falloff(behind, u.bandBackWidth));
      glow = dyno.mul(glow, dyno.add(one(), dyno.mul(lit, u.bandBrightness)));
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
