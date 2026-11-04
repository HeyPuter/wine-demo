/* addprinter.exe NAME PORT: mkapps.sh's printer: Wine's PostScript driver (wineps.drv and generic.ppd,
   already in GetPrinterDriverDirectoryW) and a printer NAME on the file port PORT, the default one.
   WN's recipe (wineps as the print processor: WinPrint takes RAW only, and gdi spools NT EMF). */
#include <windows.h>
#include <winspool.h>
#include <stdio.h>
int wmain(int argc, WCHAR **argv)
{
    if (argc != 3) { fprintf(stderr, "usage: addprinter NAME PORT\n"); return 2; }
    DRIVER_INFO_3W d = {0};
    d.cVersion = 3; d.pName = L"Wine PostScript Driver";
    d.pDriverPath = L"wineps.drv"; d.pDataFile = L"generic.ppd"; d.pConfigFile = L"wineps.drv";
    if (!AddPrinterDriverW(NULL, 3, (BYTE *)&d)) { printf("AddPrinterDriverW failed: %lu\n", GetLastError()); return 1; }
    PRINTER_INFO_2W p = {0};
    p.pPrinterName = argv[1]; p.pPortName = argv[2]; p.pDriverName = d.pName;
    p.pPrintProcessor = L"wineps"; p.pDatatype = L"RAW"; p.Attributes = PRINTER_ATTRIBUTE_LOCAL;
    HANDLE h = AddPrinterW(NULL, 2, (BYTE *)&p);
    if (!h) { printf("AddPrinterW failed: %lu\n", GetLastError()); return 1; }
    ClosePrinter(h);
    if (!SetDefaultPrinterW(argv[1])) { printf("SetDefaultPrinterW failed: %lu\n", GetLastError()); return 1; }
    WCHAR def[256]; DWORD n = 256;
    GetDefaultPrinterW(def, &n);
    printf("addprinter: %ls on %ls, default %ls\n", argv[1], argv[2], def);
    return 0;
}
