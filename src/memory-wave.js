// Both the photograph and the splats use this front. Keeping the reveal in
// photograph UVs makes the wave match as the viewer walks around the window.
export const MEMORY_WAVE_GLSL = /* glsl */ `
  float memoryRadius(vec2 uv, float seconds) {
    vec2 p = uv * 2.0 - 1.0;
    float r = length(p) * 0.70710678;
    float angle = atan(p.y, p.x + 0.00001);
    return r + min(r * 4.0, 1.0) * (
      0.013 * sin(angle * 7.0 + seconds * 2.0) +
      0.009 * sin(angle * 13.0 - seconds * 3.0));
  }
  float memoryReveal(float radius, float progress) {
    return smoothstep(radius - 0.055, radius + 0.055, progress * 1.16);
  }
  float memoryFront(float radius, float progress) {
    float d = (radius - progress * 1.16) / 0.065;
    return exp(-d * d) * (1.0 - smoothstep(0.9, 1.0, progress));
  }
`;
