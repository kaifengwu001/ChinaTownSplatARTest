import ARKit
import Metal
import MetalKit
import MetalSplatter
import SplatIO
import simd

/// Renders the AR camera feed with a Gaussian splat scene visible through a
/// rectangular window floating in the room.
///
/// Two passes per frame:
///   1. MetalSplatter draws the whole splat scene into an offscreen texture,
///      clearing to transparent (its default) with premultiplied alpha.
///   2. To the drawable: camera feed as a full-screen backdrop, then the window
///      quad, whose fragments sample pass 1 at the same screen position.
///
/// The quad *is* the aperture, so the rasteriser does the masking. That avoids
/// needing a stencil buffer, clip planes, or per-splat culling, none of which
/// MetalSplatter supports (its splat pipeline uses depthCompareFunction .always
/// and clears whatever color target it is handed, which is why it renders
/// offscreen rather than straight over the camera).
final class PortalRenderer {
    enum Failure: Error, LocalizedError {
        case metalUnavailable
        case assetMissing(String)

        var errorDescription: String? {
            switch self {
            case .metalUnavailable:
                return "This device has no usable Metal device or shader library."
            case .assetMissing(let name):
                return "Bundled splat asset '\(name)' is missing from the app bundle."
            }
        }
    }

    private static let colorFormat: MTLPixelFormat = .bgra8Unorm

    private static let loadQueue = DispatchQueue(label: "splat-load", qos: .userInitiated)

    let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let cameraPipeline: MTLRenderPipelineState
    private let portalPipeline: MTLRenderPipelineState
    private let cameraTexture: CameraTexture

    private var splatRenderer: SplatRenderer?
    private var splatTexture: MTLTexture?

    /// Anchor for the window, set once the user places it. Nil means unplaced.
    private(set) var windowAnchor: simd_float4x4?

    var config = SceneConfig()

    /// Splats loaded, for the on-screen readout.
    private(set) var splatCount: Int = 0

    private var cameraUVs = [SIMD2<Float>](repeating: .zero, count: 4)

    /// Startup milestones are logged once each, not every frame.
    private var loggedFirstFrame = false
    private var loggedFirstSplatFrame = false

    init() throws {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let library = device.makeDefaultLibrary()
        else { throw Failure.metalUnavailable }

        self.device = device
        self.commandQueue = queue
        self.cameraTexture = try CameraTexture(device: device)

        cameraPipeline = try Self.makeCameraPipeline(device: device, library: library)
        portalPipeline = try Self.makePortalPipeline(device: device, library: library)
    }

    // MARK: - Setup

