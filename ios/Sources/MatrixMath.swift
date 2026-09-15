import simd

enum MatrixMath {
    static func translation(_ x: Float, _ y: Float, _ z: Float) -> simd_float4x4 {
        simd_float4x4(columns: (
            SIMD4<Float>(1, 0, 0, 0),
            SIMD4<Float>(0, 1, 0, 0),
            SIMD4<Float>(0, 0, 1, 0),
            SIMD4<Float>(x, y, z, 1),
        ))
    }

    static func scale(_ s: Float) -> simd_float4x4 {
        simd_float4x4(diagonal: SIMD4<Float>(s, s, s, 1))
    }

    static func rotationX(radians: Float) -> simd_float4x4 {
        let c = cos(radians)
        let s = sin(radians)
        return simd_float4x4(columns: (
            SIMD4<Float>(1, 0, 0, 0),
            SIMD4<Float>(0, c, s, 0),
            SIMD4<Float>(0, -s, c, 0),
            SIMD4<Float>(0, 0, 0, 1),
        ))
    }

    /// Position of the camera in world space, from an ARKit camera transform.
    static func position(of transform: simd_float4x4) -> SIMD3<Float> {
        SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
    }

    /// The camera's forward direction, flattened onto the horizontal plane.
    ///
    /// An ARKit camera looks down its local -Z, so column 2 negated is forward.
    /// Flattening keeps the window upright no matter how the phone is tilted.
    static func horizontalForward(of transform: simd_float4x4) -> SIMD3<Float> {
        let forward = -SIMD3<Float>(
            transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
        let flat = SIMD3<Float>(forward.x, 0, forward.z)
        // Looking straight down or up leaves nothing to project; fall back to -Z.
        return length(flat) < 1e-4 ? SIMD3<Float>(0, 0, -1) : normalize(flat)
    }

    /// An upright frame at `position` whose local -Z points along `forward`.
    static func uprightFrame(position: SIMD3<Float>, forward: SIMD3<Float>) -> simd_float4x4 {
        let zAxis = -normalize(forward) // local +Z faces back toward the viewer
        let yAxis = SIMD3<Float>(0, 1, 0)
        let xAxis = normalize(cross(yAxis, zAxis))
        return simd_float4x4(columns: (
            SIMD4<Float>(xAxis, 0),
            SIMD4<Float>(yAxis, 0),
            SIMD4<Float>(zAxis, 0),
            SIMD4<Float>(position, 1),
        ))
    }
}
