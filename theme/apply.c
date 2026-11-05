/* apply.exe THEME.msstyles: makes THEME the prefix's visual style as winecfg's Desktop tab does (uxtheme's
 * OpenThemeFile and ApplyTheme, by ordinal), so its colors and metrics are written to the registry too. */
#include <windows.h>
#include <stdio.h>

typedef HRESULT (WINAPI *open_fn)(LPCWSTR, LPCWSTR, LPCWSTR, HANDLE *, DWORD);
typedef HRESULT (WINAPI *apply_fn)(HANDLE, char *, HWND);
typedef HRESULT (WINAPI *close_fn)(HANDLE);

int wmain(int argc, WCHAR **argv)
{
    HMODULE ux = LoadLibraryW(L"uxtheme.dll");
    open_fn open = (open_fn)GetProcAddress(ux, (LPCSTR)2);
    close_fn close = (close_fn)GetProcAddress(ux, (LPCSTR)3);
    apply_fn apply = (apply_fn)GetProcAddress(ux, (LPCSTR)4);
    HANDLE theme;
    HRESULT hr;
    char b[] = "";

    if (argc != 2 || !open || !apply) { printf("apply: usage apply.exe THEME.msstyles\n"); return 2; }
    if (FAILED(hr = open(argv[1], NULL, NULL, &theme, 0))) { printf("apply: OpenThemeFile %08lx\n", hr); return 1; }
    hr = apply(theme, b, NULL);
    close(theme);
    if (FAILED(hr)) { printf("apply: ApplyTheme %08lx\n", hr); return 1; }
    printf("apply: %ls\n", argv[1]);
    return 0;
}
