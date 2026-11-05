/* gfxtri.c: the app sweep's graphics rows, a window drawing a spinning triangle each frame through Direct3D 9
 * (-DAPI_D3D9), Direct3D 8 (-DAPI_D3D8) or OpenGL 1.1 (-DAPI_GL), its title "gfxtri <api> <frames>" (the sweep
 * reads the frame count from it). A failure to create the device is a message box naming the call and its
 * HRESULT, as a game's would be. */
#include <windows.h>
#include <math.h>
#include <stdio.h>

#if defined(API_D3D9)
#include <d3d9.h>
#define API "d3d9"
#elif defined(API_D3D8)
#include <d3d8.h>
#define API "d3d8"
#elif defined(API_GL)
#include <GL/gl.h>
#define API "gl"
#else
#error API_D3D9, API_D3D8 or API_GL
#endif

#define W 640
#define H 480

struct vtx { float x, y, z, rhw; DWORD color; };
#define FVF (D3DFVF_XYZRHW | D3DFVF_DIFFUSE)

static void fail(const char *what, long hr)
{
    char msg[256];
    snprintf(msg, sizeof(msg), "gfxtri " API ": %s failed (0x%08lx)", what, (unsigned long)hr);
    MessageBoxA(NULL, msg, "gfxtri error", MB_OK | MB_ICONERROR);
    ExitProcess(1);
}

static LRESULT CALLBACK wndproc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcA(hwnd, msg, wp, lp);
}

static void triangle(float t, float *xy)
{
    int i;
    for (i = 0; i < 3; i++)
    {
        float a = t + i * 2.0943951f;
        xy[i * 2] = W / 2 + cosf(a) * 180;
        xy[i * 2 + 1] = H / 2 + sinf(a) * 180;
    }
}

