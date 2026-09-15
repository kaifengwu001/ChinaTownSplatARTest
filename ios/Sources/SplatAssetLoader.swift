import Metal
import MetalSplatter
import SplatIO
import simd
import spz

/// Decodes an SPZ file directly into a `SplatChunk`.
///
/// This deliberately avoids `SplatIO`'s reader, which cannot load a scene this
/// large on a phone. `SPZSceneReader.read()` builds its `AsyncThrowingStream`
/// with the synchronous closure initialiser and the default *unbounded*
/// buffering policy, so every batch is produced and queued before the consumer
/// reads any of them; `readAll()` then copies the lot into a second array. Each
/// `SplatPoint` also carries a heap-allocated array for its SH coefficients.
/// Loading 1.18M splats that way reached the 3.5GB per-process limit and was
/// killed by jetsam.
///
/// Unpacking one gaussian at a time into a preallocated buffer keeps peak usage
/// to the packed file plus the 32-bytes-per-splat GPU buffer. The per-gaussian
/// conversions mirror `SPZSceneReader` exactly, including the RUB to RDF
/// coordinate change, so the scene transform in `SceneConfig` still applies.
enum SplatAssetLoader {
    enum Failure: Error, LocalizedError {
        case emptyScene(URL)

        var errorDescription: String? {
            switch self {
            case .emptyScene(let url):
                return "The splat file at \(url.lastPathComponent) contains no points."
            }
        }
    }

    /// Unchecked because it only carries GPU-backed storage that is handed
    /// straight to the renderer and never mutated afterwards.
    struct Result: @unchecked Sendable {
        let chunk: SplatChunk
        let splatCount: Int
    }

    static func loadSPZ(url: URL, device: MTLDevice) throws -> Result {
        let packed = try loadSpzPacked(from: url)
        let count = Int(packed.numPoints)
        guard count > 0 else { throw Failure.emptyScene(url) }

        // SPZ stores RUB internally; RDF (x right, y down, z forward) is what
        // the PLY path produces and what the scene transform expects.
        let converter = coordinateConverter(from: .rub, to: .rdf)

        Diagnostics.log("spz unpacked header: \(count) points, sh degree \(packed.shDegree)")

        let splats = try MetalBuffer<EncodedSplatPoint>(device: device, capacity: count)
        Diagnostics.log("metal buffer allocated: \(count * 32 / 1_000_000)MB")

        for index in 0..<count {
            if index % 250_000 == 0 { Diagnostics.log("decoding \(index)/\(count)") }
            let g = packed.unpack(Int32(index), converter: converter)
            splats.values[index] = EncodedSplatPoint(
                position: g.position,
                // `color` is already the raw SH degree-0 coefficient.
                colorSH0: g.color,
                // SPZ stores alpha as a logit and scale as a log.
                opacity: 1 / (1 + exp(-g.alpha)),
                scale: exp(g.scale),
                rotation: simd_quatf(
                    ix: g.rotation.x, iy: g.rotation.y,
                    iz: g.rotation.z, r: g.rotation.w
                ).normalized)
        }
        splats.count = count
        Diagnostics.log("decode complete")

        // SHARP emits DC-only splats, so there are no higher-order bands to pass.
        return Result(
            chunk: SplatChunk(splats: splats, shCoefficients: nil, shDegree: .sh0),
            splatCount: count)
    }
}
