#include <metal_stdlib>
using namespace metal;

// MARK: - Camera background
//
// Draws the ARKit captured image as a full-screen backdrop. The captured frame
// is YCbCr 4:2:0 biplanar, and its orientation/crop relative to the viewport is
// handled by UVs that the CPU has already run through ARKit's displayTransform.

struct BackgroundVertex {
    float4 position [[position]];
    float2 uv;
};

vertex BackgroundVertex cameraVertex(uint vertexID [[vertex_id]],
                                     constant float2 *uvs [[buffer(0)]]) {
    const float2 clip[4] = {
        float2(-1.0, -1.0), float2(1.0, -1.0), float2(-1.0, 1.0), float2(1.0, 1.0)
    };
    BackgroundVertex out;
    out.position = float4(clip[vertexID], 0.0, 1.0);
    out.uv = uvs[vertexID];
    return out;
}

fragment float4 cameraFragment(BackgroundVertex in [[stage_in]],
                               texture2d<float> luma [[texture(0)]],
                               texture2d<float> chroma [[texture(1)]]) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);

    // Standard full-range YCbCr -> sRGB conversion used by ARKit samples.
    const float4x4 ycbcrToRGB = float4x4(
        float4(+1.0000, +1.0000, +1.0000, +0.0000),
        float4(+0.0000, -0.3441, +1.7720, +0.0000),
        float4(+1.4020, -0.7141, +0.0000, +0.0000),
        float4(-0.7010, +0.5291, -0.8860, +1.0000));

    float y = luma.sample(s, in.uv).r;
    float2 cbcr = chroma.sample(s, in.uv).rg;
    return float4((ycbcrToRGB * float4(y, cbcr.x, cbcr.y, 1.0)).rgb, 1.0);
}

// MARK: - Portal
//
// The aperture is the window quad itself: it is rasterised in world space, so
// the hardware gives us a pixel-exact, correctly-perspective-projected opening
// for free. Its fragments sample the offscreen splat render at the SAME screen
// position, because both were drawn with the same camera matrices. No stencil
// buffer, no clip planes, no per-splat culling.
//
// This relies on all splats being behind the window plane, which the scene
// push-back guarantees, so no depth comparison is needed either.

struct PortalUniforms {
    float4x4 modelViewProjection;
    float2 viewportSize;
};

struct PortalVertex {
    float4 position [[position]];
};

vertex PortalVertex portalVertex(uint vertexID [[vertex_id]],
                                 constant PortalUniforms &uniforms [[buffer(0)]],
                                 constant float2 *corners [[buffer(1)]]) {
    PortalVertex out;
    out.position = uniforms.modelViewProjection * float4(corners[vertexID], 0.0, 1.0);
    return out;
}

fragment float4 portalFragment(PortalVertex in [[stage_in]],
                               constant PortalUniforms &uniforms [[buffer(0)]],
                               texture2d<float> splats [[texture(0)]]) {
    // [[position]] arrives as window coordinates in pixels, matching the splat
    // texture 1:1, so nearest sampling lands exactly on texel centres.
    constexpr sampler s(filter::nearest, address::clamp_to_edge);
    float2 uv = in.position.xy / uniforms.viewportSize;

    // MetalSplatter outputs premultiplied alpha; the pipeline blends with
    // (one, oneMinusSourceAlpha) to match.
    return splats.sample(s, uv);
}
