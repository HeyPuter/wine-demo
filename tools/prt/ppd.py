#!/usr/bin/env python3
"""ppd.py WINSPOOL OUT: Wine's generic.ppd, winspool.drv's resource PPDFILE 1 (up to its first NUL)."""
import sys
import pefile

pe = pefile.PE(sys.argv[1])
for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
    if str(t.name) != 'PPDFILE':
        continue
    for r in t.directory.entries:
        if r.id == 1 or str(r.name) == '1':
            e = r.directory.entries[0].data.struct
            data = pe.get_data(e.OffsetToData, e.Size)
            open(sys.argv[2], 'wb').write(data.split(b'\0', 1)[0])
            sys.exit(0)
sys.exit('ppd.py: no PPDFILE 1 in ' + sys.argv[1])
