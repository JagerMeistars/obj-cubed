// Compare real vanilla OIT at a rasterized hit depth with the portable helper
// at an unrelated proxy depth. Uses a private surfaceless EGL context, no window.
// cc depth-test.c -o depth-test $(pkg-config --cflags --libs epoxy) -lm
// ./depth-test /path/to/verify-output/gpu-cases.tsv
#define _POSIX_C_SOURCE 200809L
#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void fail(const char *message) {
    fprintf(stderr, "%s (GL 0x%x, EGL 0x%x)\n", message, glGetError(), eglGetError());
    exit(1);
}
static char *readfile(const char *path) {
    FILE *file = fopen(path, "rb");
    if (!file) { perror(path); exit(1); }
    fseek(file, 0, SEEK_END); long length = ftell(file); rewind(file);
    char *source = malloc((size_t)length + 1);
    if (!source || fread(source, 1, (size_t)length, file) != (size_t)length) exit(1);
    source[length] = 0; fclose(file); return source;
}
static GLuint shader(GLenum type, const char *source) {
    GLuint result = glCreateShader(type);
    glShaderSource(result, 1, &source, NULL); glCompileShader(result);
    GLint okay; glGetShaderiv(result, GL_COMPILE_STATUS, &okay);
    if (!okay) { char log[16384]; glGetShaderInfoLog(result, sizeof log, NULL, log); fail(log); }
    return result;
}
static GLuint program(const char *fragmentPath, GLuint vertex) {
    char *source = readfile(fragmentPath);
    GLuint fragment = shader(GL_FRAGMENT_SHADER, source); free(source);
    GLuint result = glCreateProgram(); glAttachShader(result, vertex); glAttachShader(result, fragment);
    glLinkProgram(result); glDeleteShader(fragment);
    GLint okay; glGetProgramiv(result, GL_LINK_STATUS, &okay);
    if (!okay) { char log[16384]; glGetProgramInfoLog(result, sizeof log, NULL, log); fail(log); }
    GLuint input = glGetUniformBlockIndex(result, "TestInput");
    GLuint projection = glGetUniformBlockIndex(result, "Projection");
    if (input != GL_INVALID_INDEX) glUniformBlockBinding(result, input, 0);
    if (projection != GL_INVALID_INDEX) glUniformBlockBinding(result, projection, 1);
    glUseProgram(result);
    glUniform1i(glGetUniformLocation(result, "DepthBoundsSampler"), 0);
    const char *coefficients[] = {"Coeff0", "Coeff1", "Coeff2", "Coeff3"};
    for (int i = 0; i < 4; i++) glUniform1i(glGetUniformLocation(result, coefficients[i]), i + 1);
    return result;
}
static GLuint texture(const float *values) {
    GLuint result; glGenTextures(1, &result); glBindTexture(GL_TEXTURE_2D, result);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, 1, 1, 0, GL_RGBA, GL_FLOAT, values);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    return result;
}

