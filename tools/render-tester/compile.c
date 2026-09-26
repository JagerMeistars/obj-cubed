// Compile and link expanded shaders on a real headless OpenGL driver.
// Usage: ./compile vertex.glsl fragment.glsl [major.minor]
// Reports context failures explicitly; defaults to 4.5 for the shipped shaders.
#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <stdio.h>
#include <stdlib.h>

static void failEGL(const char* operation) {
    fprintf(stderr, "%s failed (EGL error 0x%x)\n", operation, eglGetError());
    exit(4);
}

static char* slurp(const char* path) {
    FILE* file = fopen(path, "rb");
    if (!file) { perror(path); exit(1); }
    if (fseek(file, 0, SEEK_END)) { perror(path); exit(1); }
    long length = ftell(file);
    if (length < 0 || fseek(file, 0, SEEK_SET)) { perror(path); exit(1); }
    char* source = malloc((size_t)length + 1);
    if (!source || fread(source, 1, (size_t)length, file) != (size_t)length) {
        fprintf(stderr, "cannot read %s\n", path); exit(1);
    }
    source[length] = 0;
    fclose(file);
    return source;
}

static GLuint compileStage(GLenum type, const char* path) {
    char* source = slurp(path);
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, (const char**)&source, NULL);
    free(source);
    glCompileShader(shader);
    GLint ok = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    char log[8192];
    GLsizei length = 0;
    glGetShaderInfoLog(shader, sizeof log, &length, log);
    if (length) fprintf(stderr, "[%s]\n%s\n", path, log);
    if (!ok) { fprintf(stderr, "COMPILE FAILED: %s\n", path); exit(2); }
    return shader;
}

int main(int argc, char** argv) {
    if (argc < 3 || argc > 4) {
        fprintf(stderr, "usage: %s vertex.glsl fragment.glsl [major.minor]\n", argv[0]);
        return 1;
    }
    int major = 4, minor = 5;
    if (argc == 4 && sscanf(argv[3], "%d.%d", &major, &minor) != 2) {
        fprintf(stderr, "invalid GL version: %s\n", argv[3]); return 1;
    }
    PFNEGLGETPLATFORMDISPLAYEXTPROC getDisplay =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay display = getDisplay
        ? getDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL)
        : eglGetDisplay(EGL_DEFAULT_DISPLAY);
    EGLint eglMajor, eglMinor;
    if (display == EGL_NO_DISPLAY || !eglInitialize(display, &eglMajor, &eglMinor)) failEGL("eglInitialize");
    if (!eglBindAPI(EGL_OPENGL_API)) failEGL("eglBindAPI");
    EGLint configAttributes[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE};
    EGLConfig config;
    EGLint configCount;
    if (!eglChooseConfig(display, configAttributes, &config, 1, &configCount) || !configCount) failEGL("eglChooseConfig");
    EGLint contextAttributes[] = {EGL_CONTEXT_MAJOR_VERSION, major, EGL_CONTEXT_MINOR_VERSION, minor,
        EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE};
    EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttributes);
    if (context == EGL_NO_CONTEXT) failEGL("eglCreateContext");
    EGLint surfaceAttributes[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE};
    EGLSurface surface = eglCreatePbufferSurface(display, config, surfaceAttributes);
    if (surface == EGL_NO_SURFACE) failEGL("eglCreatePbufferSurface");
    if (!eglMakeCurrent(display, surface, surface, context)) failEGL("eglMakeCurrent");
    printf("GL %s on %s\n", glGetString(GL_VERSION), glGetString(GL_RENDERER));
    GLuint program = glCreateProgram();
    GLuint vertex = compileStage(GL_VERTEX_SHADER, argv[1]);
    GLuint fragment = compileStage(GL_FRAGMENT_SHADER, argv[2]);
    glAttachShader(program, vertex);
    glAttachShader(program, fragment);
    glLinkProgram(program);
    GLint ok = 0;
    glGetProgramiv(program, GL_LINK_STATUS, &ok);
    char log[8192];
    GLsizei length = 0;
    glGetProgramInfoLog(program, sizeof log, &length, log);
    if (length) fprintf(stderr, "link log:\n%s\n", log);
    glDeleteProgram(program);
    glDeleteShader(vertex);
    glDeleteShader(fragment);
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroySurface(display, surface);
    eglDestroyContext(display, context);
    eglTerminate(display);
    if (!ok) { fprintf(stderr, "LINK FAILED\n"); return 3; }
    puts("LINK OK");
    return 0;
}
