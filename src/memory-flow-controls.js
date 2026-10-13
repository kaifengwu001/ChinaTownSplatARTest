import { MEMORY_SETTINGS, PARTICLE_FLOW_PARAMETERS } from "./memory-settings.js";

const format = ({ unit }, value) => unit === "count" ? value.toLocaleString("en-US")
  : unit === "px" ? `${value.toFixed(1)} px`
  : unit === "percent" ? `${Math.round(value*100)}%` : `${value.toFixed(2)}×`;

/** Live tuning controls; the same settings are accepted by the phone AR page. */
export function createMemoryFlowControls(memory, settings, onPlay = () => {}) {
  const panel = document.getElementById("particle-flow");
  const fieldset = document.getElementById("flow-sliders");
  const preview = document.getElementById("ripple-preview");
  const reset = document.getElementById("flow-reset");
  const copy = document.getElementById("flow-copy");
  const sceneControls = document.getElementById("scene-controls");
  const primaryPanel = document.getElementById("preview-controls");
  const compact = window.matchMedia("(max-width: 1100px)");
  const controls = new Map();
  let values = Object.fromEntries(PARTICLE_FLOW_PARAMETERS.map(({ key }) => [key,settings[key]]));
  let loopStarted = null;

  function refresh() {
    for (const parameter of PARTICLE_FLOW_PARAMETERS) {
      const { input, output } = controls.get(parameter.key);
      input.value = values[parameter.key];
      output.textContent = format(parameter,values[parameter.key]);
    }
  }

  function saveLink() {
    const url = new URL(window.location.href);
    for (const { key } of PARTICLE_FLOW_PARAMETERS) url.searchParams.set(key,values[key]);
    for (const [key,id] of [["depthStretch","depth-stretch"],["parallaxGain","parallax-gain"],["flatEffectStrength","flat-effects"]]) {
      url.searchParams.set(key,document.getElementById(id).value);
    }
    // Save the inspected frame too, so a tuning link opens at a useful moment.
    url.searchParams.set("t",Math.min(memory.frame.seconds,memory.duration).toFixed(2));
    history.replaceState(null,"",url);
    return url.href;
  }

  function stopPreview() {
    loopStarted = null;
    preview.textContent = "Preview ripple";
    preview.setAttribute("aria-pressed","false");
  }

  function startPreview() {
    const phase = memory.frame.phase === "colorizing" ? memory.frame.seconds : settings.colorDuration/2;
    loopStarted = performance.now()/1000-phase;
    memory.seek(phase);
    preview.textContent = "Pause ripple";
    preview.setAttribute("aria-pressed","true");
    // A comparison clock must not silently freeze normal preview playback.
    onPlay();
    const url = new URL(window.location.href);
    url.searchParams.delete("fxTime");
    history.replaceState(null,"",url);
    saveLink();
  }

  function apply(next) {
    memory.setParticleFlow(next);
    values = next;
    refresh();
    if (memory.frame.phase !== "colorizing") startPreview();
    saveLink();
  }

  for (const parameter of PARTICLE_FLOW_PARAMETERS) {
    const { key, label, min, max, step } = parameter;
    const row = document.createElement("label");
    row.className = "flow-label";
    const input = document.createElement("input");
    input.type = "range";
    input.id = key.replace(/[A-Z]/g,letter => `-${letter.toLowerCase()}`);
    input.min = min; input.max = max; input.step = step;
    input.setAttribute("aria-label",label);
    row.htmlFor = input.id;
    const name = document.createElement("span");
    name.textContent = label;
    const output = document.createElement("output");
    output.htmlFor = input.id;
    row.append(name,output,input);
    fieldset.append(row);
    controls.set(key,{ input,output });
    input.addEventListener("input",() => {
      const next = { ...values,[key]:Number(input.value) };
      // Moving either size boundary past the other carries it along.
      if (key === "particleSizeMin") next.particleSizeMax = Math.max(next.particleSizeMax,next.particleSizeMin);
      if (key === "particleSizeMax") next.particleSizeMin = Math.min(next.particleSizeMin,next.particleSizeMax);
      apply(next);
    });
  }
  refresh();
  fieldset.disabled = false;
  for (const button of [preview,reset,copy]) button.disabled = false;
  preview.setAttribute("aria-pressed","false");
  preview.addEventListener("click",() => loopStarted === null ? startPreview() : stopPreview());
  reset.addEventListener("click",() => apply(Object.fromEntries(PARTICLE_FLOW_PARAMETERS.map(({ key }) => [key,MEMORY_SETTINGS[key]]))));
  copy.addEventListener("click",async () => {
    try {
      await navigator.clipboard.writeText(saveLink());
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Copy URL";
    }
    setTimeout(() => { copy.textContent = "Copy link"; },2000);
  });
  document.getElementById("timeline").addEventListener("input",stopPreview);
  document.getElementById("replay").addEventListener("click",stopPreview);

  function layout() {
    if (compact.matches) primaryPanel.append(panel);
    else document.body.append(panel);
    sceneControls.hidden = compact.matches && panel.open;
  }
  panel.addEventListener("toggle",layout);
  compact.addEventListener("change",layout);
  layout();

  return {
    update(now) { if (loopStarted !== null) memory.seek((now-loopStarted)%settings.colorDuration); },
  };
}
