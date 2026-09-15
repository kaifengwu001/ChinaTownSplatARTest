import ARKit
import Combine
import SwiftUI

/// Owns the AR session and the renderer, and exposes the tunable placement
/// parameters to the UI.
@MainActor
final class PortalViewModel: ObservableObject {
    enum LoadState: Equatable {
        case loading
        case ready(splatCount: Int)
        case failed(String)
    }

    @Published var loadState: LoadState = .loading
    @Published var isPlaced = false
    @Published var showControls = false
    @Published var frameRate: Double = 0

    /// Written to the renderer on every change; the render loop reads it directly.
    @Published var config = SceneConfig() {
        didSet { renderer?.config = config }
    }

    let session = ARSession()
    private(set) var renderer: PortalRenderer?

    private var frameTimestamps: [CFTimeInterval] = []

    init() {
        Diagnostics.startRun()
        do {
            renderer = try PortalRenderer()
            Diagnostics.log("renderer created")
        } catch {
            Diagnostics.log("renderer FAILED: \(error.localizedDescription)")
            loadState = .failed(error.localizedDescription)
        }
    }

    func start() {
        guard let renderer, case .loading = loadState else { return }

        guard ARWorldTrackingConfiguration.isSupported else {
            loadState = .failed("This device does not support ARKit world tracking.")
            return
        }

        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = []
        configuration.environmentTexturing = .none
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        Diagnostics.log("AR session running")

        renderer.config = config

        Task {
            do {
                try await renderer.loadSplats(resource: "chop_suey", extension: "spz")
                Diagnostics.log("splats ready: \(renderer.splatCount)")
                loadState = .ready(splatCount: renderer.splatCount)
            } catch {
                Diagnostics.log("splat load FAILED: \(error.localizedDescription)")
                loadState = .failed(error.localizedDescription)
            }
        }
    }

    func pause() {
        session.pause()
    }

    /// Plant the window ahead of wherever the phone is currently pointing.
    func placeWindow() {
        guard let renderer, let frame = session.currentFrame else { return }
        renderer.placeWindow(using: frame.camera)
        isPlaced = true
    }

    func resetWindow() {
        renderer?.clearWindow()
        isPlaced = false
    }

    /// Rolling average over the last second, for the on-screen readout.
    func recordFrame(at timestamp: CFTimeInterval) {
        frameTimestamps.append(timestamp)
        frameTimestamps.removeAll { timestamp - $0 > 1.0 }
        if let first = frameTimestamps.first, timestamp > first {
            frameRate = Double(frameTimestamps.count - 1) / (timestamp - first)
        }
    }
}
