import { ARRIVAL } from "./memory-people.js";

// The motion is the stageshow kit's. Cards arrive whole from below on its
// arrival curve, staggered in reading order, and leave in a quicker reverse
// stagger on its travel curve. The flight is its Fly: x and y on different
// curves make a soft arc, with a lift that is gone before a soft landing.
const ARRIVE = "cubic-bezier(0.25, 0.8, 0.25, 1)";
const TRAVEL = "cubic-bezier(0.45, 0, 0.1, 1)";
const FLY_X = "cubic-bezier(0.35, 0, 0.2, 1)";
const FLY_Y = "cubic-bezier(0.3, 0.6, 0.15, 1)";
const LIFT = "cubic-bezier(0.33, 1, 0.68, 1)";
const ARRIVE_MS = 800, ARRIVE_STAGGER = 60, EXIT_MS = 380, EXIT_STAGGER = 50;
const FLY_MS = 950, SETTLE_MS = 150, SINK_MS = 1100;
// A loose hand of prints: small alternating tilts and uneven rises, in card heights.
const TILTS = [-7, 5, -3.5, 4, -5, 6, -2.5, 3];
const RISES = [0.05, -0.03, 0.08, 0, 0.04, -0.02, 0.06, 0];
// Peter's card lands at this many times the size that matches the face in the
// street, then sinks to that size as it dissolves.
const LANDING = 1.6;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const smoothstep = (from, to, x) => { const t = Math.min(1, Math.max(0, (x-from)/(to-from))); return t*t*(3-2*t); };

/**
 * The deck of photographs along the bottom of the screen as the phone is
 * held. `update` shows or hides it and keeps it upright every frame; `fly`
 * sends the arriving card into the guide frame and resolves once it lands;
 * `dissolve` sinks it into the street as the colour arrives.
 */
