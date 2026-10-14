import { DEFAULTS } from "../config.js";
import { MEMORY_SETTINGS, MEMORY_TUNING_PARAMETERS } from "../memory-settings.js";

const format = ({ unit }, value) => unit === "photoWidth" ? `${(value*DEFAULTS.windowWidth).toFixed(2)} m`
  : unit === "portalWidth" ? `${(value*DEFAULTS.windowWidth).toFixed(2)} m`
  : unit === "portalHeight" ? `${(value*DEFAULTS.windowHeight).toFixed(2)} m`
  : unit === "m" || unit === "s" ? `${value.toFixed(2)} ${unit}`
  : unit === "deg" ? `${value.toFixed(1)}°`
  : unit === "count" ? value.toLocaleString("en-US")
  : unit === "px" ? `${value.toFixed(1)} px`
  : unit === "percent" ? `${Math.round(value*100)}%` : `${value.toFixed(2)}×`;

const TUNING_MARKUP = "    <button id=\"ar-tune-toggle\" type=\"button\" aria-controls=\"ar-tuning\" aria-expanded=\"false\" disabled>Tune</button>\n    <section id=\"ar-tuning\" aria-label=\"Live AR tuning\" hidden>\n      <div class=\"ar-tune-heading\"><strong>Live tuning</strong><button id=\"ar-tune-close\" type=\"button\">Hide</button></div>\n      <nav id=\"ar-tune-tabs\" role=\"tablist\" aria-label=\"Tuning category\"></nav>\n      <fieldset id=\"ar-tune-sliders\"></fieldset>\n      <label class=\"ar-tune-timeline\" for=\"ar-tune-time\">Activation <output id=\"ar-tune-time-value\">0.0s</output><input id=\"ar-tune-time\" type=\"range\" min=\"0\" max=\"6.15\" step=\"0.01\" value=\"0\" disabled /></label>\n      <div class=\"ar-tune-footer\">\n        <fieldset id=\"ar-tune-actions\" disabled><button id=\"ar-tune-original\" type=\"button\">Original</button><button id=\"ar-tune-replay\" type=\"button\">Replay</button><button id=\"ar-tune-loop\" type=\"button\" aria-pressed=\"false\">Loop ripple</button></fieldset>\n        <button id=\"ar-tune-defaults\" type=\"button\">Defaults</button><button id=\"ar-tune-copy\" type=\"button\">Copy link</button>\n      </div>\n    </section>\n";

