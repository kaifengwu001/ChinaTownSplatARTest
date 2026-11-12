// The photographs of people who lived around Apalabassa St.: a loose pile of
// prints in the corner of the screen while the viewer lines up the street,
// and the album the pile opens. Peter SooHoo's print, on top, leaves the pile
// for the street when the match is made: `launch` hands it to a 3D card.

// The motion is the stageshow kit's. Prints arrive from nowhere on its
// arrival curve and leave on its travel curve. A print that grows or shrinks
// as it travels flies on its Fly, x and y on different curves for a soft
// arc, with a lift that is gone before a soft landing.
const ARRIVE = "cubic-bezier(0.25, 0.8, 0.25, 1)";
const TRAVEL = "cubic-bezier(0.45, 0, 0.1, 1)";
const FLY_X = "cubic-bezier(0.35, 0, 0.2, 1)";
const FLY_Y = "cubic-bezier(0.3, 0.6, 0.15, 1)";
const LIFT = "cubic-bezier(0.33, 1, 0.68, 1)";
const DEAL_MS = 800, DEAL_STAGGER = 60, EXIT_MS = 380, EXIT_STAGGER = 50;
// Tiles of a grid go 80 to 120 ms apart, and a print that grows as it
// travels takes 600 ms or more.
const OPEN_MS = 700, OPEN_STAGGER = 90, CLOSE_MS = 560, CLOSE_STAGGER = 60;
const FOCUS_MS = 760, UNFOCUS_MS = 600, RECEDE_MS = 300, RETURN_MS = 420, RETURN_DELAY = 180;
// After a launch the rest of the pile follows the departing print out.
const LAUNCH_EXIT_DELAY = 150;
// When the match is made the rest of the pile steps aside first, quickly and
// nearly together, while Peter's print waits alone, its shadow lifting; once
// nothing lies over it the 3D card takes its place.
const DEPART_MS = 360, DEPART_STAGGER = 20;
// The pile waits this long before leaving, so a moment's lost match doesn't flicker it.
const HIDE_GRACE = 250;
// Held flat, the phone's quarter turn is noise; the open album follows a
// new one only once it has held this long.
const TURN_SETTLE = 350;
// A print's cream border, as a share of its photograph's height.
const BORDER = 0.045;
const EDGE = 24, HEADER = 56;
// A loose pile, bottom print first and the arriving one last: small tilts,
// and shifts as shares of the pile's size.
const TILTS = [-9, 6, -4, 8, -6, 3, 10, -3];
const SHIFTS = [[-0.07, 0.04], [0.06, -0.03], [-0.03, 0.06], [0.05, 0.01], [-0.05, -0.04], [0.03, 0.05], [0.02, -0.03], [0, 0]];
const DEGREE = Math.PI/180;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function matrixOf(element) {
  const value = getComputedStyle(element).transform;
  return value && value !== "none" ? new DOMMatrixReadOnly(value) : new DOMMatrixReadOnly();
}

// The page's safe-area insets, which are the portrait screen's while the page
// stays upright, moved onto the edges of the screen as held.
function heldInsets(probe, turn) {
  const style = getComputedStyle(probe);
  const page = ["Top", "Right", "Bottom", "Left"].map(side => parseFloat(style[`padding${side}`]) || 0);
  const quarter = ((Math.round(turn/90) % 4)+4) % 4;
  return { top: page[quarter], right: page[(1+quarter) % 4], bottom: page[(2+quarter) % 4], left: page[(3+quarter) % 4] };
}

/**
 * The pile of photographs in the bottom-right corner of the screen as the
 * phone is held, and the album it opens. `update` shows or hides the pile and
 * keeps it upright every frame; `launch` hands Peter's print to the 3D card
 * that flies it into the photograph; `albumOpen` says the album covers the
 * street, so the match should wait.
 */
