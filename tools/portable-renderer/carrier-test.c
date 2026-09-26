// Approximate float-carrier precision measurement, not a renderer test.
#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int W = 64, H = 64;

static GLuint compile(GLenum type, const char *src) {
  GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, NULL);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[2048];
    glGetShaderInfoLog(s, sizeof log, NULL, log);
    fprintf(stderr, "shader compile error:\n%s\n", log);
    exit(2);
  }
  return s;
}

static char *read_file(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) {
    perror(path);
    exit(9);
  }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  rewind(f);
  char *s = calloc(n + 1, 1);
  fread(s, 1, n, f);
  fclose(f);
  return s;
}
static char *join(const char *a, const char *b, const char *c) {
  char *s = malloc(strlen(a) + strlen(b) + strlen(c) + 1);
  strcpy(s, a);
  strcat(s, b);
  strcat(s, c);
  return s;
}

int main(int argc, char **argv) {
  int benchmark = 0, precise = 0, cell = 8;
  const char *shader_path = "tools/portable-renderer/carrier.glsl";
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--full")) {
      W = 1920;
      H = 1080;
    } else if (!strcmp(argv[i], "--benchmark"))
      benchmark = 1;
    else if (!strcmp(argv[i], "--precise"))
      precise = 1;
    else if (!strcmp(argv[i], "--cell") && i + 1 < argc)
      cell = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--size") && i + 2 < argc) {
      W = atoi(argv[++i]);
      H = atoi(argv[++i]);
    } else if (!strcmp(argv[i], "--shader") && i + 1 < argc)
      shader_path = argv[++i];
    else {
      fprintf(stderr,
              "Usage: %s [--full | --size W H] [--precise] [--cell 4|8|16] "
              "[--benchmark] [--shader PATH]\n",
              argv[0]);
      return 1;
    }
  }
  if (cell != 4 && cell != 8 && cell != 16) {
    fprintf(stderr, "Cell size must be 4, 8, or 16\n");
    return 1;
  }
  if (W < 2 || H < 2 || W > 8192 || H > 8192) {
    fprintf(stderr, "Dimensions must be 2..8192\n");
    return 1;
  }

  // eglGetPlatformDisplay (EGL 1.5 core) can't be resolved by epoxy before EGL
  // is initialized; the EXT variant is a client extension resolvable up front.
  PFNEGLGETPLATFORMDISPLAYEXTPROC getPlatformDisplayEXT =
      (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress(
          "eglGetPlatformDisplayEXT");
  EGLDisplay dpy = getPlatformDisplayEXT
                       ? getPlatformDisplayEXT(EGL_PLATFORM_SURFACELESS_MESA,
                                               EGL_DEFAULT_DISPLAY, NULL)
                       : eglGetDisplay(EGL_DEFAULT_DISPLAY);
  if (dpy == EGL_NO_DISPLAY) {
    fprintf(stderr, "no EGL display\n");
    return 1;
  }
  EGLint maj, min;
  if (!eglInitialize(dpy, &maj, &min)) {
    fprintf(stderr, "eglInitialize failed\n");
    return 1;
  }
  if (!eglBindAPI(EGL_OPENGL_API)) {
    fprintf(stderr, "bindAPI failed\n");
    return 1;
  }

  EGLint cfgAttr[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE,
                      EGL_OPENGL_BIT, EGL_NONE};
  EGLConfig cfg;
  EGLint n = 0;
  if (!eglChooseConfig(dpy, cfgAttr, &cfg, 1, &n) || n < 1) {
    fprintf(stderr, "no config\n");
    return 1;
  }

  EGLint ctxAttr[] = {EGL_CONTEXT_MAJOR_VERSION,
                      3,
                      EGL_CONTEXT_MINOR_VERSION,
                      3,
                      EGL_CONTEXT_OPENGL_PROFILE_MASK,
                      EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
                      EGL_NONE};
  EGLContext ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, ctxAttr);
  if (ctx == EGL_NO_CONTEXT) {
    fprintf(stderr, "no GL 3.3 core context\n");
    return 1;
  }
  if (!eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx)) {
    fprintf(stderr, "makeCurrent failed\n");
    return 1;
  }

  printf("GL_VERSION : %s\n", glGetString(GL_VERSION));
  printf("GL_RENDERER: %s\n", glGetString(GL_RENDERER));
  GLint max_varyings = 0;
  glGetIntegerv(GL_MAX_VERTEX_OUTPUT_COMPONENTS, &max_varyings);
  printf("Vertex output component limit: %d (payload uses %d, cell=%d)\n",
         max_varyings, precise ? 36 : 24, cell);
  const char *header = read_file(shader_path);
  const char *vs_tail =
      "layout(location=0) in vec3 P; layout(location=1) in vec2 T;\n"
      "uniform bool ordinary;\n"
      "noperspective out vec4 p[4],u[2];\n"
      "#ifdef OC_PORTABLE_PRECISE\n"
      "noperspective out vec4 h0,h1,h2;\n"
      "#endif\n"
      "void main(){ if(ordinary) {oc_portable_clear(p,u);\n"
      "#ifdef OC_PORTABLE_PRECISE\n"
      "h0=vec4(0);h1=vec4(0);h2=vec4(0);\n"
      "#endif\n"
      "}else{\n"
      "#ifdef OC_PORTABLE_PRECISE\n"
      "oc_portable_encode(gl_VertexID,P,T,p[0],p[1],p[2],p[3],u[0],u[1],h0,h1,"
      "h2);\n"
      "#else\n"
      "oc_portable_encode(gl_VertexID,P,T,p,u);\n"
      "#endif\n"
      "}\n"
      "gl_Position=vec4(oc_portable_screen_corner(gl_VertexID)*2.0-1.0,0,1); "
      "}\n";
  const char *fs_tail =
      "noperspective in vec4 p[4],u[2]; out vec4 color;\n"
      "#ifdef OC_PORTABLE_PRECISE\n"
      "noperspective in vec4 h0,h1,h2;\n"
      "#endif\n"
      "uniform bool ordinary; uniform vec3 expectedP[4]; uniform vec2 "
      "expectedUV[4];\n"
      "void main(){vec3 pos[4];vec2 uv[4];\n"
      "#ifdef OC_PORTABLE_PRECISE\n"
      "bool "
      "valid=oc_portable_decode(p[0],p[1],p[2],p[3],u[0],u[1],h0,h1,h2,pos,uv);"
      "\n"
      "#else\n"
      "bool valid=oc_portable_decode(p,u,pos,uv);\n"
      "#endif\n"
      "float pe=0.0,te=0.0;\n"
      "if(!ordinary)for(int i=0;i<4;i++){vec3 d=abs(pos[i]-expectedP[i]);"
      "pe=max(pe,max(d.x,max(d.y,d.z)));vec2 t=abs(uv[i]-expectedUV[i]);"
      "te=max(te,max(t.x,t.y));} color=vec4(pe,te,valid!=ordinary?1.0:0.0,1); "
      "}\n";
  char vs_prefix[256], fs_prefix[256];
  snprintf(vs_prefix, sizeof vs_prefix,
           "#version 330 core\n#define OC_PORTABLE_VERTEX\n%s"
           "#define OC_PORTABLE_CELL_SIZE %d.0\n",
           precise ? "#define OC_PORTABLE_PRECISE\n" : "", cell);
  snprintf(fs_prefix, sizeof fs_prefix,
           "#version 330 core\n%s#define OC_PORTABLE_CELL_SIZE %d.0\n",
           precise ? "#define OC_PORTABLE_PRECISE\n" : "", cell);
  char *vs = join(vs_prefix, header, vs_tail);
  char *fs = join(fs_prefix, header, fs_tail);
  GLuint prog = glCreateProgram();
  glAttachShader(prog, compile(GL_VERTEX_SHADER, vs));
  glAttachShader(prog, compile(GL_FRAGMENT_SHADER, fs));
  glLinkProgram(prog);
  GLint ok = 0;
  glGetProgramiv(prog, GL_LINK_STATUS, &ok);
  if (!ok) {
    char log[4096];
    glGetProgramInfoLog(prog, sizeof log, 0, log);
    puts(log);
    return 4;
  }
  glUseProgram(prog);
  GLuint tex, fbo, vao, vbo, ibo;
  glGenTextures(1, &tex);
  glBindTexture(GL_TEXTURE_2D, tex);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA32F, W, H, 0, GL_RGBA, GL_FLOAT, 0);
  glGenFramebuffers(1, &fbo);
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                         tex, 0);
  if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
    fprintf(stderr, "FBO incomplete\n");
    return 1;
  }
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glGenBuffers(1, &vbo);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glGenBuffers(1, &ibo);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo);
  unsigned indices[] = {0, 1, 2, 2, 3, 0};
  glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof indices, indices,
               GL_STATIC_DRAW);
  glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 5 * sizeof(float), 0);
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 5 * sizeof(float),
                        (void *)(3 * sizeof(float)));
  glEnableVertexAttribArray(1);
  glViewport(0, 0, W, H);
  glEnable(GL_CULL_FACE);
  glCullFace(GL_BACK);
  glFrontFace(GL_CCW);
  float *pixels = malloc((size_t)W * H * 4 * sizeof(float));
  if (!pixels) {
    fprintf(stderr, "Readback allocation failed\n");
    return 1;
  }
  float max_pe = 0, max_te = 0;
  int checks = 0, failures = 0, precise_failures = 0;
  float scenario_pe[3] = {0}, scenario_te[3] = {0};
  const float origins[][3] = {
      {0.5, -0.25, 0.125}, {100.0, -120.0, 35.0}, {2048.0, -3072.0, 4096.0}};
  for (int scenario = 0; scenario < 3; scenario++)
    for (int base = 0; base < 8; base++)
      for (int mirror = 0; mirror < 2; mirror++) {
        float verts[12][5] = {{0}}, ep[4][3], et[4][2];
        float x[] = {0, 1, 1, 0}, y[] = {0, 0, 1, 1};
        float scale = scenario == 1 ? 0.05 : 1.0;
        for (int i = 0; i < 4; i++) {
          int slot = (base + i) & 3;
          float p[3] = {
              origins[scenario][0] + scale * (0.8 * x[i] - 0.3 * y[i]),
              origins[scenario][1] + scale * (0.2 * x[i] + 0.7 * y[i]),
              origins[scenario][2] + scale * (-0.4 * x[i] + 0.5 * y[i])};
          float u = 0.3 + (mirror ? 1 - x[i] : x[i]) * 0.4,
                v = 0.1 + y[i] * 0.8;
          for (int k = 0; k < 3; k++)
            ep[slot][k] = verts[base + i][k] = p[k];
          et[slot][0] = verts[base + i][3] = u;
          et[slot][1] = verts[base + i][4] = v;
        }
        glBufferData(GL_ARRAY_BUFFER, sizeof verts, verts, GL_DYNAMIC_DRAW);
        glUniform3fv(glGetUniformLocation(prog, "expectedP"), 4, (float *)ep);
        glUniform2fv(glGetUniformLocation(prog, "expectedUV"), 4, (float *)et);
        glClearColor(-1, -1, -1, -1);
        glClear(GL_COLOR_BUFFER_BIT);
        glDrawElementsBaseVertex(GL_TRIANGLES, 6, GL_UNSIGNED_INT, 0, base);
        glReadPixels(0, 0, W, H, GL_RGBA, GL_FLOAT, pixels);
        float pe = 0, te = 0;
        int bad = 0;
        for (int i = 0; i < W * H; i++) {
          pe = fmax(pe, pixels[4 * i]);
          te = fmax(te, pixels[4 * i + 1]);
          if (pixels[4 * i + 2] != 1 || !isfinite(pixels[4 * i]) ||
              !isfinite(pixels[4 * i + 1]))
            bad++;
        }
        max_pe = fmax(max_pe, pe);
        max_te = fmax(max_te, te);
        checks++;
        float largest = 0.0f;
        for (int i = 0; i < 4; i++)
          for (int j = 0; j < 3; j++)
            largest = fmaxf(largest, fabsf(ep[i][j]));
        float limit = 1e-6f + largest * 4.0f * FLT_EPSILON;
        if (pe > limit || te > 0.0003)
          precise_failures++;
        if (bad) {
          printf(
              "INVALID scenario=%d base=%d mirror=%d pos=%g uv=%g pixels=%d\n",
              scenario, base, mirror, pe, te, bad);
          failures++;
        }
        scenario_pe[scenario] = fmaxf(scenario_pe[scenario], pe);
        scenario_te[scenario] = fmaxf(scenario_te[scenario], te);
      }
  for (int scenario = 0; scenario < 3; scenario++)
    printf("scenario=%d max position error=%g local UV error=%g\n", scenario,
           scenario_pe[scenario], scenario_te[scenario]);
  printf("%d / %d draws exceed the former precision target; measurement only\n",
         precise_failures, checks);
  glUniform1i(glGetUniformLocation(prog, "ordinary"), 1);
  glClear(GL_COLOR_BUFFER_BIT);
  glDrawElementsBaseVertex(GL_TRIANGLES, 6, GL_UNSIGNED_INT, 0, 7);
  glReadPixels(0, 0, W, H, GL_RGBA, GL_FLOAT, pixels);
  for (int i = 0; i < W * H; i++)
    if (pixels[i * 4 + 2] != 1.0f) {
      failures++;
      break;
    }
  glUniform1i(glGetUniformLocation(prog, "ordinary"), 0);
  printf("Ordinary all-zero payload rejection checked\n");
  printf("%d draws, %d structural failures; max position error=%g UV error=%g; "
         "%dx%d all "
         "pixels checked\n",
         checks, failures, max_pe, max_te, W, H);
  if (benchmark) {
    GLuint query;
    glGenQueries(1, &query);
    for (int n = 1; n <= 256; n *= 4) {
      glFinish();
      glBeginQuery(GL_TIME_ELAPSED, query);
      glDrawElementsInstancedBaseVertex(GL_TRIANGLES, 6, GL_UNSIGNED_INT, 0, n,
                                        7);
      glEndQuery(GL_TIME_ELAPSED);
      GLuint64 ns;
      glGetQueryObjectui64v(query, GL_QUERY_RESULT, &ns);
      printf("%d fullscreen carrier decodes: %.3f GPU ms\n", n,
             (double)ns / 1e6);
    }
    glDeleteQueries(1, &query);
  }
  GLenum error = glGetError();
  if (error != GL_NO_ERROR) {
    fprintf(stderr, "OpenGL error 0x%x\n", error);
    failures++;
  }
  free(pixels);
  free(vs);
  free(fs);
  free((void *)header);
  glDeleteProgram(prog);
  glDeleteBuffers(1, &ibo);
  glDeleteBuffers(1, &vbo);
  glDeleteVertexArrays(1, &vao);
  glDeleteFramebuffers(1, &fbo);
  glDeleteTextures(1, &tex);
  eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  eglDestroyContext(dpy, ctx);
  eglTerminate(dpy);
  return failures ? 5 : 0;
}
