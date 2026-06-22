// Render-tester foundation probe: headless EGL (surfaceless) -> GL 4.6 core ->
// render a full-screen red triangle into an FBO -> read back the centre pixel.
// If it prints 255 0 0 255 the whole headless-render approach is viable here.
#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <stdio.h>
#include <stdlib.h>

enum { W = 64, H = 64 };

static GLuint compile(GLenum type, const char* src) {
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, NULL);
    glCompileShader(s);
    GLint ok = 0; glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) { char log[2048]; glGetShaderInfoLog(s, sizeof log, NULL, log);
               fprintf(stderr, "shader compile error:\n%s\n", log); exit(2); }
    return s;
}

int main(void) {
    // eglGetPlatformDisplay (EGL 1.5 core) can't be resolved by epoxy before EGL is
    // initialized; the EXT variant is a client extension resolvable up front.
    PFNEGLGETPLATFORMDISPLAYEXTPROC getPlatformDisplayEXT =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC) eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay dpy = getPlatformDisplayEXT
        ? getPlatformDisplayEXT(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL)
        : eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (dpy == EGL_NO_DISPLAY) { fprintf(stderr, "no EGL display\n"); return 1; }
    EGLint maj, min;
    if (!eglInitialize(dpy, &maj, &min)) { fprintf(stderr, "eglInitialize failed\n"); return 1; }
    if (!eglBindAPI(EGL_OPENGL_API)) { fprintf(stderr, "bindAPI failed\n"); return 1; }

    EGLint cfgAttr[] = { EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
                         EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE };
    EGLConfig cfg; EGLint n = 0;
    if (!eglChooseConfig(dpy, cfgAttr, &cfg, 1, &n) || n < 1) { fprintf(stderr, "no config\n"); return 1; }

    EGLint ctxAttr[] = { EGL_CONTEXT_MAJOR_VERSION, 4, EGL_CONTEXT_MINOR_VERSION, 6,
                         EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE };
    EGLContext ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, ctxAttr);
    if (ctx == EGL_NO_CONTEXT) { fprintf(stderr, "no GL 4.6 core context\n"); return 1; }
    if (!eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx)) { fprintf(stderr, "makeCurrent failed\n"); return 1; }

    printf("GL_VERSION : %s\n", glGetString(GL_VERSION));
    printf("GL_RENDERER: %s\n", glGetString(GL_RENDERER));
    printf("subgroup ext present: %d\n", epoxy_has_gl_extension("GL_KHR_shader_subgroup"));

    GLuint tex; glGenTextures(1, &tex); glBindTexture(GL_TEXTURE_2D, tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    GLuint fbo; glGenFramebuffers(1, &fbo); glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) { fprintf(stderr, "FBO incomplete\n"); return 1; }
    glViewport(0, 0, W, H);
    glClearColor(0, 0, 0, 1); glClear(GL_COLOR_BUFFER_BIT);

    const char* vs = "#version 460 core\n"
        "const vec2 p[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));\n"
        "void main(){ gl_Position = vec4(p[gl_VertexID], 0, 1); }\n";
    const char* fs = "#version 460 core\nout vec4 c; void main(){ c = vec4(1,0,0,1); }\n";
    GLuint prog = glCreateProgram();
    glAttachShader(prog, compile(GL_VERTEX_SHADER, vs));
    glAttachShader(prog, compile(GL_FRAGMENT_SHADER, fs));
    glLinkProgram(prog);
    GLuint vao; glGenVertexArrays(1, &vao); glBindVertexArray(vao);
    glUseProgram(prog);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    glFinish();

    unsigned char px[4];
    glReadPixels(W/2, H/2, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px);
    printf("centre pixel RGBA = %d %d %d %d (expect 255 0 0 255)\n", px[0], px[1], px[2], px[3]);
    return (px[0] == 255 && px[1] == 0 && px[2] == 0) ? 0 : 3;
}