export function createMemoryCards(root, people) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const time = ms => reduced?.matches ? 0 : ms;
  const element = (tag, className, parent) => {
    const node = document.createElement(tag);
    node.className = className;
    parent?.append(node);
    return node;
  };
  const container = element("div", "memory-cards");
  const probe = element("div", "memory-cards__probe", container);
  element("div", "memory-album__backdrop", container);
  const header = element("div", "memory-album__header", container);
  const heading = element("div", "memory-album__heading", header);
  const title = element("div", "memory-album__title", heading);
  title.id = `memory-album-title-${Math.random().toString(36).slice(2, 8)}`;
  title.textContent = "People who lived here";
  element("div", "memory-album__subtitle", heading).textContent = `Apalabassa St. · ${people.length} photographs`;
  const actions = element("div", "memory-album__actions", header);
  const back = element("button", "memory-album__button memory-album__back", actions);
  back.type = "button";
  back.textContent = "All photos";
  const done = element("button", "memory-album__button memory-album__done", actions);
  done.type = "button";
  done.textContent = "Done";
  const story = element("div", "memory-album__story", container);
  const storyName = element("div", "memory-album__name", story);
  const storyText = element("div", "memory-album__text", story);
  // In the pile the arriving print goes on top; the album keeps their order.
  const order = [...people.filter(person => !person.arrives), ...people.filter(person => person.arrives)];
  const cards = people.map((person, n) => {
    const outer = element("div", "memory-card", container);
    const inner = element("div", "memory-card__y", outer);
    const lift = element("div", "memory-card__lift", inner);
    const print = element("button", "memory-card__print", lift);
    print.type = "button";
    const image = element("img", "", print);
    image.src = person.url;
    image.alt = "";
    image.decoding = "async";
    image.draggable = false;
    const pile = order.indexOf(person);
    outer.style.zIndex = 10+pile;
    return { person, n, pile, outer, inner, lift, print, image, size: { w: 0, h: 0, b: 0 }, pending: null };
  });
  const count = cards.length;
  const arriving = cards.find(card => card.person.arrives) ?? cards[count-1];
  const stack = element("button", "memory-stack", container);
  stack.type = "button";
  stack.setAttribute("aria-label", "Open the album of people who lived here");
  stack.hidden = true;
  root.append(container);

  let rect = null;
  let frame = [0.5, 0.8];
  let turn = 0, pendingTurn = 0, pendingSince = 0;
  let W = 0, H = 0;
  let geo = null;
  let key = "";
  // The pile is out, after the grace before it leaves; departing: the rest of
  // the pile is stepping aside from Peter's print; launched: it has gone to
  // the street; mode: the album's pile, open or closing.
  let shown = false, hideAt = null, departing = false, launched = false;
  let mode = "pile";
  let focus = null;
  const timers = new Set();
  const later = (ms, run) => {
    const timer = setTimeout(() => { timers.delete(timer); run(); }, ms);
    timers.add(timer);
  };

  // Every place a print can be, for the screen as held: the pile beside the
  // guide frame, below it out of sight, and the album's grid under its header.
  function measure() {
    const landscape = W >= H, short = Math.min(W, H);
    const frameWidth = (landscape ? frame[0] : frame[1])*W;
    const insets = heldInsets(probe, turn);
    // The pile: prints whose long sides are `size`, clear of the frame, the
    // screen's edges and its safe area.
    const right = Math.max(EDGE, insets.right+8), bottom = Math.max(EDGE, insets.bottom+8);
    const room = (W-frameWidth)/2-right-20;
    const size = clamp(Math.min(0.27*short, room/1.32), 56, 128);
    const border = Math.max(3, 0.04*size);
    const reach = 0.62*size+border;
    const x = W-right-reach, y = H-bottom-reach;
    const pile = [], down = [];
    for (const card of cards) {
      const { aspect } = card.person;
      const w = (aspect >= 1 ? size : size*aspect)+2*border, h = (aspect >= 1 ? size/aspect : size)+2*border;
      const [dx, dy] = SHIFTS[card.pile % SHIFTS.length], tilt = TILTS[card.pile % TILTS.length];
      pile[card.pile] = { x: x+dx*size, y: y+dy*size, w, h, b: border, r: tilt };
      // Dealt in from beyond the screen's corner below the pile.
      down[card.pile] = { x: x+0.5*size+40, y: H+h, w, h, b: border, r: tilt+16, hide: true };
    }
    // The grid, every print one height: the tallest that fits a cell by
    // width and the rows by height, the block centred under the header.
    const left = Math.max(EDGE, insets.left+12), end = Math.max(EDGE, insets.right+12);
    const head = Math.max(12, insets.top+4), foot = Math.max(EDGE, insets.bottom+12);
    const area = { left, top: head+HEADER, width: W-left-end, height: H-head-HEADER-foot };
    const cols = landscape ? 4 : 2, rows = Math.ceil(count/cols), gap = landscape ? 16 : 14;
    const cell = (area.width-gap*(cols-1))/cols;
    const widest = Math.max(...cards.map(card => card.person.aspect));
    const photo = Math.max(24, Math.min((area.height-gap*(rows-1))/rows/(1+2*BORDER), cell/(widest+2*BORDER), 260));
    const b = Math.max(3, BORDER*photo), printHeight = photo+2*b;
    const top = area.top+(area.height-rows*printHeight-(rows-1)*gap)/2;
    const grid = cards.map(card => ({
      x: area.left+(card.n % cols)*(cell+gap)+cell/2,
      y: top+Math.floor(card.n/cols)*(printHeight+gap)+printHeight/2,
      w: card.person.aspect*photo+2*b, h: printHeight, b, r: 0,
    }));
    return { landscape, pile, down, grid, area, stack: { x, y, size: 2*reach+8 },
      header: { left, top: head, width: W-left-end, height: HEADER-8 } };
  }

  // Where a highlighted print goes, large on the left as held (on top when
  // upright), and where its story sits beside it, aligned with its image.
  function focusLayout(card) {
    const { area, landscape } = geo;
    const { aspect } = card.person;
    if (landscape) {
      const gutter = 28, textWidth = Math.min(360, 0.42*area.width);
      const photo = Math.min(area.height/(1+2*BORDER), (area.width-textWidth-gutter)/(aspect+2*BORDER), 480);
      const b = Math.max(3, BORDER*photo), w = aspect*photo+2*b, h = photo+2*b;
      const left = area.left+(area.width-w-gutter-textWidth)/2, top = area.top+(area.height-h)/2;
      return { box: { x: left+w/2, y: top+h/2, w, h, b, r: 0 },
        story: { left: left+w+gutter, top: top+b, width: textWidth, height: area.top+area.height-top-b } };
    }
    const gap = 20;
    const photo = Math.min(0.5*area.height/(1+2*BORDER), area.width/(aspect+2*BORDER), 480);
    const b = Math.max(3, BORDER*photo), w = aspect*photo+2*b, h = photo+2*b, top = area.top+8;
    return { box: { x: area.left+area.width/2, y: top+h/2, w, h, b, r: 0 },
      story: { left: area.left, top: top+h+gap, width: area.width, height: area.top+area.height-top-h-gap } };
  }

  // Where a print belongs now.
  function target(card) {
    if (mode === "closing") return geo.pile[card.pile];
    if (mode === "pile") {
      // Stepping aside, only Peter's print stays where it was.
      if (departing && !launched) return card === arriving ? geo.pile[card.pile] : geo.down[card.pile];
      return shown && !launched ? geo.pile[card.pile] : geo.down[card.pile];
    }
    if (!focus) return geo.grid[card.n];
    if (card === focus) return focusLayout(card).box;
    return { ...geo.grid[card.n], s: 0.94, o: 0, hide: true };
  }

  // Move prints to new places. Every print's current geometry is read before
  // anything is written, so a move retargets from where each print is now,
  // mid-flight or at rest. Each print takes its new size at once and is scaled
  // back to its old one, then eased to its new place unscaled (FLIP), so it
  // ends sharp at its own size.
  function move(list) {
    const starts = list.map(([card]) => {
      const outer = matrixOf(card.outer), inner = matrixOf(card.inner);
      return { x: outer.e, y: inner.f, r: Math.atan2(inner.b, inner.a)/DEGREE,
        w: card.size.w*Math.hypot(inner.a, inner.b), h: card.size.h*Math.hypot(inner.c, inner.d),
        o: Number(getComputedStyle(card.inner).opacity) };
    });
    list.forEach(([card, box, motion = {}], i) => {
      const from = starts[i];
      const ms = time(motion.ms ?? 0);
      Object.assign(card.print.style, { width: `${box.w}px`, height: `${box.h}px`, left: `${-box.w/2}px`, top: `${-box.h/2}px`, borderWidth: `${box.b}px` });
      card.size = { w: box.w, h: box.h, b: box.b };
      card.outer.style.transition = card.inner.style.transition = "none";
      card.lift.style.animation = "none";
      if (ms && from.w > 0 && from.h > 0) {
        card.outer.style.transform = `translateX(${from.x}px)`;
        card.inner.style.transform = `translateY(${from.y}px) rotate(${from.r}deg) scale(${from.w/box.w}, ${from.h/box.h})`;
        card.inner.style.opacity = from.o;
      }
      card.pending = { box, motion, ms, delay: ms ? time(motion.delay ?? 0) : 0 };
    });
    void container.offsetWidth; // commit the starts before the transitions return
    for (const [card] of list) {
      const { box, motion, ms, delay } = card.pending;
      const hide = Boolean(box.hide);
      card.outer.style.transition = ms ? `transform ${ms}ms ${motion.x ?? TRAVEL} ${delay}ms` : "none";
      card.inner.style.transition = ms
        ? `transform ${ms}ms ${motion.y ?? TRAVEL} ${delay}ms, opacity ${ms}ms ${motion.fade ?? TRAVEL} ${delay}ms, visibility 0s linear ${hide ? delay+ms : 0}ms`
        : "none";
      card.outer.style.transform = `translateX(${box.x}px)`;
      card.inner.style.transform = `translateY(${box.y}px) rotate(${box.r}deg) scale(${box.s ?? 1})`;
      card.inner.style.opacity = box.o ?? 1;
      card.inner.style.visibility = hide ? "hidden" : "visible";
      card.lift.style.animation = ms && motion.lift ? `memory-card-lift ${ms}ms ${LIFT} ${delay}ms both` : "none";
      card.pending = null;
    }
  }

  // The layer fills the screen as held, turned upright; everything takes its
  // place in a new layout at once.
  function resize() {
    const sideways = Math.abs(Math.round(Math.sin(turn*DEGREE))) === 1;
    W = sideways ? rect.height : rect.width;
    H = sideways ? rect.width : rect.height;
    Object.assign(container.style, {
      width: `${W}px`, height: `${H}px`, left: `${rect.left+rect.width/2}px`, top: `${rect.top+rect.height/2}px`,
      transform: `translate(-50%, -50%) rotate(${turn}deg)`,
    });
    geo = measure();
    container.toggleAttribute("data-portrait", !geo.landscape);
    move(cards.map(card => [card, target(card)]));
    Object.assign(header.style, { left: `${geo.header.left}px`, top: `${geo.header.top}px`, width: `${geo.header.width}px`, height: `${geo.header.height}px` });
    const { x, y, size } = geo.stack;
    Object.assign(stack.style, { width: `${size}px`, height: `${size}px`, transform: `translate(${x-size/2}px, ${y-size/2}px)` });
    if (focus) placeStory(focusLayout(focus).story);
  }

  function placeStory({ left, top, width, height }) {
    Object.assign(story.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${Math.max(0, height)}px` });
  }

  function setDialog(open) {
    if (open) {
      container.setAttribute("role", "dialog");
      container.setAttribute("aria-modal", "true");
      container.setAttribute("aria-labelledby", title.id);
    } else for (const name of ["role", "aria-modal", "aria-labelledby"]) container.removeAttribute(name);
    for (const card of cards) {
      card.print.tabIndex = open ? 0 : -1;
      if (open) {
        card.print.removeAttribute("aria-hidden");
        card.print.setAttribute("aria-label", `Show ${card.person.title}`);
      } else {
        card.print.setAttribute("aria-hidden", "true");
        card.print.removeAttribute("aria-label");
      }
    }
  }

  // The pile is dealt from beyond the corner, bottom print first.
  function deal() {
    shown = true;
    hideAt = null;
    stack.hidden = false;
    move(cards.map(card => [card, geo.pile[card.pile], { ms: DEAL_MS, delay: card.pile*DEAL_STAGGER, x: ARRIVE, y: ARRIVE }]));
  }

  // It leaves the way it came, quicker, top print first.
  function sweep(list = cards, stagger = EXIT_STAGGER) {
    shown = false;
    hideAt = null;
    stack.hidden = true;
    delete container.dataset.pressed;
    move(list.map(card => [card, geo.down[card.pile], { ms: EXIT_MS, delay: (count-1-card.pile)*stagger }]));
  }

  // The prints are dealt from the top of the pile into the album's grid.
  function open() {
    if (mode !== "pile" || launched || !shown || !geo) return;
    mode = "open";
    container.dataset.album = "open";
    delete container.dataset.pressed;
    setDialog(true);
    stack.hidden = true;
    move(cards.map(card => [card, geo.grid[card.n], { ms: OPEN_MS, delay: (count-1-card.pile)*OPEN_STAGGER, x: FLY_X, y: FLY_Y, lift: true }]));
    done.focus({ preventScroll: true });
  }

  // Back into the pile, bottom print first so Peter's lands on top; a
  // highlighted print leads, and keeps its place above the others until home.
  function close() {
    if (mode !== "open") return;
    const lead = focus, hadFocus = container.contains(document.activeElement);
    focus = null;
    delete container.dataset.highlight;
    mode = "closing";
    container.dataset.album = "closing";
    move(cards.map(card => [card, geo.pile[card.pile], { ms: CLOSE_MS, x: FLY_X, y: FLY_Y,
      delay: lead ? (card === lead ? 0 : CLOSE_STAGGER*(1+card.pile)) : card.pile*CLOSE_STAGGER }]));
    later(time(CLOSE_MS+count*CLOSE_STAGGER), () => {
      mode = "pile";
      if (lead) lead.outer.style.zIndex = 10+lead.pile;
      delete container.dataset.album;
      setDialog(false);
      shown = true;
      hideAt = null;
      stack.hidden = false;
      if (hadFocus) stack.focus({ preventScroll: true });
    });
  }

  // The print travels to the large place, growing as it goes; its story
  // follows once it is nearly there, and the others step back out of sight.
  function highlight(card) {
    if (mode !== "open" || focus) return;
    focus = card;
    storyName.textContent = card.person.title;
    storyText.replaceChildren(...(card.person.about ?? []).map(text => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      return paragraph;
    }));
    story.scrollTop = 0;
    const layout = focusLayout(card);
    placeStory(layout.story);
    container.dataset.highlight = "";
    card.outer.style.zIndex = 30;
    card.print.setAttribute("aria-label", "Back to all photos");
    move(cards.map(other => other === card
      ? [other, layout.box, { ms: FOCUS_MS, x: FLY_X, y: FLY_Y, lift: true }]
      : [other, target(other), { ms: RECEDE_MS }]));
    sharpen(card);
  }

  // And back to its place in the grid, the others returning around it.
  function unhighlight() {
    const card = focus;
    if (!card || mode !== "open") return;
    focus = null;
    delete container.dataset.highlight;
    card.print.setAttribute("aria-label", `Show ${card.person.title}`);
    move(cards.map(other => other === card
      ? [other, geo.grid[other.n], { ms: UNFOCUS_MS, x: FLY_X, y: FLY_Y }]
      : [other, geo.grid[other.n], { ms: RETURN_MS, delay: RETURN_DELAY, x: ARRIVE, y: ARRIVE, fade: ARRIVE }]));
    later(time(UNFOCUS_MS), () => { if (focus !== card) card.outer.style.zIndex = 10+card.pile; });
  }

  // A highlighted print shows the sharper copy when the person has one;
  // the pile's copies are small.
  function sharpen(card) {
    const source = card.person.print;
    if (!source || card.sharp) return;
    card.sharp = true;
    const image = new Image();
    image.src = source;
    image.decode().then(() => { card.image.src = source; }, () => { card.sharp = false; });
  }

  const onKey = event => {
    if (event.key !== "Escape" || mode !== "open") return;
    event.preventDefault();
    close();
  };
  window.addEventListener("keydown", onKey);
  stack.addEventListener("click", open);
  done.addEventListener("click", close);
  back.addEventListener("click", unhighlight);
  for (const card of cards) card.print.addEventListener("click", () => {
    if (focus === card) unhighlight();
    else highlight(card);
  });
  // A press shows on the pile before the album opens.
  stack.addEventListener("pointerdown", () => { container.dataset.pressed = ""; });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) stack.addEventListener(type, () => { delete container.dataset.pressed; });
  // Taps on the pile or the album are theirs alone: they never reach the AR
  // view's tap layer or canvas, and never raise a WebXR select.
  container.addEventListener("click", event => event.stopPropagation());
  container.addEventListener("beforexrselect", event => event.preventDefault());
  setDialog(false);

  return {
    /** Every frame: whether the pile is out, the screen's quarter turn as held, its rect, and the guide frame's share of its long and short sides. */
    update({ shown: wanted, turn: next, rect: box, frame: share }) {
      const now = performance.now();
      if (share) frame = share;
      if (mode === "pile") turn = pendingTurn = next;
      else if (next !== pendingTurn) { pendingTurn = next; pendingSince = now; }
      else if (next !== turn && now-pendingSince >= TURN_SETTLE) turn = next;
      rect = box;
      const nextKey = `${[box.left, box.top, box.width, box.height].map(Math.round).join(",")}|${turn}|${frame[0].toFixed(3)}|${frame[1].toFixed(3)}`;
      if (nextKey !== key) { key = nextKey; resize(); }
      // While the album is open, or once Peter's print is leaving, the pile
      // stays as it is whatever the match says.
      if (mode !== "pile" || departing || launched) return;
      if (wanted) {
        hideAt = null;
        if (!shown) deal();
      } else if (shown) {
        hideAt ??= now+HIDE_GRACE;
        if (now >= hideAt) sweep();
      }
    },
    /**
     * The match is made: the rest of the pile steps aside and Peter's print
     * waits alone, its shadow lifting, so nothing on the page will lie over
     * the 3D card that takes its place. Returns the milliseconds until then,
     * when `launch` hands it over; 0 unless the pile is out.
     */
    depart() {
      if (departing || launched || mode !== "pile" || !shown || !geo) return 0;
      departing = true;
      hideAt = null;
      stack.hidden = true;
      delete container.dataset.pressed;
      arriving.outer.classList.add("is-departing");
      move(cards.filter(card => card !== arriving).map(card =>
        [card, geo.down[card.pile], { ms: EXIT_MS, delay: (count-1-card.pile)*DEPART_STAGGER }]));
      return time(DEPART_MS);
    },
    /**
     * Peter's print leaves the pile for a 3D card that takes its place this
     * frame. Returns where it is on screen: its centre in viewport CSS px,
     * its unrotated size and border including the cream border, and its
     * rotation in degrees clockwise. Null unless the pile is out.
     */
    launch() {
      if (launched || mode !== "pile" || !(shown || departing) || !geo) return null;
      const local = matrixOf(arriving.outer).multiply(matrixOf(arriving.inner)).multiply(matrixOf(arriving.lift));
      const angle = turn*DEGREE, cos = Math.cos(angle), sin = Math.sin(angle);
      const dx = local.e-W/2, dy = local.f-H/2;
      const scaleX = Math.hypot(local.a, local.b), scaleY = Math.hypot(local.c, local.d);
      const pose = {
        x: rect.left+rect.width/2+dx*cos-dy*sin, y: rect.top+rect.height/2+dx*sin+dy*cos,
        width: arriving.size.w*scaleX, height: arriving.size.h*scaleY,
        border: arriving.size.b*Math.min(scaleX, scaleY), rotation: turn+Math.atan2(local.b, local.a)/DEGREE,
      };
      // Opacity, not visibility: the print's own layers set their visibility.
      arriving.outer.style.opacity = "0";
      launched = true;
      shown = false;
      hideAt = null;
      stack.hidden = true;
      delete container.dataset.pressed;
      // Launched without a departure, the rest of the pile follows it out.
      if (!departing) later(time(LAUNCH_EXIT_DELAY), () => sweep(cards.filter(card => card !== arriving)));
      return pose;
    },
    /** Back in the pile with Peter's print on top, out of sight until `update` shows it; the album closes at once. */
    reset() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      launched = false;
      departing = false;
      shown = false;
      hideAt = null;
      mode = "pile";
      turn = pendingTurn;
      if (focus) focus.outer.style.zIndex = 10+focus.pile;
      focus = null;
      container.dataset.instant = "";
      for (const name of ["album", "highlight", "pressed"]) delete container.dataset[name];
      setDialog(false);
      stack.hidden = true;
      arriving.outer.style.removeProperty("opacity");
      arriving.outer.classList.remove("is-departing");
      key = "";
      if (rect) resize();
      void container.offsetWidth; // the album's chrome goes without its transitions
      delete container.dataset.instant;
    },
    /** True from when the album starts opening until it has closed. */
    get albumOpen() { return mode !== "pile"; },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      window.removeEventListener("keydown", onKey);
      container.remove();
    },
  };
}
