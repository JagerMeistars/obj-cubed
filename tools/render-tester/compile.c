// Render-tester phase B.1: compile + link the REAL obj³ core shaders (flattened by
// resolve.mjs) on a headless GL 4.6 context. Proves the shaders are valid on a real
// driver and that the #moj_import flattening produced compilable GLSL.
//   usage: ./compile entity.vert.glsl entity.frag.glsl
#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <stdio.h>
#include <stdlib.h>

static char* slurp(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(1); }
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    char* buf = malloc(n + 1); fread(buf, 1, n, f); buf[n] = 0; fclose(f);
    return buf;
}

static GLuint compileStage(GLenum type, const char* path) {
    char* src = slurp(path);
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, (const char**)&src, NULL);
    glCompileShader(s);
    GLint ok = 0; glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    char log[8192]; GLsizei ln = 0; glGetShaderInfoLog(s, sizeof log, &ln, log);
    if (ln) fprintf(stderr, "[%s] log:\n%s\n", path, log);
    if (!ok) { fprintf(stderr, "COMPILE FAILED: %s\n", path); exit(2); }
    printf("compiled OK: %s\n", path);
    free(src);
    return s;
}

static void initEGL(void) {
    PFNEGLGETPLATFORMDISPLAYEXTPROC getDpy =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC) eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay dpy = getDpy ? getDpy(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL)
                            : eglGetDisplay(EGL_DEFAULT_DISPLAY);
    EGLint a, b; eglInitialize(dpy, &a, &b); eglBindAPI(EGL_OPENGL_API);
    EGLint cfgAttr[] = { EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE };
    EGLConfig cfg; EGLint n; eglChooseConfig(dpy, cfgAttr, &cfg, 1, &n);
    EGLint ctxAttr[] = { EGL_CONTEXT_MAJOR_VERSION, 4, EGL_CONTEXT_MINOR_VERSION, 6,
                         EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE };
    EGLContext ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, ctxAttr);
    eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx);
}

int main(int argc, char** argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s vert.glsl frag.glsl\n", argv[0]); return 1; }
    initEGL();
    printf("GL %s on %s\n", glGetString(GL_VERSION), glGetString(GL_RENDERER));
    GLuint prog = glCreateProgram();
    glAttachShader(prog, compileStage(GL_VERTEX_SHADER, argv[1]));
    glAttachShader(prog, compileStage(GL_FRAGMENT_SHADER, argv[2]));
    glLinkProgram(prog);
    GLint ok = 0; glGetProgramiv(prog, GL_LINK_STATUS, &ok);
    char log[8192]; GLsizei ln = 0; glGetProgramInfoLog(prog, sizeof log, &ln, log);
    if (ln) fprintf(stderr, "link log:\n%s\n", log);
    if (!ok) { fprintf(stderr, "LINK FAILED\n"); return 3; }
    printf("LINK OK — obj3 entity shaders are valid on this driver.\n");
    return 0;
}