    private static func makeCameraPipeline(
        device: MTLDevice, library: MTLLibrary
    ) throws -> MTLRenderPipelineState {
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "cameraVertex")
        descriptor.fragmentFunction = library.makeFunction(name: "cameraFragment")
        descriptor.colorAttachments[0].pixelFormat = colorFormat
        return try device.makeRenderPipelineState(descriptor: descriptor)
    }

    private static func makePortalPipeline(
        device: MTLDevice, library: MTLLibrary
    ) throws -> MTLRenderPipelineState {
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "portalVertex")
        descriptor.fragmentFunction = library.makeFunction(name: "portalFragment")

        // Premultiplied-alpha "over", matching MetalSplatter's output.
        let attachment = descriptor.colorAttachments[0]!
        attachment.pixelFormat = colorFormat
        attachment.isBlendingEnabled = true
        attachment.rgbBlendOperation = .add
        attachment.alphaBlendOperation = .add
        attachment.sourceRGBBlendFactor = .one
        attachment.sourceAlphaBlendFactor = .one
        attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
        attachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha

        return try device.makeRenderPipelineState(descriptor: descriptor)
    }

    /// Loads the bundled splat scene. Slow (a 1.18M-splat file), so call off the
    /// main actor and show progress.
    func loadSplats(resource: String, extension ext: String) async throws {
        guard let url = Bundle.main.url(forResource: resource, withExtension: ext) else {
            throw Failure.assetMissing("\(resource).\(ext)")
        }

        // depthFormat .invalid: the portal needs no depth buffer, because the
        // scene push-back guarantees every splat is behind the window plane.
        let renderer = try SplatRenderer(
            device: device,
            colorFormat: Self.colorFormat,
            depthFormat: .invalid,
            sampleCount: 1,
            maxViewCount: 1,
            maxSimultaneousRenders: 3)

        // Decoding is a synchronous million-iteration loop. The caller is on the
        // main actor, so hop to a background queue explicitly rather than
        // relying on where a nonisolated async function happens to run.
        let device = self.device
        let loaded: SplatAssetLoader.Result = try await withCheckedThrowingContinuation {
            continuation in
            Self.loadQueue.async {
                do {
                    continuation.resume(
                        returning: try SplatAssetLoader.loadSPZ(url: url, device: device))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }

        Diagnostics.log("adding chunk to renderer")
        await renderer.addChunk(loaded.chunk)
        Diagnostics.log("chunk added")

        splatCount = loaded.splatCount
        splatRenderer = renderer
    }

    // MARK: - Placement

    /// Plants the window `windowDistance` ahead of the camera at its height,
    /// upright and facing the viewer.
    func placeWindow(using camera: ARCamera) {
        let eye = MatrixMath.position(of: camera.transform)
        let forward = MatrixMath.horizontalForward(of: camera.transform)
        windowAnchor = MatrixMath.uprightFrame(
            position: eye + forward * config.windowDistance, forward: forward)
        Diagnostics.log("window placed at \(eye + forward * config.windowDistance)")
    }

    func clearWindow() {
        windowAnchor = nil
    }

    // MARK: - Frame

    func draw(frame: ARFrame, in view: MTKView, viewportSize: CGSize) {
        guard let drawable = view.currentDrawable,
              let commandBuffer = commandQueue.makeCommandBuffer()
        else { return }

        if !loggedFirstFrame {
            loggedFirstFrame = true
            Diagnostics.log("first frame drawn at \(Int(viewportSize.width))x\(Int(viewportSize.height))")
        }

        updateCameraUVs(frame: frame, viewportSize: viewportSize)

        let projection = frame.camera.projectionMatrix(
            for: .portrait, viewportSize: viewportSize, zNear: 0.05, zFar: 400)
        let view4 = frame.camera.viewMatrix(for: .portrait)

        // Pass 1: splats offscreen, if placed and loaded.
        var splatsReady = false
        if let anchor = windowAnchor, let splatRenderer {
            let target = ensureSplatTexture(size: drawable.texture)
            let model = config.sceneModelMatrix(windowAnchor: anchor)

            // MetalSplatter has no model matrix, so the scene transform is
            // folded into the view. A *uniform* scale here is safe: the shader
            // builds 2D covariance from the view matrix's upper 3x3, so the
            // scale applies to splat footprints as well as positions.
            let viewport = SplatRenderer.ViewportDescriptor(
                viewport: MTLViewport(
                    originX: 0, originY: 0,
                    width: Double(target.width), height: Double(target.height),
                    znear: 0, zfar: 1),
                projectionMatrix: projection,
                viewMatrix: view4 * model,
                screenSize: SIMD2(target.width, target.height))

            do {
                splatsReady = try splatRenderer.render(
                    viewports: [viewport],
                    colorTexture: target,
                    colorStoreAction: .store,
                    depthTexture: nil,
                    rasterizationRateMap: nil,
                    renderTargetArrayLength: 0,
                    to: commandBuffer)

                if !loggedFirstSplatFrame {
                    loggedFirstSplatFrame = true
                    Diagnostics.log("first splat pass encoded (rendered=\(splatsReady))")
                }
            } catch {
                // A dropped splat frame should still show camera passthrough
                // rather than stalling the whole session.
                NSLog("Splat render failed: \(error.localizedDescription)")
                splatsReady = false
            }
        }

        // Pass 2: composite to the drawable.
        let descriptor = MTLRenderPassDescriptor()
        descriptor.colorAttachments[0].texture = drawable.texture
        descriptor.colorAttachments[0].loadAction = .dontCare
        descriptor.colorAttachments[0].storeAction = .store

        if let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) {
            drawCameraBackground(frame: frame, encoder: encoder)
            if splatsReady, let anchor = windowAnchor, let splatTexture {
                drawPortal(
                    encoder: encoder, splatTexture: splatTexture,
                    modelViewProjection: projection * view4 * anchor,
                    viewportSize: viewportSize)
            }
            encoder.endEncoding()
        }

        commandBuffer.present(drawable)
        commandBuffer.commit()
        cameraTexture.flushUnusedTextures()
    }

    private func drawCameraBackground(frame: ARFrame, encoder: MTLRenderCommandEncoder) {
        do {
            guard let planes = try cameraTexture.textures(from: frame.capturedImage) else { return }
            encoder.setRenderPipelineState(cameraPipeline)
            encoder.setVertexBytes(
                cameraUVs, length: MemoryLayout<SIMD2<Float>>.stride * 4, index: 0)
            encoder.setFragmentTexture(planes.luma, index: 0)
            encoder.setFragmentTexture(planes.chroma, index: 1)
            encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        } catch {
            NSLog("Camera background unavailable: \(error.localizedDescription)")
        }
    }

    private func drawPortal(
        encoder: MTLRenderCommandEncoder,
        splatTexture: MTLTexture,
        modelViewProjection: simd_float4x4,
        viewportSize: CGSize
    ) {
        var uniforms = PortalUniforms(
            modelViewProjection: modelViewProjection,
            viewportSize: SIMD2<Float>(Float(splatTexture.width), Float(splatTexture.height)))
        let corners = config.quadCorners

        encoder.setRenderPipelineState(portalPipeline)
        encoder.setVertexBytes(&uniforms, length: MemoryLayout<PortalUniforms>.stride, index: 0)
        encoder.setVertexBytes(
            corners, length: MemoryLayout<SIMD2<Float>>.stride * corners.count, index: 1)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<PortalUniforms>.stride, index: 0)
        encoder.setFragmentTexture(splatTexture, index: 0)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: corners.count)
    }

    // MARK: - Helpers

    /// Maps the full-screen quad's texture coordinates through ARKit's display
    /// transform so the captured image lands correctly in the viewport.
    private func updateCameraUVs(frame: ARFrame, viewportSize: CGSize) {
        let displayToCamera = frame
            .displayTransform(for: .portrait, viewportSize: viewportSize)
            .inverted()

        // Paired with the clip-space corner order in `cameraVertex`.
        let base = [
            CGPoint(x: 0, y: 1), CGPoint(x: 1, y: 1),
            CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0),
        ]
        for (index, point) in base.enumerated() {
            let mapped = point.applying(displayToCamera)
            cameraUVs[index] = SIMD2<Float>(Float(mapped.x), Float(mapped.y))
        }
    }

    private func ensureSplatTexture(size reference: MTLTexture) -> MTLTexture {
        if let existing = splatTexture,
           existing.width == reference.width, existing.height == reference.height {
            return existing
        }

        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: Self.colorFormat,
            width: reference.width, height: reference.height,
            mipmapped: false)
        descriptor.usage = [.renderTarget, .shaderRead]
        descriptor.storageMode = .private

        // Force-unwrap is acceptable: allocation only fails on OOM, at which
        // point the frame cannot be rendered by any path.
        let texture = device.makeTexture(descriptor: descriptor)!
        splatTexture = texture
        return texture
    }
}

/// Must match `PortalUniforms` in Shaders.metal.
private struct PortalUniforms {
    var modelViewProjection: simd_float4x4
    var viewportSize: SIMD2<Float>
}
