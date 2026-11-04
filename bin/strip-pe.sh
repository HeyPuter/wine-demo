#!/bin/bash
# strip-pe.sh DIR...: llvm-strip --strip-debug every PE winebuild made under DIR (its "Wine builtin DLL" /
# "Wine placeholder DLL" stub), in place. The same input gives the same output, so a prefix's copies of the
# builtins stay byte-identical to the dist's. The apps' own files (7-Zip, PuTTY, Notepad++) are left as shipped.
set -euo pipefail
for d in "$@"; do
  find "$d" -type f -size +1k -print0 | while IFS= read -r -d '' f; do
    head -c 2 "$f" | grep -q MZ || continue
    head -c 1024 "$f" | grep -aqE 'Wine (builtin|placeholder) DLL' || continue
    llvm-strip --strip-debug "$f" 2>/dev/null || echo "strip-pe: $f left as built (llvm-strip refuses it)" >&2
  done
done
