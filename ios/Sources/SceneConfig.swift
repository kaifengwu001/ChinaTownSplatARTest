import simd

/// Placement of the window and of the reconstructed scene behind it.
///
/// Defaults were tuned by eye in the desktop preview. Treated as a value type:
/// the UI replaces the whole struct rather than mutating shared state.
struct SceneConfig: Equatable {
    /// Aperture size in metres. A portrait phone camera sees only ~35 degrees
    /// horizontally, so the window must fit well inside that at its distance.
    var windowWidth: Float = 0.4
    var windowHeight: Float = 0.4

    /// How far in front of the viewer the window is planted.
    var windowDistance: Float = 1.28

    /// How far the scene sits behind the original capture point. SHARP's nearest
    /// content is ~1.5m from the capture point, so this must exceed
    /// `windowDistance` minus that, or the scene pokes through the aperture.
    var sceneOffsetZ: Float = 1.12
    var sceneOffsetY: Float = -1.4
    var sceneScale: Float = 0.99

    /// Re-aims the window at a different band of the photo by rotating about the
    /// capture point.
    var scenePitchDeg: Float = 11.56

    /// The sweeping bands and soft periphery from `SplatEffectSettings`.
    var effectsEnabled = true

    /// Transform from SHARP splat space into world space.
    ///
    /// Composition, right to left:
    ///   1. `rotationX(pi)`  - SHARP is OpenCV convention (y down, z forward
    ///      into the scene); ARKit is y-up with the camera looking down -z, and
    ///      a 180 degree turn about X fixes both axes at once.
    ///   2. `scale`          - uniform, so it also scales splat covariance
    ///      correctly when folded into the view matrix.
    ///   3. `pitch`          - aim, about the capture point.
    ///   4. `translation`    - push the capture point behind the window. The
    ///      window plane is the anchor origin, so the scene is offset by
    ///      (sceneOffsetZ - windowDistance) along the anchor's -Z.
    ///   5. `windowAnchor`   - places the whole thing in the room.
    func sceneModelMatrix(windowAnchor: simd_float4x4) -> simd_float4x4 {
        let behindWindow = -(sceneOffsetZ - windowDistance)
        let offset = MatrixMath.translation(0, sceneOffsetY, behindWindow)
        let pitch = MatrixMath.rotationX(radians: scenePitchDeg * .pi / 180)
        return windowAnchor * offset * pitch * MatrixMath.scale(sceneScale)
            * MatrixMath.rotationX(radians: .pi)
    }

    /// Spare angle before the viewer's movement reveals the hard edge where
    /// SHARP's reconstruction stops.
    ///
    /// SHARP fills roughly 1.18x the source photo's frustum and then ends
    /// abruptly. The source had no EXIF, so SHARP assumed a 30mm-equivalent lens
    /// (~61.9 degrees horizontal). Keep this positive.
    func headroomDegrees(movementBudget: Float = 0.5) -> Float {
        let toDegrees = 180 / Float.pi
        let available = atan(1.18 * tan(61.9 / 2 / toDegrees)) * toDegrees
        let needed = atan((windowWidth / 2 + movementBudget) / windowDistance) * toDegrees
        return available - needed
    }

    /// Aperture corners in anchor-local space, ordered as a triangle strip.
    var quadCorners: [SIMD2<Float>] {
        let x = windowWidth / 2
        let y = windowHeight / 2
        return [
            SIMD2<Float>(-x, -y),
            SIMD2<Float>(x, -y),
            SIMD2<Float>(-x, y),
            SIMD2<Float>(x, y),
        ]
    }
}
