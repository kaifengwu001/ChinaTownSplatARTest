import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createAddressSync } from "../src/address-sync.js";

const originalWindow = globalThis.window;
const originalHistory = globalThis.history;
after(() => { globalThis.window = originalWindow; globalThis.history = originalHistory; });

test("tuning writes the address at most every quarter second and never throws", async () => {
  let writes = 0;
  globalThis.window = { location: { href: "https://example.test/ar.html?a=1" } };
  // Safari's limit: more than 100 writes in 10 seconds throws a SecurityError.
  globalThis.history = { replaceState(_state, _title, url) {
    if (++writes > 100) throw new Error("SecurityError");
    globalThis.window.location.href = url;
  } };
  const address = createAddressSync(20);
  for (let n = 0; n < 1000; n++) {
    const url = address.current();
    url.searchParams.set("n", n);
    address.set(url);
  }
  assert.equal(address.current().searchParams.get("n"), "999", "current() reflects unwritten changes");
  assert.equal(writes, 0, "writes wait for the interval");
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(writes, 1);
  assert.equal(new URL(window.location.href).searchParams.get("n"), "999");
  writes = 1000; // The browser now refuses every write; tuning must carry on.
  address.set(new URL("https://example.test/ar.html?b=2"));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(address.current().searchParams.get("b"), "2");
});
