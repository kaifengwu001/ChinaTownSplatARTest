// Physical photo coordinates keep the wave circular regardless of image aspect.
// All three layers share this turbulent front: original, splats, particles.
export const MEMORY_WAVE_GLSL = /* glsl */ `
  float memoryHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float memoryNoise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(memoryHash(cell), memoryHash(cell+vec2(1.0,0.0)), f.x),
      mix(memoryHash(cell+vec2(0.0,1.0)), memoryHash(cell+1.0), f.x), f.y);
  }
  float memoryFbm(vec2 p) {
    return 0.57*memoryNoise(p) + 0.28*memoryNoise(p*2.03+8.1) + 0.15*memoryNoise(p*4.17-3.7);
  }
  vec2 memoryCoordinates(vec2 uv, vec2 photoSize) { return (uv-0.5)*photoSize / (0.5*length(photoSize)); }
  float memoryRadius(vec2 uv, vec2 photoSize, float seconds, float irregularity) {
    vec2 p = memoryCoordinates(uv, photoSize);
    vec2 warp = vec2(memoryFbm(p*3.0+seconds*0.12), memoryFbm(p*3.0+9.2-seconds*0.16));
    float turbulence = memoryFbm(p*7.0+warp*2.1+seconds*0.16)-0.5;
    return max(0.0,length(p) + min(length(p)*4.0,1.0)*turbulence*0.31*irregularity);
  }
  float memoryReveal(float radius, float progress, float diameter, float width) {
    if (progress <= 0.0) return 0.0;
    if (progress >= 1.0) return 1.0;
    float feather = width*(0.105/0.22);
    float reveal = smoothstep(radius-feather, radius+feather, progress*diameter);
    // A small diameter or a very irregular crest must still finish revealing
    // the photograph smoothly before the depth stage starts.
    return mix(reveal,1.0,smoothstep(0.86,1.0,progress));
  }
  float memoryFront(float radius, float progress, float diameter, float width) {
    if (progress <= 0.0 || progress >= 1.0) return 0.0;
    float d = (radius-progress*diameter)/width;
    return exp(-d*d) * smoothstep(-0.01,0.08,progress) * (1.0-smoothstep(0.86,1.0,progress));
  }
`;
