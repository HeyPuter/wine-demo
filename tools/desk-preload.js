// smoke.mjs SMOKE_PRELOAD for the desktop checks: the compositor's whole window list (geometry and title)
// each time it changes, as "[desk] ..." console lines, and the output size.
(() => {
  let last = '';
  const tick = async () => {
    try {
      const c = globalThis.__gexCompositor;
      if (c) {
        const d = await c.describe();
        const now = JSON.stringify({ out: d.output, list: d.list });
        if (now !== last) { last = now; console.log(`[desk] ${Math.round(performance.now())} ${now}`); }
      }
    } catch (e) {}
    setTimeout(tick, 250);
  };
  tick();
})();
