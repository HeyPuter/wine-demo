# windemo

The Wine desktop demo site: a 64-bit Wine desktop (explorer's shell, cmd, a file manager, a Start menu) in the browser on gex, with 7-Zip, Notepad++ and Dillo built from source as native wasm, plus PuTTY. Files can be dropped in from the host and run, 32-bit ones included (WoW64).

This repo holds only the pipeline. Its outputs go to `WD_OUT`, never into the repo: the sites (`sW*`), `proj-*`, `page*`, `pre/`, `stage/`, `units/`, `runs/`, `logs/`, `work/`, `w64/` and `*.zcache`. Its private and third-party inputs (`APPS`, `TEST_APPS`, `DROPS`) also live outside the repo.

## Configuration

`env.sh` holds every machine path, host and default. To change any of them, copy `env.local.example` to `env.local` and set the variables there. The variables:

| Variable | What it is |
|---|---|
| `SANDBOX` | the tree everything lives under; the bench host has a copy of it at `BENCH_ROOT` |
| `WD_OUT` | the output tree, and where the private inputs live |
| `GEX` | the gex checkout; it must be under `SANDBOX` |
| `GATE_W64` | the gate's Wine builds |
| `APPS`, `APPS_RECIPE` | WN's app drop-in, and the recipe that builds it |
| `TEST_APPS`, `DROPS` | the upstream downloads, and the files the checks drop into the page |
| `BENCH`, `BENCH_HOST`, `BENCH_SSH`, `BENCH_ROOT` | where the recordings and smoke runs run |
| `SITE_HOST`, `PORT`, `SERVE_DIR`, `SPKI` | where a site is served, and the TLS key the runs trust |

## Inputs

1. **A gex checkout** (`GEX`). Its `web/node_modules` must be in place, either from `npm ci` in `web/` or as a link to another tree's.
2. **A gate Wine dist** (`DIST`): a native-i386 WoW64 dist, `GATE_W64/dist64-K-...-wow64-...-nN64-N32-sS`. The gate also builds what `bin/dist.sh` derives from its name: the wasm64 tree `b64-K-*-wow64`, the native dirs `pen64-K-N64` and `pen32-K-N32`, the sysroot, and the WoW64 prefix stamped for its `wine.inf`.
3. **The apps** (`APPS`): WN's drop-in of 7-Zip, Notepad++ and Dillo built with gexcc's Windows target. It contains `files/`, `programs.list`, `licenses/` and `SHA256SUMS`.
   - The recipe is the sandbox's `apps/` (`APPS_RECIPE`): `build-all.sh` fetches and builds the apps, and `package.sh` lays out the drop-in.
   - `make apps` runs both. It needs `GEXCC_WIN`, a gexcc-win install (from gex's `tools/gexcc/windows/install.sh`, plus `build-cxx-win.sh` for C++), and `LLVM_SRC` for the libc++ licenses. See `APPS_RECIPE/common.sh`.
4. **The upstream downloads** (`TEST_APPS`, fetched by `make test-apps`). Each is checked against its SHA-256, which is also listed in `test-apps.txt`:

   | File | Download | SHA-256 |
   |---|---|---|
   | PuTTY 0.85 x86 (`putty-x86.exe`) | https://the.earth.li/~sgtatham/putty/0.85/w32/putty.exe | `4c70267ca03a00ea761ec358498b990a7221decb36eace9b7dbe6a751be0fb3b` |
   | PuTTY 0.85 x64 (`putty-x64.exe`) | https://the.earth.li/~sgtatham/putty/0.85/w64/putty.exe | `d01fdb5aae8f112526040a39b0bfb9e27d813003178645e65f8d1cfdb2a26c87` |
   | 7-Zip 24.08 x86 installer (`7z2408-x86.exe`) | https://www.7-zip.org/a/7z2408.exe | `faa87251336d864b877a5e6c3e9c9a5e250318be2fdfc8a42ceadb3a956e0405` |
   | 7-Zip 24.08 x64 installer (`7z2408-x64.exe`) | https://www.7-zip.org/a/7z2408-x64.exe | `67cb9d3452c9dd974b04f4a5fd842dbcba8184f2344ff72e3662d7cdb68b099b` |
   | 7-Zip 24.08 x64 msi (`7z2408-x64.msi`) | https://www.7-zip.org/a/7z2408-x64.msi | `98330e7e6db3507b444d576dc437a9ac4d82333a88a6bb6ef36a91fe3d85fa92` |
   | Notepad++ 8.6.9 x86 portable (`npp.8.6.9.portable.x86.zip`) | https://github.com/notepad-plus-plus/notepad-plus-plus/releases/download/v8.6.9/npp.8.6.9.portable.zip | `045b5989fe3cb03aa1977d6b897e672928bf14ceddc089b2196bf383d6195173` |
   | Notepad++ 8.6.9 x64 portable (`npp.8.6.9.portable.x64.zip`) | https://github.com/notepad-plus-plus/notepad-plus-plus/releases/download/v8.6.9/npp.8.6.9.portable.x64.zip | `c1478faf2a2ec8c78c9d92b22445d53027c85d142165015cf9ed0aca80b13679` |

   The page ships the PuTTYs and the 7-Zip `.exe` installers. The Notepad++ x86 zip is only a check's drop, and the msi and the x64 zip are there for the audit, which accounts for their members.

Nothing from real Windows goes in. `tools/audit.py` accounts for every file in the bundle by content, and `mkbundle` and `site` fail if any file is unaccounted for.

## Building a site

```
make site GEX=<gex checkout> DIST=<gate dist> SITE=sW7
```

This runs the following steps in order. Each step is also a target of its own.

1. `runtime` (`bin/runtime.sh`) builds GEX's x86 gexc, the kernel and the browser shims, then the eject page library into `WD_OUT/page`. It waits while two cargo builds are already running.
2. `dist` (`bin/dist.sh DIST`) copies DIST into `w64/dist`, restages its x86-64 core with `PELINK_EXPORT_ALL=1`, and writes `w64/dist.env`. The previous dist becomes `w64/dist-prev`.
3. `test-apps` (`bin/test-apps.sh`) fetches the upstream downloads above.
4. `prefix` (`bin/mkapps.sh`) makes `work/pfx-apps`: the gate's WoW64 prefix plus the apps, PuTTY, the Start menu shortcuts and the "Print to file" printer. It builds `tools/prt/addprinter.c` with mingw for this step only.
5. `bundle` (`bin/mkbundle.sh`) makes `pre/bundle.tar`: the stripped dist, the page prefix and the XKB data. It then runs the audit.
6. `pipeline` (`bin/pipeline.sh TAG SITE`) serves `pre/` on `PORT` and records it twice on the bench box. Between the two recordings it builds the function-tier units (`bin/units.sh`). It then ejects the site from the second recording (`bin/site.sh`) and serves `WD_OUT/SITE` on `PORT`. The site's shims and kernel ship without names or DWARF (GEX's eject strips them); set `KEEP_NAMES=1` for a debug site.

## Checking a site

```
make check SITE=sW7 [STEPS="start launch banner prefs c2 win32"]
```

`make check` first runs `drops` (`bin/drops.sh`), which makes `DROPS` from `TEST_APPS`. `bin/check.sh` then runs each step against the site served at `https://SITE_HOST:PORT/`:

- `start`: the Start menu and typing.
- `launch`: each Start menu program, with its windows and traps.
- `banner`: 7zz's console banner.
- `prefs`: Notepad++ Preferences, click to window.
- `c2`: file manager copy, paste and rename; 7-Zip FM add and test; a cross-process drop; Dillo.
- `win32`: under WoW64, putty-x86; the 7-Zip x86 install, then its 7zFM opening `test.zip`; Notepad++ x86 portable.

Each run lands in `WD_OUT/runs/out-*`, with screenshots and `console.txt`.

`bin/sweep.sh TAG SECS KEYS [ENV...]` runs a single custom run. KEYS uses smoke.mjs's syntax, for example `type:cd+desktop`: `+` types a space and `\+` types a plus sign. `bin/start-smoke.sh` runs the Start menu check natively under gexc's Wayland compositor.

To serve something else: `make serve SITE=<dir under WD_OUT>`.

## Layout

- `bin/`: the scripts that run on the build machine.
- `tools/`: the files synced to the bench box (`smoke.sh`, `smoke.mjs`, `record.sh`, the preloads), plus data and helpers:
  - `index.html` and `pre-index.html`: the site's and the pre page's index.
  - `dll-bases` and `boot-units.txt`: builtin pins and the boot unit set.
  - `rest-order-*.txt`: the rest bundle's read order.
  - `fonts/`: the symbol fallback font and its license.
  - `prt/`: the printer helper.
  - `audit.py`, `builtins.py`, `tcpu.py`, `np-net.py`, ...
- `patches/`: Wine changes the site depends on that reach the dist through the Wine branches. They are kept for reference and the pipeline does not apply them.