export function createMemoryCards(root, people) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const time = ms => reduced?.matches ? 0 : ms;
  const deck = document.createElement("div");
  deck.className = "memory-cards";
  deck.setAttribute("role", "img");
  deck.setAttribute("aria-label", `Photographs of people who lived here: ${people.map(p => p.title).join("; ")}`);
  const cards = people.map((person, n) => {
    const el = document.createElement("div");
    el.className = "memory-card";
    const track = document.createElement("div");
    track.className = "memory-card__y";
    const lift = document.createElement("div");
    lift.className = "memory-card__lift";
    const print = document.createElement("img");
    print.className = "memory-card__print";
    print.src = person.url;
    print.alt = "";
    print.decoding = "async";
    lift.append(print);
    track.append(lift);
    el.append(track);
    deck.append(el);
    return { person, el, track, lift, print, n };
  });
  const arriving = cards.find(card => card.person.arrives);
  root.append(deck);

  let key = "";
  let size = { long: 0, short: 0, photo: 0 };
  let frame = [0.5, 0.8];
  let flight = null;

  // Lay the hand out for a screen `long` by `short` px, as the phone is held.
  // Under the guide frame the cards sit low, clear of its bottom edge; beside
  // it they rise, and the arriving card, last, rises most.
  function deal(long, short) {
    const photo = Math.min(130, Math.max(72, 0.24*short));
    const border = Math.max(3, 0.045*photo);
    const count = cards.length;
    const spacing = Math.min(0.9*photo, Math.max(0.45*photo, (0.86*long-1.2*photo)/(count-1)));
    size = { long, short, photo };
    const clear = (1-frame[1])*short/2;
    for (const card of cards) {
      const width = card.person.aspect*photo+2*border, height = photo+2*border;
      const x = (card.n-(count-1)/2)*spacing;
      const reach = x/(0.45*long);
      const beside = smoothstep(0.42*frame[0]*long, 0.5*frame[0]*long+0.3*width, Math.abs(x));
      const raised = card === arriving ? 0.14 : 0;
      // Under the frame a card shows about half of itself, no less than the
      // margin there; beside the frame about seven tenths, and the hand leans
      // outward like a fanned one. Raised on a phone so more of each shows.
      const tilt = TILTS[card.n % TILTS.length]+6*reach;
      const under = Math.max(clear, 0.48*height);
      const shown = under+beside*(0.7*height-under);
      const top = short-shown-beside*(RISES[card.n % RISES.length]+raised)*photo;
      card.rest = { x: long/2+x, y: top+height/2, tilt };
      card.el.style.transform = `translateX(${card.rest.x}px)`;
      card.el.style.zIndex = card === arriving ? count : count-Math.abs(card.n-arriving.n);
      card.track.style.setProperty("--rest", `translateY(${card.rest.y}px) rotate(${tilt}deg)`);
      card.track.style.setProperty("--down", `translateY(${short+height}px) rotate(${tilt}deg)`);
      card.track.style.setProperty("--arrive-delay", `${time(card.n*ARRIVE_STAGGER)}ms`);
      card.track.style.setProperty("--exit-delay", `${time((count-1-card.n)*EXIT_STAGGER)}ms`);
      Object.assign(card.print.style, { width: `${width}px`, height: `${height}px`, left: `${-width/2}px`, top: `${-height/2}px`, borderWidth: `${border}px` });
    }
    deck.style.setProperty("--arrive", `${time(ARRIVE_MS)}ms ${ARRIVE}`);
    deck.style.setProperty("--exit", `${time(EXIT_MS)}ms ${TRAVEL}`);
  }

  // Where the arriving card's centre and photo height put the eyes between
  // its own over the eyes of the man in the street, at `scale` times the
  // face's matching size.
  function landing(scale) {
    const { long, short } = size;
    const width = frame[0]*long, height = frame[1]*short;
    const eyeX = (long-width)/2+ARRIVAL.street.x*width, eyeY = (short-height)/2+ARRIVAL.street.y*height;
    const photo = scale*ARRIVAL.street.eyes/ARRIVAL.portrait.eyes*height;
    return { photo,
      x: eyeX-(ARRIVAL.portrait.x-0.5)*arriving.person.aspect*photo,
      y: eyeY-(ARRIVAL.portrait.y-0.5)*photo };
  }

  function carry(to, ms, x, y, extra = "") {
    arriving.el.style.transition = `transform ${time(ms)}ms ${x}`;
    arriving.el.style.transform = `translateX(${to.x}px)`;
    arriving.track.style.transition = `transform ${time(ms)}ms ${y}${extra}`;
    arriving.track.style.transform = `translateY(${to.y}px) rotate(0deg) scale(${to.photo/size.photo})`;
  }

  return {
    /** Every frame: whether the deck is out, the screen's quarter turn as held, its rect, and the guide frame's share of its long and short sides. */
    update({ shown, turn, rect, frame: share }) {
      if (share) frame = share;
      const long = Math.max(rect.width, rect.height), short = Math.min(rect.width, rect.height);
      const next = `${Math.round(long)}x${Math.round(short)}|${frame[0].toFixed(3)}|${frame[1].toFixed(3)}`;
      if (next !== key) { key = next; deal(long, short); }
      Object.assign(deck.style, {
        width: `${long}px`, height: `${short}px`,
        left: `${rect.left+rect.width/2}px`, top: `${rect.top+rect.height/2}px`,
        transform: `translate(-50%, -50%) rotate(${turn}deg)`,
      });
      if (flight) return;
      if (shown) deck.dataset.shown = "";
      else delete deck.dataset.shown;
    },
    /** Peter's card leaves the hand for the frame, the others sink away; resolves when it has landed. */
    async fly() {
      if (flight) return flight;
      deck.dataset.shown = "";
      deck.dataset.flying = "";
      arriving.el.classList.add("is-flying");
      arriving.lift.style.animation = `memory-card-lift ${time(FLY_MS)}ms ${LIFT} both`;
      carry(landing(LANDING), FLY_MS, FLY_X, FLY_Y);
      flight = wait(time(FLY_MS+SETTLE_MS));
      return flight;
    },
    /** It sinks to the face's own size, eyes still over his, fading into the street as the colour reaches it. */
    dissolve() {
      if (!flight) return;
      carry(landing(1), SINK_MS, TRAVEL, TRAVEL, `, opacity ${time(SINK_MS)}ms ${TRAVEL}, filter ${time(SINK_MS)}ms ${TRAVEL}`);
      arriving.track.style.opacity = "0";
      arriving.track.style.filter = "blur(2px)";
    },
    /** Back in the hand, out of sight, without travelling there. */
    reset() {
      flight = null;
      delete deck.dataset.flying;
      delete deck.dataset.shown;
      arriving.el.classList.remove("is-flying");
      arriving.el.style.transition = "none";
      arriving.track.style.transition = "none";
      for (const name of ["transform", "opacity", "filter"]) arriving.track.style.removeProperty(name);
      arriving.lift.style.removeProperty("animation");
      key = "";
      if (size.long) deal(size.long, size.short);
      void arriving.track.offsetWidth; // commit the jump before transitions return
      arriving.el.style.removeProperty("transition");
      arriving.track.style.removeProperty("transition");
    },
    dispose() { deck.remove(); },
  };
}
