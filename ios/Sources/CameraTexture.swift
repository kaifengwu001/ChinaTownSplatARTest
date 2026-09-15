import CoreVideo
import Metal

/// Wraps an ARKit captured frame's two planes as Metal textures.
///
/// `ARFrame.capturedImage` is a YCbCr 4:2:0 biplanar pixel buffer, so it needs
/// two textures: R8 luma and RG8 chroma at half resolution.
final class CameraTexture {
    enum Failure: Error, LocalizedError {
        case textureCacheUnavailable
        case planeConversionFailed(plane: Int)

        var errorDescription: String? {
            switch self {
            case .textureCacheUnavailable:
                return "Could not create a Metal texture cache for the camera feed."
            case .planeConversionFailed(let plane):
                return "Could not wrap camera image plane \(plane) as a Metal texture."
            }
        }
    }

    private let cache: CVMetalTextureCache

    /// Retained for the lifetime of the frame: CVMetalTexture owns the
    /// MTLTexture, and releasing it early invalidates the texture mid-draw.
    private var retained: [CVMetalTexture] = []

    init(device: MTLDevice) throws {
        var cache: CVMetalTextureCache?
        let status = CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &cache)
        guard status == kCVReturnSuccess, let cache else {
            throw Failure.textureCacheUnavailable
        }
        self.cache = cache
    }

    /// Converts both planes. Returns nil if the buffer is not biplanar.
    func textures(from pixelBuffer: CVPixelBuffer) throws -> (luma: MTLTexture, chroma: MTLTexture)? {
        guard CVPixelBufferGetPlaneCount(pixelBuffer) == 2 else { return nil }

        retained.removeAll(keepingCapacity: true)
        let luma = try texture(from: pixelBuffer, plane: 0, format: .r8Unorm)
        let chroma = try texture(from: pixelBuffer, plane: 1, format: .rg8Unorm)
        return (luma, chroma)
    }

    private func texture(
        from pixelBuffer: CVPixelBuffer, plane: Int, format: MTLPixelFormat
    ) throws -> MTLTexture {
        let width = CVPixelBufferGetWidthOfPlane(pixelBuffer, plane)
        let height = CVPixelBufferGetHeightOfPlane(pixelBuffer, plane)

        var cvTexture: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault, cache, pixelBuffer, nil,
            format, width, height, plane, &cvTexture)

        guard status == kCVReturnSuccess,
              let cvTexture,
              let metalTexture = CVMetalTextureGetTexture(cvTexture)
        else {
            throw Failure.planeConversionFailed(plane: plane)
        }

        retained.append(cvTexture)
        return metalTexture
    }

    func flushUnusedTextures() {
        CVMetalTextureCacheFlush(cache, 0)
    }
}
