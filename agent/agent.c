/* agent.exe: the launcher's side in the guest. The page drops a job (NAME.job, key=value lines) into
   C:\windemo\queue; the agent takes jobs one at a time. When `check` (a path) is missing, the app is not
   installed yet: the installer C:\users\gex\Downloads\`file` (the page puts it there; else the agent
   downloads `url` to it) runs as it would for anyone, its own windows up and nothing scripted (an .msi
   through msiexec /i; a .zip, which has no installer, through 7-Zip's own extraction window into
   C:\Program Files\NAME), and the agent waits for it to end. Then, when `check` exists, it runs `launch` (a
   cmd line); when it does not, the user cancelled, and the job ends there. Each job's state is the title
   of a 1x1 tool window, "windemo-job ID STATE DETAIL", which the page reads from the desktop's window list:
   STATE is downloading (DETAIL: bytes done/total), installer (the installer's UI is up to the user),
   launching, started, cancelled (the installer ended and the app is not there) or failed (DETAIL: why). */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wininet.h>
#include <stdio.h>
#include <string.h>

#define QUEUE L"C:\\windemo\\queue"
#define DOWNLOADS L"C:\\users\\gex\\Downloads"

/* the job being worked on: its status window and id (a job taken while an installer runs nests in it) */
static HWND status, owner;
static HINSTANCE hinst;
static WCHAR job_id[64];
static void poll_queue(void);

static void say(const WCHAR *state, const WCHAR *fmt, ...)
{
    WCHAR detail[512] = L"", title[700];
    if (fmt) { va_list a; va_start(a, fmt); _vsnwprintf(detail, 511, fmt, a); va_end(a); }
    _snwprintf(title, 699, L"windemo-job %s %s %s", job_id, state, detail);
    SetWindowTextW(status, title);
    /* a repaint, so the desktop's compositor takes the new title with the window's next frame */
    RedrawWindow(status, NULL, NULL, RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_UPDATENOW);
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

/* the installer at PATH as a visitor would run it (an .msi through msiexec /i; a .zip unpacked by 7-Zip's
   extraction window into C:\Program Files\NAME, as a visitor with 7-Zip would), shown; its exit code, -1: it
   did not start */
static int run_installer(const WCHAR *path, const WCHAR *name)
{
    WCHAR cmd[MAX_PATH * 3 + 128];
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    DWORD code = 0;
    size_t n = wcslen(path);
    if (n > 4 && !_wcsicmp(path + n - 4, L".msi")) _snwprintf(cmd, MAX_PATH * 3 + 127, L"C:\\windows\\system32\\msiexec.exe /i \"%s\"", path);
    else if (n > 4 && !_wcsicmp(path + n - 4, L".zip"))
        _snwprintf(cmd, MAX_PATH * 3 + 127, L"\"C:\\Program Files\\7-Zip\\7zG.exe\" x \"%s\" \"-oC:\\Program Files\\%s\"", path, name);
    else _snwprintf(cmd, MAX_PATH * 3 + 127, L"\"%s\"", path);
    si.dwFlags = STARTF_USESHOWWINDOW; si.wShowWindow = SW_SHOWNORMAL;
    if (!CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, DOWNLOADS, &si, &pi)) return -1;
    CloseHandle(pi.hThread);
    /* while it runs (as long as the user takes), the agent's messages and other jobs go on */
    for (;;)
    {
        DWORD r = MsgWaitForMultipleObjects(1, &pi.hProcess, FALSE, 300, QS_ALLINPUT);
        if (r == WAIT_OBJECT_0 || r == WAIT_FAILED) break;
        poll_queue();
    }
    GetExitCodeProcess(pi.hProcess, &code); CloseHandle(pi.hProcess);
    return code;
}

static void take_job(const WCHAR *path)
{
    WCHAR text[8192] = L"", name[128], url[2048], file[MAX_PATH], check[MAX_PATH], launch[2048];
    WCHAR dl[MAX_PATH * 2];
    char raw[16384];
    DWORD n = 0;
    HANDLE f = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f == INVALID_HANDLE_VALUE) return;
    ReadFile(f, raw, sizeof(raw) - 1, &n, NULL); CloseHandle(f); raw[n] = 0;
    DeleteFileW(path);
    MultiByteToWideChar(CP_UTF8, 0, raw, -1, text, 8191);
    field(text, L"id", job_id, 64); field(text, L"name", name, 128); field(text, L"url", url, 2048);
    field(text, L"file", file, MAX_PATH); field(text, L"check", check, MAX_PATH); field(text, L"launch", launch, 2048);
    if (!job_id[0]) return;
    if (check[0]) { WCHAR x[MAX_PATH]; if (ExpandEnvironmentStringsW(check, x, MAX_PATH)) wcscpy(check, x); }
    if (file[0] && !(check[0] && exists(check)))
    {
        CreateDirectoryW(DOWNLOADS, NULL);
        _snwprintf(dl, MAX_PATH * 2 - 1, L"%s\\%s", DOWNLOADS, file);
        if (!exists(dl) && (!url[0] || !download(url, dl))) { if (!url[0]) say(L"failed", L"no installer"); return; }
        say(L"installer", NULL);
        int rc = run_installer(dl, name);
        if (rc < 0) { say(L"failed", L"the installer did not start (%lu)", GetLastError()); return; }
        if (check[0] && !exists(check)) { say(L"cancelled", L"%d", rc); return; }
    }
    if (launch[0])
    {
        say(L"launching", NULL);
        if (run(launch, L"C:\\users\\gex\\Desktop", FALSE) < 0) { say(L"failed", L"%s did not start", name); return; }
    }
    say(L"started", NULL);
}

/* a job in its own status window (gone 15 s after the job ends), the outer job's restored after it */
static void take(const WCHAR *path)
{
    HWND outer = status;
    WCHAR outer_id[64];
    wcscpy(outer_id, job_id);
    job_id[0] = 0;
    status = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, L"WindemoAgent", L"windemo-job - taking", WS_POPUP,
                             0, 0, 1, 1, owner, NULL, hinst, NULL);
    ShowWindow(status, SW_SHOWNOACTIVATE);
    take_job(path);
    SetTimer(status, 1, 15000, NULL);
    status = outer;
    wcscpy(job_id, outer_id);
}

static LRESULT CALLBACK proc(HWND w, UINT msg, WPARAM wp, LPARAM lp)
{
    if (msg == WM_TIMER) { DestroyWindow(w); return 0; }
    return DefWindowProcW(w, msg, wp, lp);
}

static void poll_queue(void)
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
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, WCHAR *cmdline, int show)
{
    WNDCLASSW wc = { 0 };
    wc.lpfnWndProc = proc; wc.hInstance = inst; wc.lpszClassName = L"WindemoAgent";
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    RegisterClassW(&wc);
    hinst = inst;
    /* the status windows' owner, never shown, so no taskbar shows a button for them (the page reads their titles) */
    owner = CreateWindowExW(WS_EX_TOOLWINDOW, L"WindemoAgent", L"", WS_POPUP, 0, 0, 0, 0, NULL, NULL, inst, NULL);
    CreateDirectoryW(L"C:\\windemo", NULL); CreateDirectoryW(QUEUE, NULL);
    for (;;)
    {
        poll_queue();
        MsgWaitForMultipleObjects(0, NULL, FALSE, 300, QS_ALLINPUT);
    }
}
