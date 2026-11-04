// smoke.mjs SMOKE_PRELOAD: when each toplevel title first appears (ms since navigation), and the page's
// progress marks, as "[ttd] ..." console lines (tools/ttd.py reads them).
(() => {
  const seen = new Set();
  const tick = async () => {
    try {
      const c = globalThis.__gexCompositor;
      if (c) {
        const d = await c.describe({ pixels: false });
        for (const l of d.list ?? []) {
          const m = /"(.*)"$/.exec(l); const t = m ? m[1] || '(untitled)' : '?';
          if (!seen.has(t)) { seen.add(t); console.log(`[ttd] window ${Math.round(performance.now())} ${JSON.stringify(t)} ${l.split(' ')[2]}`); }
        }
      }
      const p = globalThis.__app?.state?.progress;
      if (p && !seen.has('@progress') && seen.has('Desktop')) { seen.add('@progress'); console.log(`[ttd] progress ${JSON.stringify({ download: p.download, at: p.at, programs: (p.log ?? []).filter((e) => e.kind === 'program') })}`); }
      const s = globalThis.__app?.state?.session;
      if (s && !seen.has('@session') && seen.has('Desktop')) { seen.add('@session'); console.log(`[ttd] env ${JSON.stringify(s.env ?? [])}`); }
    } catch (e) {}
    setTimeout(tick, 200);
  };
  tick();
})();
