import { DEFAULTS, update } from "./config.js";

const SLIDERS = [
  { key: "windowWidth", label: "window width", min: 0.1, max: 4, step: 0.05, unit: "m" },
  { key: "windowHeight", label: "window height", min: 0.2, max: 3, step: 0.05, unit: "m" },
  { key: "windowDistance", label: "window distance", min: 1, max: 8, step: 0.05, unit: "m" },
  { key: "sceneOffsetZ", label: "scene push-back", min: 0, max: 12, step: 0.1, unit: "m" },
  { key: "scenePitchDeg", label: "scene pitch (aim)", min: -25, max: 25, step: 0.5, unit: "deg" },
  { key: "sceneOffsetY", label: "scene offset Y", min: -6, max: 6, step: 0.05, unit: "m" },
  { key: "sceneScale", label: "scene scale", min: 0.1, max: 4, step: 0.05, unit: "x" },
  { key: "eyeOffsetX", label: "eye offset X", min: -2, max: 2, step: 0.01, unit: "m" },
  { key: "swayAmplitude", label: "sway amplitude", min: 0, max: 2, step: 0.05, unit: "m" },
  { key: "swayPeriod", label: "sway period", min: 1, max: 20, step: 0.5, unit: "s" },
  { key: "cameraFovY", label: "camera FOV (vert)", min: 20, max: 100, step: 1, unit: "deg" },
];

/**
 * Builds the control panel. Calls `onChange(newConfig)` with a fresh config
 * object on every interaction; never mutates the config it is given.
 */
export function buildPanel(root, initial, onChange) {
  let config = initial;
  const emit = (key, value) => {
    config = update(config, key, value);
    onChange(config);
  };

  root.innerHTML = `<h2>SHARP parallax window</h2>`;

  const modeGroup = document.createElement("div");
  modeGroup.className = "group";
  for (const [mode, label] of [
    ["window", "Window preview"],
    ["free", "Free look (WASD + drag)"],
  ]) {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.active = String(initial.mode === mode);
    b.onclick = () => {
      for (const sib of modeGroup.querySelectorAll("button")) sib.dataset.active = "false";
      b.dataset.active = "true";
      emit("mode", mode);
    };
    modeGroup.appendChild(b);
  }
  root.appendChild(modeGroup);

  const toggles = document.createElement("div");
  toggles.className = "group";
  for (const [key, label] of [
    ["swayEnabled", "Auto sway"],
    ["showMatte", "Show window matte"],
    ["trackWindow", "Face the window"],
  ]) {
    const b = document.createElement("button");
    const paint = () => {
      b.dataset.active = String(config[key]);
      b.textContent = `${label}: ${config[key] ? "on" : "off"}`;
    };
    b.onclick = () => {
      emit(key, !config[key]);
      paint();
    };
    paint();
    toggles.appendChild(b);
  }
  root.appendChild(toggles);

  const sliderGroup = document.createElement("div");
  sliderGroup.className = "group";
  for (const s of SLIDERS) {
    const label = document.createElement("label");
    const readout = `<span class="val" data-val="${s.key}">${initial[s.key]}${s.unit}</span>`;
    label.innerHTML = `<span class="row"><span>${s.label}</span>${readout}</span>`;
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: s.min, max: s.max, step: s.step });
    input.value = initial[s.key];
    input.oninput = () => {
      const v = Number(input.value);
      label.querySelector("[data-val]").textContent = `${v}${s.unit}`;
      emit(s.key, v);
    };
    label.appendChild(input);
    sliderGroup.appendChild(label);
  }
  root.appendChild(sliderGroup);

  const reset = document.createElement("div");
  reset.className = "group";
  const rb = document.createElement("button");
  rb.textContent = "Reset to AR target (2x1m @ 3m)";
  rb.onclick = () => window.location.reload();
  reset.appendChild(rb);
  root.appendChild(reset);

  const note = document.createElement("p");
  note.className = "note";
  note.textContent =
    "SHARP reconstructs ~1.18x the photo frustum, then stops dead. " +
    "Headroom below must stay positive or the sway will reveal that hard edge.";
  root.appendChild(note);

  return () => config;
}

export function renderHud(el, config, geo, splatCount) {
  const fmt = (n, d = 1) => n.toFixed(d);
  el.textContent = [
    `splats            ${splatCount ? splatCount.toLocaleString() : "-"}`,
    `window subtends   ${fmt(geo.windowHalfCone * 2)} deg H  /  ${fmt(geo.vSubtenseDeg)} deg V`,
    `cone needed       ${fmt(geo.neededHalfCone)} deg   (half-cone, incl. sway)`,
    `cone available    ${fmt(geo.availableHalfCone)} deg   (SHARP reconstruction limit)`,
    `headroom          ${fmt(geo.headroomDeg)} deg ${geo.headroomDeg < 0 ? "  << WILL CLIP" : ""}`,
    `nearest content   ${fmt(geo.nearestContentZ)} m   (window at ${fmt(-config.windowDistance)} m)`,
  ].join("\n");
}

export { DEFAULTS };
