// smoke.mjs SMOKE_PRELOAD_FILE for the Start menu check (start-page.py): the compositor's window list each
// time it changes, as "[wins] N line|line|..." console lines.
(() => {
  let last = null;
  const tick = async () => {
    try {
      const c = globalThis.__gexCompositor;
      if (c) {
        const d = await c.describe({ pixels: false });
        const l = (d.list ?? []).join('|');
        if (l !== last) { last = l; console.log(`[wins] ${(d.list ?? []).length} ${l}`); }
      }
    } catch (e) {}
    setTimeout(tick, 250);
  };
  tick();
})();