static GLuint inputBuffer;
static void draw(GLuint p, int custom, int zeroToOne, float hitDepth, float hitW, int targets, int sceneTest, float *values) {
    float input[8] = {0, 0, (zeroToOne ? hitDepth : hitDepth * 2 - 1) * hitW, hitW, 0, 0.65f, 0, 0};
    memcpy(input + 4, &custom, sizeof custom);
    glBindBuffer(GL_UNIFORM_BUFFER, inputBuffer); glBufferSubData(GL_UNIFORM_BUFFER, 0, sizeof input, input);
    glUseProgram(p);
    // The custom path always rasterizes a valid proxy at another depth.
    float rasterDepth = custom ? 0.47f : hitDepth;
    float rasterW = custom ? 1.0f : hitW;
    glUniform1f(glGetUniformLocation(p, "rasterClipZ"), (zeroToOne ? rasterDepth : rasterDepth * 2 - 1) * rasterW);
    glUniform1f(glGetUniformLocation(p, "rasterClipW"), rasterW);
    const float clear[] = {-9, -9, -9, -9};
    for (int i = 0; i < targets; i++) glClearBufferfv(GL_COLOR, i, clear);
    // A second scenario uses vanilla OIT's opaque-scene depth rejection:
    // reversed GEQUAL, depth writes disabled, existing scene at depth 0.5.
    glDepthMask(GL_TRUE);
    float depthClear = sceneTest ? 0.5f : 0.04f;
    glClearBufferfv(GL_DEPTH, 0, &depthClear);
    glDepthFunc(sceneTest ? GL_GEQUAL : GL_ALWAYS);
    glDepthMask(sceneTest ? GL_FALSE : GL_TRUE);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    for (int i = 0; i < targets; i++) {
        glReadBuffer(GL_COLOR_ATTACHMENT0 + i);
        glReadPixels(0, 0, 1, 1, GL_RGBA, GL_FLOAT, values + i * 4);
    }
    glReadPixels(0, 0, 1, 1, GL_DEPTH_COMPONENT, GL_FLOAT, values + targets * 4);
    if (glGetError() != GL_NO_ERROR) fail("draw/readback failed");
}

