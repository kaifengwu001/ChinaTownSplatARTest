import { dyno } from "@sparkjsdev/spark";
import type { EffectUniforms } from "./splatEffectUniforms";

type Float = dyno.DynoVal<"float">;

const f = (value: number): Float => dyno.dynoConst("float", value);
const one = () => f(1);

/** 1 at `offset` 0, falling smoothly to 0 at `width`. */
const falloff = (offset: Float, width: Float): Float =>
  dyno.sub(one(), dyno.smoothstep(f(0), width, offset));

/**
 * 0 at `offset` 0, peaking at 1 halfway to `width`, and 0 again at `width` and
 * beyond. Starting and ending at 0 keeps a band's two sides from meeting in a
 * hard seam.
 */
const hump = (offset: Float, width: Float): Float => {
  const x = dyno.clamp(dyno.div(offset, width), f(0), one());
  return dyno.mul(dyno.mul(f(4), x), dyno.sub(one(), x));
};

/** Strength of a band centred at `centre`: 0 outside near..far, fading in and out at the ends. */
const lifetime = (u: EffectUniforms, centre: Float): Float => {
  const fadeIn = dyno.smoothstep(u.bandLogNear, dyno.add(u.bandLogNear, u.bandEdgeFade), centre);
  const fadeOut = dyno.smoothstep(dyno.sub(u.bandLogFar, u.bandEdgeFade), u.bandLogFar, centre);
  return dyno.mul(fadeIn, dyno.sub(one(), fadeOut));
};

/**
 * Size and brightness multipliers from the sweeping bands. Bands launch at
 * `bandLogNear` every period and travel outward, so their centres sit on a
 * grid `bandSpacing` apart that slides by `bandShift`. Each splat only needs
 * the nearest band on either side: the one it is ahead of (whose front swells
 * it) and the one it is behind (whose back shrinks it).
 *
 * Distances are logarithmic because the capture spans roughly 12 to 500 scene
 * units, and a linear sweep would spend most of its time in the sparse far field.
 */
export function bandEffect(u: EffectUniforms, distance: Float): { size: Float; glow: Float } {
  const logDistance = dyno.log(distance);
  const ahead = dyno.mod(dyno.sub(dyno.sub(logDistance, u.bandLogNear), u.bandShift), u.bandSpacing);
  const behind = dyno.sub(u.bandSpacing, ahead);
  const bandBelow = lifetime(u, dyno.sub(logDistance, ahead));
  const bandAbove = lifetime(u, dyno.add(logDistance, behind));

  const swell = dyno.mul(dyno.mul(hump(ahead, u.bandFrontWidth), u.bandFrontGrow), bandBelow);
  const trough = dyno.mul(dyno.mul(hump(behind, u.bandBackWidth), u.bandBackShrink), bandAbove);
  const size = dyno.max(dyno.sub(dyno.add(one(), swell), trough), f(0));

  const lit = dyno.max(
    dyno.mul(falloff(ahead, u.bandFrontWidth), bandBelow),
    dyno.mul(falloff(behind, u.bandBackWidth), bandAbove),
  );
  const glow = dyno.add(one(), dyno.mul(lit, u.bandBrightness));
  return { size, glow };
}
