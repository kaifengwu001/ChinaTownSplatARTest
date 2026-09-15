import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = PortalViewModel()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if case .failed = viewModel.loadState {
                // Nothing to render; the message below explains why.
            } else {
                MetalARView(viewModel: viewModel)
                    .ignoresSafeArea()
                    .onTapGesture { viewModel.placeWindow() }
            }

            VStack {
                statusBar
                Spacer()
                if viewModel.showControls {
                    ControlsPanel(config: $viewModel.config)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                buttonRow
            }
            .padding()
        }
        .onAppear { viewModel.start() }
        .onDisappear { viewModel.pause() }
        .animation(.easeInOut(duration: 0.2), value: viewModel.showControls)
    }

    private var statusBar: some View {
        VStack(alignment: .leading, spacing: 2) {
            switch viewModel.loadState {
            case .loading:
                Label("Loading splats…", systemImage: "hourglass")
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            case .ready(let count):
                Text("\(count.formatted()) splats · \(viewModel.frameRate, specifier: "%.0f") fps")
                if !viewModel.isPlaced {
                    Text("Tap anywhere to place the window")
                        .foregroundStyle(.secondary)
                } else {
                    let headroom = viewModel.config.headroomDegrees()
                    Text("headroom \(headroom, specifier: "%.1f")°")
                        .foregroundStyle(headroom < 0 ? .orange : .secondary)
                }
            }
        }
        .font(.system(.caption, design: .monospaced))
        .foregroundStyle(.white)
        .padding(10)
        .background(.black.opacity(0.55), in: .rect(cornerRadius: 8))
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var buttonRow: some View {
        HStack {
            Button {
                viewModel.isPlaced ? viewModel.resetWindow() : viewModel.placeWindow()
            } label: {
                Label(
                    viewModel.isPlaced ? "Reset" : "Place window",
                    systemImage: viewModel.isPlaced ? "arrow.counterclockwise" : "square.dashed")
            }

            Spacer()

            Button {
                viewModel.showControls.toggle()
            } label: {
                Label("Tune", systemImage: "slider.horizontal.3")
            }
        }
        .font(.system(.footnote, design: .monospaced))
        .buttonStyle(.borderedProminent)
        .tint(.black.opacity(0.6))
    }
}