int main(int argc, char **argv) {
    if (argc != 2) { fprintf(stderr, "usage: %s gpu-cases.tsv\n", argv[0]); return 2; }
    PFNEGLGETPLATFORMDISPLAYEXTPROC platform = (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay display = platform ? platform(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL) : eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (!eglInitialize(display, NULL, NULL) || !eglBindAPI(EGL_OPENGL_API)) { fprintf(stderr, "EGL setup failed\n"); return 2; }
    EGLint attributes[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE};
    EGLConfig configuration; EGLint count;
    if (!eglChooseConfig(display, attributes, &configuration, 1, &count) || !count) return 2;
    EGLint contextAttributes[] = {EGL_CONTEXT_MAJOR_VERSION, 4, EGL_CONTEXT_MINOR_VERSION, 5,
        EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE};
    EGLContext context = eglCreateContext(display, configuration, EGL_NO_CONTEXT, contextAttributes);
    EGLint surfaceAttributes[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE};
    EGLSurface surface = eglCreatePbufferSurface(display, configuration, surfaceAttributes);
    if (context == EGL_NO_CONTEXT || surface == EGL_NO_SURFACE || !eglMakeCurrent(display, surface, surface, context)) return 2;
    printf("GPU: %s; OpenGL %s\n", glGetString(GL_RENDERER), glGetString(GL_VERSION));
    GLuint vertex = shader(GL_VERTEX_SHADER,
        "#version 450\nuniform float rasterClipZ; uniform float rasterClipW;\n"
        "void main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));"
        "gl_Position=vec4(p[gl_VertexID]*rasterClipW,rasterClipZ,rasterClipW);}");
    GLuint vao; glGenVertexArrays(1, &vao); glBindVertexArray(vao);
    GLuint framebuffer; glGenFramebuffers(1, &framebuffer); glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    GLuint outputs[4]; for (int i = 0; i < 4; i++) {
        outputs[i] = texture(NULL); glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0 + i, GL_TEXTURE_2D, outputs[i], 0);
    }
    GLuint depth; glGenTextures(1, &depth); glBindTexture(GL_TEXTURE_2D, depth);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT32F, 1, 1, 0, GL_DEPTH_COMPONENT, GL_FLOAT, NULL);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, depth, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) fail("incomplete framebuffer");
    GLuint samplers[5];
    const float bounds[] = {-0.5f, 20.0f, 1.0f, 0.0f};
    const float coeffs[4][4] = {{0.18f, 0.025f, -0.012f, 0.007f}, {0.003f,-0.002f,0.001f,0.004f}, {0.002f,0,0.001f,0}, {0,-0.001f,0,0.002f}};
    for (int i = 0; i < 5; i++) { glActiveTexture(GL_TEXTURE0 + i); samplers[i] = texture(i ? coeffs[i - 1] : bounds); }
    glGenBuffers(1, &inputBuffer); glBindBuffer(GL_UNIFORM_BUFFER, inputBuffer);
    glBufferData(GL_UNIFORM_BUFFER, 32, NULL, GL_DYNAMIC_DRAW); glBindBufferBase(GL_UNIFORM_BUFFER, 0, inputBuffer);
    float projection[16] = {1,0,0,0, 0,1,0,0, 0,0,0,0, 0,0,1,1};
    GLuint projectionBuffer; glGenBuffers(1, &projectionBuffer); glBindBuffer(GL_UNIFORM_BUFFER, projectionBuffer);
    glBufferData(GL_UNIFORM_BUFFER, sizeof projection, projection, GL_STATIC_DRAW); glBindBufferBase(GL_UNIFORM_BUFFER, 1, projectionBuffer);
    glViewport(0, 0, 1, 1); glEnable(GL_DEPTH_TEST); glDepthFunc(GL_ALWAYS); glDepthMask(GL_TRUE); glDisable(GL_BLEND);
    FILE *cases = fopen(argv[1], "r"); if (!cases) { perror(argv[1]); return 1; }
    char *line = NULL; size_t capacity = 0; int comparisons = 0, programs = 0;
    while (getline(&line, &capacity, cases) >= 0) {
        line[strcspn(line, "\r\n")] = 0;
        char *state, *name = strtok_r(line, "\t", &state), *customPath = strtok_r(NULL, "\t", &state), *referencePath = strtok_r(NULL, "\t", &state);
        char *targetsText = strtok_r(NULL, "\t", &state), *zeroText = strtok_r(NULL, "\t", &state);
        if (!name || !customPath || !referencePath || !targetsText || !zeroText) fail("malformed case row");
        int targets = atoi(targetsText), zeroToOne = atoi(zeroText);
        GLenum buffers[] = {GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1, GL_COLOR_ATTACHMENT2, GL_COLOR_ATTACHMENT3};
        glDrawBuffers(targets, buffers); glClipControl(GL_LOWER_LEFT, zeroToOne ? GL_ZERO_TO_ONE : GL_NEGATIVE_ONE_TO_ONE);
        GLuint custom = program(customPath, vertex), reference = program(referencePath, vertex);
        const float depths[] = {0.27f, 0.79f, -0.2f, 1.2f, 0.62f, 0.62f};
        const float ws[] = {1, 1, 1, 1, 2, -1};
        for (int sceneTest = 0; sceneTest < 2; sceneTest++) for (int hit = 0; hit < 6; hit++) {
            float actual[17], expected[17];
            draw(reference, 0, zeroToOne, depths[hit], ws[hit], targets, sceneTest, expected);
            draw(custom, 1, zeroToOne, depths[hit], ws[hit], targets, sceneTest, actual);
            for (int i = 0; i <= targets * 4; i++) {
                float tolerance = fmaxf(0.000002f, fabsf(expected[i]) * 0.00002f);
                if (!isfinite(actual[i]) || !isfinite(expected[i]) || fabsf(actual[i] - expected[i]) > tolerance) {
                    fprintf(stderr, "FAIL %s sceneTest=%d hit=%d component=%d expected=%g actual=%g\n", name, sceneTest, hit, i, expected[i], actual[i]);
                    return 1;
                }
            }
            comparisons++;
        }
        glDeleteProgram(custom); glDeleteProgram(reference); programs += 2;
    }
    free(line); fclose(cases);
    printf("PASS: %d golden render comparisons across %d programs; color/OIT coefficients and depth agree\n", comparisons, programs);
    glDeleteShader(vertex); glDeleteBuffers(1, &inputBuffer); glDeleteBuffers(1, &projectionBuffer);
    glDeleteTextures(4, outputs); glDeleteTextures(5, samplers); glDeleteTextures(1, &depth);
    glDeleteFramebuffers(1, &framebuffer); glDeleteVertexArrays(1, &vao);
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroySurface(display, surface); eglDestroyContext(display, context); eglTerminate(display);
    return 0;
}