int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmd, int show)
{
    WNDCLASSA wc = { 0, wndproc, 0, 0, inst, NULL, LoadCursor(NULL, IDC_ARROW), NULL, NULL, "gfxtri" };
    RECT r = { 0, 0, W, H };
    HWND hwnd;
    MSG m;
    unsigned long frames = 0;
    DWORD start = GetTickCount(), titled = 0;
    char title[64];
    static const DWORD colors[3] = { 0xffff3030, 0xff30ff30, 0xff3030ff };
    float xy[6];
    int i;
#if defined(API_D3D9)
    IDirect3D9 *d3d;
    IDirect3DDevice9 *dev;
    D3DPRESENT_PARAMETERS pp = { 0 };
    HRESULT hr;
#elif defined(API_D3D8)
    IDirect3D8 *d3d;
    IDirect3DDevice8 *dev;
    D3DPRESENT_PARAMETERS pp = { 0 };
    D3DDISPLAYMODE mode;
    HRESULT hr;
#else
    HDC dc;
    HGLRC rc;
    PIXELFORMATDESCRIPTOR pfd = { sizeof(pfd), 1, PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER, PFD_TYPE_RGBA, 32 };
    int pf;
#endif

    RegisterClassA(&wc);
    AdjustWindowRect(&r, WS_OVERLAPPEDWINDOW, FALSE);
    hwnd = CreateWindowA("gfxtri", "gfxtri " API, WS_OVERLAPPEDWINDOW, 40, 40, r.right - r.left, r.bottom - r.top, NULL, NULL, inst, NULL);
    ShowWindow(hwnd, show);

#if defined(API_D3D9)
    if (!(d3d = Direct3DCreate9(D3D_SDK_VERSION))) fail("Direct3DCreate9", 0);
    pp.Windowed = TRUE;
    pp.SwapEffect = D3DSWAPEFFECT_DISCARD;
    pp.BackBufferFormat = D3DFMT_UNKNOWN;
    if (FAILED(hr = IDirect3D9_CreateDevice(d3d, D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, hwnd, D3DCREATE_SOFTWARE_VERTEXPROCESSING, &pp, &dev)))
        fail("IDirect3D9::CreateDevice", hr);
    IDirect3DDevice9_SetFVF(dev, FVF);
#elif defined(API_D3D8)
    if (!(d3d = Direct3DCreate8(D3D_SDK_VERSION))) fail("Direct3DCreate8", 0);
    if (FAILED(hr = IDirect3D8_GetAdapterDisplayMode(d3d, D3DADAPTER_DEFAULT, &mode))) fail("IDirect3D8::GetAdapterDisplayMode", hr);
    pp.Windowed = TRUE;
    pp.SwapEffect = D3DSWAPEFFECT_DISCARD;
    pp.BackBufferFormat = mode.Format;
    if (FAILED(hr = IDirect3D8_CreateDevice(d3d, D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, hwnd, D3DCREATE_SOFTWARE_VERTEXPROCESSING, &pp, &dev)))
        fail("IDirect3D8::CreateDevice", hr);
    IDirect3DDevice8_SetVertexShader(dev, FVF);
#else
    dc = GetDC(hwnd);
    if (!(pf = ChoosePixelFormat(dc, &pfd))) fail("ChoosePixelFormat", GetLastError());
    if (!SetPixelFormat(dc, pf, &pfd)) fail("SetPixelFormat", GetLastError());
    if (!(rc = wglCreateContext(dc))) fail("wglCreateContext", GetLastError());
    if (!wglMakeCurrent(dc, rc)) fail("wglMakeCurrent", GetLastError());
    glViewport(0, 0, W, H);
    glMatrixMode(GL_PROJECTION);
    glLoadIdentity();
    glOrtho(0, W, H, 0, -1, 1);
#endif

    for (;;)
    {
        while (PeekMessageA(&m, NULL, 0, 0, PM_REMOVE))
        {
            if (m.message == WM_QUIT) return 0;
            TranslateMessage(&m);
            DispatchMessageA(&m);
        }
        triangle((GetTickCount() - start) / 1000.0f, xy);
#if defined(API_D3D9) || defined(API_D3D8)
        {
            struct vtx v[3];
            for (i = 0; i < 3; i++) { v[i].x = xy[i * 2]; v[i].y = xy[i * 2 + 1]; v[i].z = 0.5f; v[i].rhw = 1; v[i].color = colors[i]; }
#if defined(API_D3D9)
            IDirect3DDevice9_Clear(dev, 0, NULL, D3DCLEAR_TARGET, 0xff203050, 1.0f, 0);
            IDirect3DDevice9_BeginScene(dev);
            IDirect3DDevice9_DrawPrimitiveUP(dev, D3DPT_TRIANGLELIST, 1, v, sizeof(v[0]));
            IDirect3DDevice9_EndScene(dev);
            if (FAILED(hr = IDirect3DDevice9_Present(dev, NULL, NULL, NULL, NULL))) fail("IDirect3DDevice9::Present", hr);
#else
            IDirect3DDevice8_Clear(dev, 0, NULL, D3DCLEAR_TARGET, 0xff203050, 1.0f, 0);
            IDirect3DDevice8_BeginScene(dev);
            IDirect3DDevice8_DrawPrimitiveUP(dev, D3DPT_TRIANGLELIST, 1, v, sizeof(v[0]));
            IDirect3DDevice8_EndScene(dev);
            if (FAILED(hr = IDirect3DDevice8_Present(dev, NULL, NULL, NULL, NULL))) fail("IDirect3DDevice8::Present", hr);
#endif
        }
#else
        glClearColor(0.125f, 0.19f, 0.31f, 1);
        glClear(GL_COLOR_BUFFER_BIT);
        glBegin(GL_TRIANGLES);
        for (i = 0; i < 3; i++)
        {
            glColor3ub(colors[i] >> 16, colors[i] >> 8, colors[i]);
            glVertex2f(xy[i * 2], xy[i * 2 + 1]);
        }
        glEnd();
        SwapBuffers(dc);
#endif
        frames++;
        if (GetTickCount() - titled >= 1000)
        {
            titled = GetTickCount();
            snprintf(title, sizeof(title), "gfxtri " API " %lu", frames);
            SetWindowTextA(hwnd, title);
        }
    }
}
