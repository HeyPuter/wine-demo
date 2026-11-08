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
      // Every file the page fetched by then, the loader's among them (its fetches are the page's own, on this
      // thread): Resource Timing's body bytes (encodedBodySize, as the loader counts its .zst). ttd.py takes
      // the loader's bytes (progress) from it for the rest: the HTML, scripts, styles, images and manifests.
      if (p && !seen.has('@page') && seen.has('Desktop')) {
        seen.add('@page');
        const es = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')];
        console.log(`[ttd] page ${JSON.stringify({ bytes: es.reduce((a, e) => a + (e.encodedBodySize || 0), 0), files: es.length })}`);
      }
      const s = globalThis.__app?.state?.session;
      if (s && !seen.has('@session') && seen.has('Desktop')) { seen.add('@session'); console.log(`[ttd] env ${JSON.stringify(s.env ?? [])}`); }
    } catch (e) {}
    setTimeout(tick, 200);
  };
  tick();
})();
