/* agent.exe: the launcher's side in the guest. The page drops a job (NAME.job, key=value lines) into
   C:\windemo\queue; the agent takes jobs one at a time: when `check` (a path) is missing it downloads `url`
   to C:\users\gex\Downloads\`file` (when that is not there yet) and runs `install` (a cmd line, in the
   Downloads folder), then runs `launch` (a cmd line). Each job's state is the title of a 1x1 tool window,
   "windemo-job ID STATE DETAIL", which the page reads from the desktop's window list:
   STATE is queued, downloading (DETAIL: bytes done/total), installing, launching, started or failed (DETAIL:
   why). Without the window list (a program crash) the page has its own crash notice. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wininet.h>
#include <stdio.h>
#include <string.h>

#define QUEUE L"C:\\windemo\\queue"
#define DOWNLOADS L"C:\\users\\gex\\Downloads"

static HWND status;
static WCHAR job_id[64];

static void say(const WCHAR *state, const WCHAR *fmt, ...)
{
    WCHAR detail[512] = L"", title[700];
    if (fmt) { va_list a; va_start(a, fmt); _vsnwprintf(detail, 511, fmt, a); va_end(a); }
    _snwprintf(title, 699, L"windemo-job %s %s %s", job_id, state, detail);
    SetWindowTextW(status, title);
}

/* one key's value from the job's text, into out (empty when absent) */
static void field(const WCHAR *text, const WCHAR *key, WCHAR *out, int n)
{
    size_t k = wcslen(key);
    out[0] = 0;
    for (const WCHAR *l = text; l && *l; l = wcschr(l, L'\n') ? wcschr(l, L'\n') + 1 : NULL)
    {
        if (!wcsncmp(l, key, k) && l[k] == L'=')
        {
            const WCHAR *v = l + k + 1, *e = v;
            while (*e && *e != L'\n' && *e != L'\r') e++;
            if (e - v >= n) e = v + n - 1;
            memcpy(out, v, (e - v) * sizeof(WCHAR)); out[e - v] = 0;
            return;
        }
    }
}

static BOOL exists(const WCHAR *p) { return GetFileAttributesW(p) != INVALID_FILE_ATTRIBUTES; }

/* cmd /c LINE in DIR; its exit code, or -1 when it could not start */
static int run(const WCHAR *line, const WCHAR *dir, BOOL wait)
{
    WCHAR cmd[4200];
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    DWORD code = 0;
    _snwprintf(cmd, 4199, L"C:\\windows\\system32\\cmd.exe /d /c %s", line);
    si.dwFlags = STARTF_USESHOWWINDOW; si.wShowWindow = SW_HIDE;
    if (!CreateProcessW(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, dir, &si, &pi)) return -1;
    if (wait) { WaitForSingleObject(pi.hProcess, INFINITE); GetExitCodeProcess(pi.hProcess, &code); }
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return code;
}

