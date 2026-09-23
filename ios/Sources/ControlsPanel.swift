import SwiftUI

/// On-device sliders mirroring the desktop preview, so placement can be retuned
/// in the room rather than by rebuilding.
struct ControlsPanel: View {
    @Binding var config: SceneConfig

    var body: some View {
        VStack(spacing: 6) {
            slider("window width", value: $config.windowWidth, in: 0.1...4, unit: "m")
            slider("window height", value: $config.windowHeight, in: 0.2...4, unit: "m")
            slider("window distance", value: $config.windowDistance, in: 1...8, unit: "m")
            slider("scene push-back", value: $config.sceneOffsetZ, in: 0...12, unit: "m")
            slider("scene pitch", value: $config.scenePitchDeg, in: -25...25, unit: "°")
            slider("scene offset Y", value: $config.sceneOffsetY, in: -6...6, unit: "m")
            slider("scene scale", value: $config.sceneScale, in: 0.1...4, unit: "x")

            Button("Reset to tuned defaults") { config = SceneConfig() }
                .font(.system(.caption2, design: .monospaced))
                .padding(.top, 2)
        }
        .padding(12)
        .background(.black.opacity(0.7), in: .rect(cornerRadius: 10))
    }

    private func slider(
        _ label: String, value: Binding<Float>, in range: ClosedRange<Float>, unit: String
    ) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text(label)
                Spacer()
                Text("\(value.wrappedValue, specifier: "%.2f")\(unit)")
                    .foregroundStyle(.cyan)
            }
            .font(.system(size: 10, design: .monospaced))

            Slider(value: value, in: range)
                .controlSize(.mini)
        }
        .foregroundStyle(.white)
    }
}
