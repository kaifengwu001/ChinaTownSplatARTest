// Photographs of people who lived in the old Chinatown around Apalabassa St.,
// a pile of prints in the corner of the screen while the viewer lines up the
// street, and the album it opens. Peter SooHoo's print, on top, flies into the
// photograph and starts the activation: the restored street
// (input/apalabassa-soohoo.webp) shows him standing in it.
// Cards are input/people/cards, 400 px tall copies of the originals beside it,
// for the pile and the album's grid; prints are input/people/prints, copies
// 1200 px on their long side, for close-ups: the album's highlight and the
// arriving print's flight into the street.
const card = (file) => new URL(`../input/people/cards/${file}.webp`, import.meta.url).href;
const print = (file) => new URL(`../input/people/prints/${file}.webp`, import.meta.url).href;

// Placeholder copy for the album, two short paragraphs a photograph, until
// the real stories are written.
const SAMPLE = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua, ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt.",
  "Curabitur pretium tincidunt lacus. Nulla gravida orci a odio, et tempus feugiat. Integer in mauris eu nibh euismod gravida, duis ac tellus et risus vulputate vehicula.",
  "Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Vestibulum tortor quam, feugiat vitae, ultricies eget, tempor sit amet, ante.",
  "Nam liber tempor cum soluta nobis eleifend option congue nihil imperdiet doming id quod mazim placerat facer possim assum, typi non habent claritatem insitam.",
  "Mauris placerat eleifend leo. Quisque sit amet est et sapien ullamcorper pharetra. Vestibulum erat wisi, condimentum sed, commodo vitae, ornare sit amet, wisi.",
];
const about = (first, second) => Object.freeze([SAMPLE[first], SAMPLE[second]]);

/**
 * In dealing order, Peter last. `aspect` is the photograph's width over
 * height; `print` the sharper copy for close-ups; `about` is what the album
 * shows beside it, for now sample text.
 */
export const PEOPLE = Object.freeze([
  { title: "Children on the sidewalk", url: card("children-on-the-sidewalk"), print: print("children-on-the-sidewalk"), aspect: 431/400, about: about(0, 3) },
  { title: "A seated portrait", url: card("seated-portrait"), print: print("seated-portrait"), aspect: 266/400, about: about(2, 5) },
  { title: "Kwong On & Co.", url: card("kwong-on-storefront"), print: print("kwong-on-storefront"), aspect: 434/400, about: about(4, 1) },
  { title: "The mission's twentieth anniversary, October 11, 1907", url: card("mission-anniversary-1907"), print: print("mission-anniversary-1907"), aspect: 560/400, about: about(3, 0) },
  { title: "Crossing the street", url: card("crossing-the-street"), print: print("crossing-the-street"), aspect: 427/400, about: about(5, 2) },
  { title: "Two men seated", url: card("two-men-seated"), print: print("two-men-seated"), aspect: 559/400, about: about(1, 4) },
  { title: "The photographer's studio, 510", url: card("photographer-510"), print: print("photographer-510"), aspect: 578/400, about: about(2, 0) },
  { title: "Peter SooHoo", url: card("peter-soohoo"), print: print("peter-soohoo"), aspect: 339/400, arrives: true, about: about(0, 1) },
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
