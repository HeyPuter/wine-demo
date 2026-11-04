dejavusans-symbols.ttf: DejaVu Sans 2.37 (Debian fonts-dejavu-core 2.37-6, /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf)
cut to its arrows, technical symbols, box drawing, geometric shapes, symbols and dingbats (U+2190-21FF,
U+2300-23FF, U+2500-27BF, U+2B00-2BFF), unhinted, by fonttools' pyftsubset:
  pyftsubset DejaVuSans.ttf --unicodes='U+2190-21FF,U+2300-23FF,U+2500-25FF,U+2600-26FF,U+2700-27BF,U+2B00-2BFF' \
    --layout-features='' --no-hinting --name-IDs='*' --name-languages='*' --output-file=dejavusans-symbols.ttf
The page's font links (mkbundle.sh) put it after every font's own glyphs: Wine's Tahoma has none of these
(Notepad++'s menu bar drew its ▼ and ✕ as boxes). License: DejaVu-LICENSE.txt (Bitstream Vera), shipped as
C:\Program Files\Licenses\DejaVu-LICENSE.txt.