static BOOL download(const WCHAR *url, const WCHAR *path)
{
    WCHAR part[MAX_PATH + 8];
    HINTERNET net, req;
    DWORD total = 0, len = sizeof(total), got, done = 0, last = 0;
    static char buf[1 << 16];
    HANDLE f;
    BOOL ok = FALSE;
    _snwprintf(part, MAX_PATH + 7, L"%s.part", path);
    if (!(net = InternetOpenW(L"windemo", INTERNET_OPEN_TYPE_PRECONFIG, NULL, NULL, 0))) { say(L"failed", L"no network (%lu)", GetLastError()); return FALSE; }
    if (!(req = InternetOpenUrlW(net, url, NULL, 0, INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE, 0)))
    { say(L"failed", L"the download did not start (%lu)", GetLastError()); InternetCloseHandle(net); return FALSE; }
    HttpQueryInfoW(req, HTTP_QUERY_CONTENT_LENGTH | HTTP_QUERY_FLAG_NUMBER, &total, &len, NULL);
    f = CreateFileW(part, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    if (f == INVALID_HANDLE_VALUE) { say(L"failed", L"cannot write %s", part); goto out; }
    say(L"downloading", L"0 %lu", total);
    while (InternetReadFile(req, buf, sizeof(buf), &got) && got)
    {
        DWORD w;
        if (!WriteFile(f, buf, got, &w, NULL) || w != got) { say(L"failed", L"cannot write %s", part); CloseHandle(f); goto out; }
        done += got;
        if (GetTickCount() - last > 300) { last = GetTickCount(); say(L"downloading", L"%lu %lu", done, total); }
    }
    CloseHandle(f);
    if (!done || (total && done != total)) { say(L"failed", L"the download stopped at %lu of %lu bytes", done, total); goto out; }
    ok = MoveFileExW(part, path, MOVEFILE_REPLACE_EXISTING);
    if (!ok) say(L"failed", L"cannot write %s", path);
out:
    if (!ok) DeleteFileW(part);
    InternetCloseHandle(req); InternetCloseHandle(net);
    return ok;
}

static void take(const WCHAR *path)
{
    WCHAR text[8192] = L"", name[128], url[2048], file[MAX_PATH], install[2048], check[MAX_PATH], launch[2048], okrc[128];
    WCHAR dl[MAX_PATH * 2];
    char raw[16384];
    DWORD n = 0;
    HANDLE f = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f == INVALID_HANDLE_VALUE) return;
    ReadFile(f, raw, sizeof(raw) - 1, &n, NULL); CloseHandle(f); raw[n] = 0;
    DeleteFileW(path);
    MultiByteToWideChar(CP_UTF8, 0, raw, -1, text, 8191);
    field(text, L"id", job_id, 64); field(text, L"name", name, 128); field(text, L"url", url, 2048);
    field(text, L"file", file, MAX_PATH); field(text, L"install", install, 2048); field(text, L"check", check, MAX_PATH);
    field(text, L"launch", launch, 2048); field(text, L"okrc", okrc, 128);
    if (!job_id[0]) return;
    if (check[0]) { WCHAR x[MAX_PATH]; if (ExpandEnvironmentStringsW(check, x, MAX_PATH)) wcscpy(check, x); }
    if (install[0] && !(check[0] && exists(check)))
    {
        CreateDirectoryW(DOWNLOADS, NULL);
        _snwprintf(dl, MAX_PATH * 2 - 1, L"%s\\%s", DOWNLOADS, file);
        if (url[0] && file[0] && !exists(dl) && !download(url, dl)) return;
        say(L"installing", NULL);
        int rc = run(install, DOWNLOADS, TRUE);
        WCHAR rcs[16]; _snwprintf(rcs, 15, L",%d,", rc);
        WCHAR oks[140]; _snwprintf(oks, 139, L",0,%s,", okrc);
        if (rc < 0) { say(L"failed", L"the installer did not start"); return; }
        if (!wcsstr(oks, rcs) && !(check[0] && exists(check))) { say(L"failed", L"the installer ended with %d", rc); return; }
        if (check[0] && !exists(check)) { say(L"failed", L"the installer ended without writing %s", check); return; }
    }
    if (launch[0])
    {
        say(L"launching", NULL);
        if (run(launch, L"C:\\users\\gex\\Desktop", FALSE) < 0) { say(L"failed", L"%s did not start", name); return; }
    }
    say(L"started", NULL);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, WCHAR *cmdline, int show)
{
    WNDCLASSW wc = { 0 };
    wc.lpfnWndProc = DefWindowProcW; wc.hInstance = inst; wc.lpszClassName = L"WindemoAgent";
    RegisterClassW(&wc);
    status = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, L"WindemoAgent", L"windemo-job - idle", WS_POPUP,
                             0, 0, 1, 1, NULL, NULL, inst, NULL);
    ShowWindow(status, SW_SHOWNOACTIVATE);
    CreateDirectoryW(L"C:\\windemo", NULL); CreateDirectoryW(QUEUE, NULL);
    for (;;)
    {
        MSG m; WIN32_FIND_DATAW fd; HANDLE h;
        while (PeekMessageW(&m, NULL, 0, 0, PM_REMOVE)) DispatchMessageW(&m);
        if ((h = FindFirstFileW(QUEUE L"\\*.job", &fd)) != INVALID_HANDLE_VALUE)
        {
            WCHAR p[MAX_PATH * 2];
            FindClose(h);
            _snwprintf(p, MAX_PATH * 2 - 1, L"%s\\%s", QUEUE, fd.cFileName);
            take(p);
        }
        MsgWaitForMultipleObjects(0, NULL, FALSE, 300, QS_ALLINPUT);
    }
}
