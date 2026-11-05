// Photographs of people who lived in the old Chinatown around Apalabassa St.,
// dealt as cards along the bottom of the screen while the viewer lines up the
// street. Peter SooHoo's card flies into the frame and starts the activation:
// the restored street (input/apalabassa-soohoo.webp) shows him standing in it.
// Cards are input/people/cards, 400 px tall copies of the originals beside it.
const card = (file) => new URL(`../input/people/cards/${file}.webp`, import.meta.url).href;

/** In dealing order, left to right, Peter last. `aspect` is the photograph's width over height. */
export const PEOPLE = Object.freeze([
  { title: "Children on the sidewalk", url: card("children-on-the-sidewalk"), aspect: 431/400 },
  { title: "A seated portrait", url: card("seated-portrait"), aspect: 266/400 },
  { title: "Kwong On & Co.", url: card("kwong-on-storefront"), aspect: 434/400 },
  { title: "The mission's twentieth anniversary, October 11, 1907", url: card("mission-anniversary-1907"), aspect: 560/400 },
  { title: "Crossing the street", url: card("crossing-the-street"), aspect: 427/400 },
  { title: "Two men seated", url: card("two-men-seated"), aspect: 559/400 },
  { title: "The photographer's studio, 510", url: card("photographer-510"), aspect: 578/400 },
  { title: "Peter SooHoo", url: card("peter-soohoo"), aspect: 339/400, arrives: true },
].map(Object.freeze));

/**
 * Where Peter SooHoo's eyes are: the point between them, as fractions of the
 * photograph from its top-left, and how far apart they are, as a fraction of
 * its height. `street` is the restored colour photograph, where he stands;
 * `portrait` is his card. His card lands with its eyes over his, so the face
 * stays put as the card dissolves into the street.
 */
export const ARRIVAL = Object.freeze({
  street: Object.freeze({ x: 0.4817, y: 0.4024, eyes: 0.0267 }),
  portrait: Object.freeze({ x: 0.4917, y: 0.2398, eyes: 0.1 }),
});
