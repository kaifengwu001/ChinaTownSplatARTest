import Foundation
import MetalSplatter

/// The dreamlike per-splat effects: bands sweeping outward that swell splats at
/// their front and shrink them behind, and a soft translucent periphery.
///
/// Values were tuned by eye in Mattercraft and mirror `DEFAULT_EFFECT_SETTINGS`
/// in mattercraft/splatEffectUniforms.ts, which the WebAR page also uses; so
/// does the timing below. Distances are in splat units (SHARP's own).
struct SplatEffectSettings: Equatable {
    var bandNear: Float = 12
    var bandFar: Float = 150
    /// Seconds between one band launching and the next.
    var bandPeriod: Float = 4
    /// Share of the near-to-far course a band covers per second.
    var bandSpeed: Float = 0.05
    /// Depth of each side of a band, in log(distance).
    var bandFrontWidth: Float = 0.2
    var bandBackWidth: Float = 0.2
    /// Extra size at the front's peak; 1 doubles it.
    var bandFrontGrow: Float = 1.75
    /// Share of size lost at the back's deepest point, 0 to 1.
    var bandBackShrink: Float = 0.12
    var bandBrightness: Float = 0.5

    var peripherySharpDegrees: Float = 5
    var peripherySoftDegrees: Float = 22
    var peripheryGrow: Float = 0.2
    var peripheryOpacity: Float = 0.5

    /// Share of the course over which a band fades in, and again out.
    private static let bandEdgeFade: Float = 0.1

    /// Shader parameters at `seconds` into the animation. Invalid values fall
    /// back to the defaults rather than producing NaNs on the GPU.
    func parameters(atSeconds seconds: Double) -> SplatEffectParameters {
        let d = SplatEffectSettings()
        var p = SplatEffectParameters()

        let logNear = log(Self.positive(bandNear, d.bandNear))
        let logFar = max(log(Self.positive(bandFar, d.bandFar)), logNear + 0.01)
        let course = logFar - logNear
        let speed = Double(Self.positive(bandSpeed, d.bandSpeed) * course)
        let spacing = speed * Double(Self.positive(bandPeriod, d.bandPeriod))

        p.bandEnabled = 1
        p.bandLogNear = logNear
        p.bandLogFar = logFar
        p.bandSpacing = Float(spacing)
        // In Double: seconds keeps growing, and Float would lose the fraction.
        p.bandShift = Float((speed * seconds).truncatingRemainder(dividingBy: spacing))
        p.bandEdgeFade = Self.bandEdgeFade * course
        p.bandFrontWidth = Self.positive(bandFrontWidth, d.bandFrontWidth)
        p.bandBackWidth = Self.positive(bandBackWidth, d.bandBackWidth)
        p.bandFrontGrow = max(0, bandFrontGrow)
        p.bandBackShrink = min(max(bandBackShrink, 0), 1)
        p.bandBrightness = max(0, bandBrightness)

        let sharp = min(max(peripherySharpDegrees, 0), 89)
        let soft = min(max(peripherySoftDegrees, sharp + 0.1), 90)
        p.peripheryEnabled = 1
        p.peripheryCosSharp = cos(sharp * .pi / 180)
        p.peripheryCosSoft = cos(soft * .pi / 180)
        p.peripheryGrow = max(0, peripheryGrow)
        p.peripheryOpacity = min(max(peripheryOpacity, 0), 1)
        return p
    }

    private static func positive(_ value: Float, _ fallback: Float) -> Float {
        value.isFinite && value > 0 ? value : fallback
    }
}
