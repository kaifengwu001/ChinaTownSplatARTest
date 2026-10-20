/**
 * Keeps the page address in step with live tuning. Safari throws a
 * SecurityError past 100 history.replaceState calls in 10 seconds, which a
 * dragged slider reaches quickly, so writes happen at most every quarter
 * second. `current()` is the newest address, written yet or not.
 */
export function createAddressSync(interval = 250) {
  let pending = null;
  let timer = null;
  const write = () => {
    timer = null;
    // A refused write is not worth an error; the next change writes again.
    try { history.replaceState(null, "", pending); } catch {}
  };
  return {
    current: () => new URL(pending ?? window.location.href),
    set(url) {
      pending = url.href;
      timer ??= setTimeout(write, interval);
    },
  };
}
