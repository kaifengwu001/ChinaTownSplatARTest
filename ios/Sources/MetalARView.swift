import MetalKit
import SwiftUI

/// Hosts an MTKView driven by the ARKit session's latest frame.
struct MetalARView: UIViewRepresentable {
    let viewModel: PortalViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel)
    }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView()
        view.device = viewModel.renderer?.device ?? MTLCreateSystemDefaultDevice()
        view.colorPixelFormat = .bgra8Unorm
        // No depth attachment: the portal masks geometrically, not by depth.
        view.depthStencilPixelFormat = .invalid
        view.sampleCount = 1
        view.preferredFramesPerSecond = 60
        view.isOpaque = true
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ uiView: MTKView, context: Context) {
        context.coordinator.viewModel = viewModel
    }

    final class Coordinator: NSObject, MTKViewDelegate {
        var viewModel: PortalViewModel
        private var drawableSize: CGSize = .zero

        init(viewModel: PortalViewModel) {
            self.viewModel = viewModel
        }

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
            drawableSize = size
        }

        func draw(in view: MTKView) {
            let size = drawableSize == .zero ? view.drawableSize : drawableSize
            guard size.width > 0, size.height > 0 else { return }

            // MTKView calls this on the main thread, so touching the main-actor
            // view model here is safe.
            MainActor.assumeIsolated {
                guard let renderer = viewModel.renderer,
                      let frame = viewModel.session.currentFrame
                else { return }

                renderer.draw(frame: frame, in: view, viewportSize: size)
                viewModel.recordFrame(at: CACurrentMediaTime())
            }
        }
    }
}