/** A dedicated dock below the camera; tuning gestures never place a window. */
export function createArTuning(memory, anchor) {
  if (!document.getElementById("ar-tuning")) document.body.insertAdjacentHTML("beforeend",TUNING_MARKUP);
  const panel = document.getElementById("ar-tuning");
  const toggle = document.getElementById("ar-tune-toggle");
  const tabs = document.getElementById("ar-tune-tabs");
  const sliders = document.getElementById("ar-tune-sliders");
  const timeline = document.getElementById("ar-tune-time");
  const time = document.getElementById("ar-tune-time-value");
  const actions = document.getElementById("ar-tune-actions");
  const inputs = new Map();
  const groups = [...new Set(MEMORY_TUNING_PARAMETERS.map(p => p.group))];
  let group = groups[0];
  let loopStart = null;

  const dockSize = () => {
    const height = panel.hidden ? 0 : Math.ceil(document.documentElement.clientHeight-panel.getBoundingClientRect().top);
    const value = `${height}px`;
    if (document.body.style.getPropertyValue("--tuning-height") !== value) document.body.style.setProperty("--tuning-height",value);
  };
  function open(value) {
    panel.hidden = !value;
    toggle.hidden = value;
    toggle.setAttribute("aria-expanded",String(value));
    document.body.classList.toggle("tuning-open",value);
    dockSize();
  }
  toggle.addEventListener("click",() => open(true));
  document.getElementById("ar-tune-close").addEventListener("click",() => open(false));
  // ResizeObserver callbacks must not synchronously resize another observed
  // element (the camera canvas), which raises a loop error on orientation changes.
  let dockFrame = null;
  new ResizeObserver(() => {
    if (dockFrame !== null) return;
    dockFrame = requestAnimationFrame(() => { dockFrame = null; dockSize(); });
  }).observe(panel);
  // The panel is a sibling of the camera canvas; stop bubbling as well for
  // future screen-level gesture handlers and touch-based slider interaction.
  for (const event of ["click","pointerdown","pointerup","touchstart","touchend"]) panel.addEventListener(event,e => e.stopPropagation());

  function refreshValues() {
    const values = memory.getSettings();
    for (const parameter of MEMORY_TUNING_PARAMETERS) {
      const row = inputs.get(parameter.key);
      row.input.value = values[parameter.key];
      row.output.textContent = format(parameter,values[parameter.key]);
    }
  }
  function saveLink() {
    const url = new URL(window.location.href);
    const values = memory.getSettings();
    for (const { key } of MEMORY_TUNING_PARAMETERS) url.searchParams.set(key,values[key]);
    // AR always starts with placement and the original, rather than a frozen
    // desktop review frame or a frozen ambient-effects clock.
    url.searchParams.delete("t"); url.searchParams.delete("fxTime");
    history.replaceState(null,"",url);
    return url.href;
  }
  function showGroup() {
    for (const parameter of MEMORY_TUNING_PARAMETERS) inputs.get(parameter.key).row.hidden = parameter.group !== group;
    for (const button of tabs.children) button.setAttribute("aria-selected",String(button.textContent === group));
    sliders.setAttribute("aria-label",`${group} tuning`);
    sliders.scrollTop = 0;
  }
  for (const name of groups) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = name; button.setAttribute("role","tab");
    button.addEventListener("click",() => { group = name; showGroup(); });
    tabs.append(button);
  }
  for (const parameter of MEMORY_TUNING_PARAMETERS) {
    const { key,label,min,max,step } = parameter;
    const row = document.createElement("label"); row.className = "ar-tune-row";
    const text = document.createElement("span"); text.textContent = label;
    const output = document.createElement("output");
    const input = document.createElement("input"); input.type = "range";
    input.id = `ar-tune-${key}`; input.min = min; input.max = max; input.step = step;
    input.setAttribute("aria-label",label); row.htmlFor = input.id; output.htmlFor = input.id;
    row.append(text,output,input); sliders.append(row);
    inputs.set(key,{ row,input,output });
    input.addEventListener("input",() => {
      const next = { [key]:Number(input.value) };
      const current = memory.getSettings();
      if (key === "particleSizeMin") next.particleSizeMax = Math.max(current.particleSizeMax,next.particleSizeMin);
      if (key === "particleSizeMax") next.particleSizeMin = Math.min(current.particleSizeMin,next.particleSizeMax);
      memory.setTuning(next); refreshValues(); saveLink();
    });
  }
  const stopLoop = () => { loopStart = null; document.getElementById("ar-tune-loop").setAttribute("aria-pressed","false"); };
  timeline.addEventListener("input",() => { stopLoop(); memory.seek(Number(timeline.value)); });
  document.getElementById("ar-tune-original").addEventListener("click",() => { stopLoop(); memory.reset(); });
  document.getElementById("ar-tune-replay").addEventListener("click",() => { stopLoop(); memory.reset(); memory.activate(); });
  document.getElementById("ar-tune-loop").addEventListener("click",() => {
    if (loopStart !== null) { stopLoop(); return; }
    loopStart = performance.now()/1000;
    document.getElementById("ar-tune-loop").setAttribute("aria-pressed","true");
  });
  document.getElementById("ar-tune-defaults").addEventListener("click",() => {
    memory.setTuning(Object.fromEntries(MEMORY_TUNING_PARAMETERS.map(({key}) => [key,MEMORY_SETTINGS[key]])));
    refreshValues(); saveLink();
  });
  document.getElementById("ar-tune-copy").addEventListener("click",async event => {
    const button = event.currentTarget;
    try { await navigator.clipboard.writeText(saveLink()); button.textContent = "Copied"; }
    catch { button.textContent = "Copy address"; }
    setTimeout(() => { button.textContent = "Copy link"; },2000);
  });
  refreshValues(); showGroup(); toggle.disabled = false;
  const paint = () => {
    const enabled = memory.ready && anchor.visible;
    actions.disabled = !enabled; timeline.disabled = !enabled;
    timeline.max = memory.duration;
    timeline.value = Math.min(memory.frame.seconds,memory.duration);
    time.textContent = `${Math.min(memory.frame.seconds,memory.duration).toFixed(1)}s`;
  };
  paint();
  return {
    update(now) {
      if (loopStart !== null && memory.ready && anchor.visible) memory.seek((now-loopStart)%memory.getSettings().colorDuration);
      paint();
    },
    stop: stopLoop,
  };
}
