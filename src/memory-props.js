import { TextureLoader } from "three";
import { loadPhotoPlate, createPhotoPlate } from "./memory-plate.js";
import { createCardFlight } from "./memory-flight.js";

/**
 * The memory's props, for the AR page and the desktop preview alike: the old
 * plate holder that frames the photograph, and the arriving person's print,
 * which flies from the stack into it. Pass the result to createMemoryWindow.
 */
export async function loadMemoryProps(people) {
  const person = people.find(p => p.arrives);
  // It flies up close at 1.6 times his size, larger than the pile's copy holds.
  const [plateSource, texture] = await Promise.all([loadPhotoPlate(), new TextureLoader().loadAsync(person.print ?? person.url)]);
  return { plate: createPhotoPlate(plateSource), flight: createCardFlight({ texture, person }) };
}
