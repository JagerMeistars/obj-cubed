// Real-driver parity test for the shipped carrier gather against the legacy
// subgroupQuadBroadcast operation. This tests observed behavior, not a portable
// guarantee that a model quad's vertices belong to the same subgroup.
// Run from the repository root. See carrier-gather.md for build/usage/results.
#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  float position[3], uv[2], marker;
} Vertex;
typedef struct {
  float result[4], meta[4];
} Record;

static void fail(const char *message) {
  fprintf(stderr, "%s\n", message);
  exit(1);
}
static char *read_file(const char *path) {
  FILE *file = fopen(path, "rb");
  if (!file) {
    perror(path);
    exit(1);
  }
  if (fseek(file, 0, SEEK_END))
    fail("seek failed");
  long n = ftell(file);
  if (n < 0 || fseek(file, 0, SEEK_SET))
    fail("seek failed");
  char *text = malloc((size_t)n + 1);
  if (!text || fread(text, 1, (size_t)n, file) != (size_t)n)
    fail("read failed");
  text[n] = 0;
  fclose(file);
  return text;
}
enum Backend { KHR_BROADCAST, ARB_ADAPTER, EXACT_SOURCE };

static const char *backend_name(enum Backend backend) {
  switch (backend) {
  case KHR_BROADCAST:
    return "KHR constant broadcast";
  case ARB_ADAPTER:
    return "ARB constant readInvocation adapter";
  case EXACT_SOURCE:
    return "Exact helper source";
  }
  fail("unknown backend");
  return "";
}

static GLuint program_for(const char *helper, enum Backend backend,
                          int raster) {
  const char *prefix = "#version 450 core\n"
                       "#extension GL_KHR_shader_subgroup_basic : require\n"
                       "#extension GL_KHR_shader_subgroup_ballot : require\n"
                       "#extension GL_KHR_shader_subgroup_quad : require\n";
  const char *arb_prefix =
      "#extension GL_ARB_shader_ballot : require\n"
      "#define subgroupBroadcast(v, i) readInvocationARB(v, i)\n"
      "#define gl_SubgroupInvocationID gl_SubGroupInvocationARB\n"
      "#define gl_SubgroupSize gl_SubGroupSizeARB\n";
  const char *exact_prefix = "#extension GL_ARB_shader_ballot : require\n"
                             "#extension GL_ARB_gpu_shader_int64 : require\n"
                             "#define OBJMC_VERTEX_ID gl_VertexID\n";
  const char *suffix =
      "\n#undef subgroupBroadcast\n#undef gl_SubgroupInvocationID\n#undef "
      "gl_SubgroupSize\n"
      "layout(location=0) in vec3 Position;\n"
      "layout(location=1) in vec2 UV;\n"
      "layout(location=2) in float Marker;\n"
      "uniform int Mode; uniform int Base;\n"
      "#ifdef CARRIER_RASTER\n"
      "vec4 result; vec4 meta; out float rasterError;\n"
      "#else\n"
      "out vec4 result; out vec4 meta;\n"
      "#endif\n"
      "void main() {\n"
      " result=vec4(0,0,0,0);\n"
      " bool eligible=(Mode==0)||(Marker>0.5);\n"
      " if(Mode==2 && ((gl_VertexID-Base)&3)==1) eligible=false;\n"
      " meta=vec4(float(gl_VertexID),eligible?1.0:0.0,float(gl_"
      "SubgroupInvocationID),float(gl_SubgroupSize));\n"
      " if(eligible) {\n"
      "  uvec4 mask=subgroupBallot(true);\n"
      "  vec3 p[4]; vec2 t[4]; oc_read_carrier(Position,UV,p,t);\n"
      "  vec3 "
      "rp[4]=vec3[4](subgroupQuadBroadcast(Position,0),subgroupQuadBroadcast("
      "Position,1),subgroupQuadBroadcast(Position,2),subgroupQuadBroadcast("
      "Position,3));\n"
      "  vec2 "
      "rt[4]=vec2[4](subgroupQuadBroadcast(UV,0),subgroupQuadBroadcast(UV,1),"
      "subgroupQuadBroadcast(UV,2),subgroupQuadBroadcast(UV,3));\n"
      "  uint laneBase=gl_SubgroupInvocationID & ~3u;\n"
      "  for(int i=0;i<4;i++) {\n"
      "   if(subgroupBallotBitExtract(mask,laneBase+uint(i))) {\n"
      "    result.x+=any(notEqual(p[i],rp[i]))?1.0:0.0;\n"
      "    result.x+=any(notEqual(t[i],rt[i]))?1.0:0.0;\n"
      "    result.y+=1.0;\n"
      "    "
      "if(any(isnan(p[i]))||any(isinf(p[i]))||any(isnan(t[i]))||any(isinf(t[i])"
      "))result.x+=1.0;\n"
      "   } else result.z+=1.0;\n"
      "  }\n"
      "  result.w=1.0;\n"
      " }\n"
      "#ifdef CARRIER_RASTER\n"
      " rasterError=result.x;\n"
      " if(eligible && (result.y<1.0 || result.y+result.z!=4.0)) "
      "rasterError+=1.0;\n"
      " int local=gl_VertexID-Base; int q=local/4;\n"
      " vec2 corners[4]=vec2[4](vec2(0,0),vec2(1,0),vec2(1,1),vec2(0,1));\n"
      " vec2 pixel=vec2(q%16,q/16)*12.0+2.0+corners[local&3]*8.0;\n"
      " gl_Position=vec4(pixel/128.0-1.0,0,1);\n"
      "#else\n"
      " gl_Position=vec4(Position,1);\n"
      "#endif\n"
      "}\n";
  const char *extra = backend == EXACT_SOURCE  ? exact_prefix
                      : backend == ARB_ADAPTER ? arb_prefix
                                               : "";
  const char *parts[] = {prefix, extra,
                         raster ? "#define CARRIER_RASTER 1\n" : "", helper,
                         suffix};
  GLuint shader = glCreateShader(GL_VERTEX_SHADER);
  glShaderSource(shader, 5, parts, NULL);
  glCompileShader(shader);
  GLint ok;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[8192];
    glGetShaderInfoLog(shader, sizeof log, NULL, log);
    fprintf(stderr, "%s\n", log);
    fail("vertex compile failed");
  }
  GLuint program = glCreateProgram();
  glAttachShader(program, shader);
  GLuint fragment = 0;
  if (raster) {
    const char *fragment_source =
        "#version 450 core\n"
        "in float rasterError; layout(location=0) out vec4 color;\n"
        "void main(){ bool bad=rasterError>0.00001 || isnan(rasterError) "
        "|| isinf(rasterError); color=bad?vec4(1,0,0,1):vec4(0,1,0,1); }\n";
    fragment = glCreateShader(GL_FRAGMENT_SHADER);
    glShaderSource(fragment, 1, &fragment_source, NULL);
    glCompileShader(fragment);
    glGetShaderiv(fragment, GL_COMPILE_STATUS, &ok);
    if (!ok)
      fail("fragment compile failed");
    glAttachShader(program, fragment);
  } else {
    const char *varyings[] = {"result", "meta"};
    glTransformFeedbackVaryings(program, 2, varyings, GL_INTERLEAVED_ATTRIBS);
  }
  glLinkProgram(program);
  glGetProgramiv(program, GL_LINK_STATUS, &ok);
  if (!ok) {
    char log[8192];
    glGetProgramInfoLog(program, sizeof log, NULL, log);
    fprintf(stderr, "%s\n", log);
    fail("link failed");
  }
  glDeleteShader(shader);
  if (fragment)
    glDeleteShader(fragment);
  return program;
}

// The same 8x8 tiles are generated in the vertex shader. Every full quad must
// cover its interior, so a blank framebuffer cannot pass. The optional tail is
// checked for visible errors but its exact diagonal coverage is not assumed.
static int check_raster(const unsigned char *pixels, int quads,
                        unsigned long *covered) {
  int bad = 0;
  for (int i = 0; i < 256 * 256; i++) {
    const unsigned char *p = pixels + i * 4;
    if (p[3]) {
      (*covered)++;
      if (p[0] != 0 || p[1] != 255 || p[2] != 0 || p[3] != 255)
        bad++;
    }
  }
  for (int q = 0; q < quads; q++)
    for (int y = 0; y < 8; y++)
      for (int x = 0; x < 8; x++) {
        int px = (q % 16) * 12 + 2 + x;
        int py = (q / 16) * 12 + 2 + y;
        if (!pixels[(py * 256 + px) * 4 + 3])
          bad++;
      }
  return bad;
}

int main(int argc, char **argv) {
  const char *helper_path =
      "objcubed/assets/minecraft/shaders/include/objmc_carrier.glsl";
  int exact_helper = 0, raster = 0;
  for (int i = 1; i < argc; i++)
    if (!strcmp(argv[i], "--helper") && i + 1 < argc) {
      exact_helper = 1;
      helper_path = argv[++i];
    } else if (!strcmp(argv[i], "--raster")) {
      raster = 1;
    } else {
      fprintf(stderr, "Usage: %s [--helper PATH] [--raster]\n", argv[0]);
      return 1;
    }
  PFNEGLGETPLATFORMDISPLAYEXTPROC get_display =
      (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress(
          "eglGetPlatformDisplayEXT");
  EGLDisplay display = get_display ? get_display(EGL_PLATFORM_SURFACELESS_MESA,
                                                 EGL_DEFAULT_DISPLAY, NULL)
                                   : eglGetDisplay(EGL_DEFAULT_DISPLAY);
  EGLint major, minor;
  if (display == EGL_NO_DISPLAY || !eglInitialize(display, &major, &minor) ||
      !eglBindAPI(EGL_OPENGL_API))
    fail("cannot initialize EGL OpenGL");
  EGLint attrs[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE,
                    EGL_OPENGL_BIT, EGL_NONE};
  EGLConfig config;
  EGLint count;
  if (!eglChooseConfig(display, attrs, &config, 1, &count) || !count)
    fail("no EGL config");
  EGLint context_attrs[] = {EGL_CONTEXT_MAJOR_VERSION,
                            4,
                            EGL_CONTEXT_MINOR_VERSION,
                            5,
                            EGL_CONTEXT_OPENGL_PROFILE_MASK,
                            EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
                            EGL_NONE};
  EGLContext context =
      eglCreateContext(display, config, EGL_NO_CONTEXT, context_attrs);
  EGLint surface_attrs[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE};
  EGLSurface surface = eglCreatePbufferSurface(display, config, surface_attrs);
  if (context == EGL_NO_CONTEXT || surface == EGL_NO_SURFACE ||
      !eglMakeCurrent(display, surface, surface, context))
    fail("cannot create/make current OpenGL4.5 context");
  printf("GL %s on %s\n", glGetString(GL_VERSION), glGetString(GL_RENDERER));
  if (!epoxy_has_gl_extension("GL_KHR_shader_subgroup") ||
      !epoxy_has_gl_extension("GL_ARB_shader_ballot"))
    fail("test requires both KHR subgroup reference and ARB ballot");
  if (exact_helper && !epoxy_has_gl_extension("GL_ARB_gpu_shader_int64"))
    fail("exact helper test requires ARB gpu_shader_int64");
  GLint stages = 0, features = 0, quads = 0, subgroup_size = 0;
  glGetIntegerv(0x9533, &stages);
  glGetIntegerv(0x9534, &features);
  glGetIntegerv(0x9535, &quads);
  glGetIntegerv(0x9532, &subgroup_size);
  printf("subgroup size=%d stages=0x%x features=0x%x quad_all=%d\n",
         subgroup_size, stages, features, quads);
  if (!(stages & GL_VERTEX_SHADER_BIT) || !(features & 0x80) ||
      !(features & 0x08) || !quads)
    fail("test requires vertex ballot and vertex quad reference support");
  char *helper = read_file(helper_path);
  printf("helper: %s (%s)\n", helper_path,
         exact_helper ? "exact source, no operation aliases"
                      : "original source plus ARB adapter");
  printf("execution: %s\n",
         raster ? "ordinary rasterization (no transform feedback)"
                : "transform feedback");
  GLuint vao, vbo, ibo, tfbo = 0, query = 0, framebuffer = 0, texture = 0;
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glGenBuffers(1, &vbo);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glGenBuffers(1, &ibo);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo);
  if (raster) {
    glGenFramebuffers(1, &framebuffer);
    glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glGenTextures(1, &texture);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 256, 256, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, NULL);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                           texture, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE)
      fail("incomplete raster framebuffer");
    glViewport(0, 0, 256, 256);
    glClearColor(0, 0, 0, 0);
  } else {
    glGenBuffers(1, &tfbo);
    glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER, 0, tfbo);
    glGenQueries(1, &query);
    glEnable(GL_RASTERIZER_DISCARD);
  }
  glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), NULL);
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, sizeof(Vertex),
                        (void *)(3 * sizeof(float)));
  glEnableVertexAttribArray(1);
  glVertexAttribPointer(2, 1, GL_FLOAT, GL_FALSE, sizeof(Vertex),
                        (void *)(5 * sizeof(float)));
  glEnableVertexAttribArray(2);
  enum {
    MAX_QUADS = 257,
    MAX_VERTICES = MAX_QUADS * 4 + 8 + 3,
    MAX_INDICES = MAX_QUADS * 6 + 3
  };
  Vertex vertices[MAX_VERTICES];
  GLuint indices[MAX_INDICES];
  Record records[MAX_INDICES];
  unsigned char pixels[256 * 256 * 4];
  const int counts[] = {1, 7, 8, 9, 15, 16, 17, 31, 32, 33, 64, 65, 257};
  unsigned long total_records = 0, total_checked = 0, total_skipped = 0;
  unsigned long total_pixels = 0;
  int total_draws = 0, failures = 0;
  for (int b = 0; b < (exact_helper ? 1 : 2); b++) {
    enum Backend backend = exact_helper ? EXACT_SOURCE : (enum Backend)b;
    GLuint program = program_for(helper, backend, raster);
    glUseProgram(program);
    GLint mode_location = glGetUniformLocation(program, "Mode"),
          base_location = glGetUniformLocation(program, "Base");
    unsigned long backend_checked = 0, backend_skipped = 0, backend_records = 0;
    unsigned long backend_pixels = 0;
    int backend_draws = 0;
    for (size_t nc = 0; nc < sizeof counts / sizeof counts[0]; nc++)
      for (int base = 0; base < 8; base++)
        for (int mode = 0; mode < 3; mode++)
          for (int reversed = 0; reversed < 2; reversed++)
            for (int tail = 0; tail < 2; tail++) {
              int nquads = counts[nc],
                  vertex_count = base + nquads * 4 + tail * 3,
                  index_count = nquads * 6 + tail * 3;
              memset(vertices, 0, sizeof vertices);
              for (int i = base; i < vertex_count; i++) {
                int local = i - base;
                Vertex *v = &vertices[i];
                v->position[0] = (float)i * 17.125f + 0.03125f;
                v->position[1] = -(float)(i * i % 65521) * 0.03125f;
                v->position[2] = (float)(i % 19) * 0.0625f;
                v->uv[0] = (float)(i % 17) / 32.0f;
                v->uv[1] = (float)i * 0.00001f;
                v->marker = ((local / 4) % 3 == 1) ? 0.0f : 1.0f;
              }
              const int pattern[] = {0, 1, 2, 2, 3, 0};
              for (int q = 0; q < nquads; q++) {
                int source = reversed ? nquads - 1 - q : q;
                for (int j = 0; j < 6; j++)
                  indices[q * 6 + j] = (GLuint)(source * 4 + pattern[j]);
              }
              if (tail)
                for (int j = 0; j < 3; j++)
                  indices[nquads * 6 + j] = (GLuint)(nquads * 4 + j);
              glBindBuffer(GL_ARRAY_BUFFER, vbo);
              glBufferData(GL_ARRAY_BUFFER, vertex_count * sizeof(Vertex),
                           vertices, GL_STREAM_DRAW);
              glBufferData(GL_ELEMENT_ARRAY_BUFFER,
                           index_count * sizeof(GLuint), indices,
                           GL_STREAM_DRAW);
              glUniform1i(mode_location, mode);
              glUniform1i(base_location, base);
              int bad = 0;
              if (raster) {
                glClear(GL_COLOR_BUFFER_BIT);
                glDrawElementsBaseVertex(GL_TRIANGLES, index_count,
                                         GL_UNSIGNED_INT, NULL, base);
                glReadPixels(0, 0, 256, 256, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
                bad = check_raster(pixels, nquads, &backend_pixels);
              } else {
                glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER, tfbo);
                glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER,
                             index_count * sizeof(Record), NULL,
                             GL_STREAM_READ);
                glBeginQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN, query);
                glBeginTransformFeedback(GL_TRIANGLES);
                glDrawElementsBaseVertex(GL_TRIANGLES, index_count,
                                         GL_UNSIGNED_INT, NULL, base);
                glEndTransformFeedback();
                glEndQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN);
                GLuint written = 0;
                glGetQueryObjectuiv(query, GL_QUERY_RESULT, &written);
                if (written != (GLuint)(index_count / 3))
                  fail("transform feedback primitive count mismatch");
                glGetBufferSubData(GL_TRANSFORM_FEEDBACK_BUFFER, 0,
                                   index_count * sizeof(Record), records);
                for (int j = 0; j < index_count; j++) {
                  Record *r = &records[j];
                  int id = base + (int)indices[j], local = id - base;
                  int eligible = mode == 0 || vertices[id].marker > 0.5f;
                  if (mode == 2 && (local & 3) == 1)
                    eligible = 0;
                  if (r->meta[0] != (float)id ||
                      r->meta[1] != (float)eligible ||
                      r->result[3] != (float)eligible ||
                      !isfinite(r->result[0]) || r->result[0] != 0) {
                    bad++;
                    if (!failures && bad <= 4)
                      printf("  record=%d vertex=%d lane=%.0f width=%.0f "
                             "mismatches=%.0f checked=%.0f excluded=%.0f\n",
                             j, id, r->meta[2], r->meta[3], r->result[0],
                             r->result[1], r->result[2]);
                  }
                  if (eligible &&
                      (r->result[1] < 1 || r->result[1] + r->result[2] != 4))
                    bad++;
                  backend_checked += (unsigned long)r->result[1];
                  backend_skipped += (unsigned long)r->result[2];
                }
              }
              GLenum error = glGetError();
              if (error != GL_NO_ERROR) {
                fprintf(stderr, "GL error0x%x\n", error);
                fail("OpenGL draw/readback error");
              }
              if (bad) {
                if (failures < 12)
                  printf("FAIL backend=%s quads=%d base=%d mode=%d reverse=%d "
                         "tail=%d bad_%s=%d\n",
                         backend_name(backend), nquads, base, mode, reversed,
                         tail, raster ? "pixels" : "records", bad);
                failures++;
              }
              backend_records += (unsigned long)index_count;
              backend_draws++;
            }
    if (raster)
      printf("%s: %d indexed draws, %lu submitted vertex indices, %lu covered "
             "pixels checked\n",
             backend_name(backend), backend_draws, backend_records,
             backend_pixels);
    else
      printf("%s: %d indexed draws, %lu captured vertices, %lu valid peer "
             "comparisons, %lu inactive peers excluded\n",
             backend_name(backend), backend_draws, backend_records,
             backend_checked, backend_skipped);
    total_records += backend_records;
    total_checked += backend_checked;
    total_skipped += backend_skipped;
    total_pixels += backend_pixels;
    total_draws += backend_draws;
    glDeleteProgram(program);
  }
  if (raster)
    printf("TOTAL: %d draws, %lu submitted vertex indices, %lu covered pixels "
           "checked, %d failed draws\n",
           total_draws, total_records, total_pixels, failures);
  else
    printf("TOTAL: %d draws, %lu vertices, %lu valid comparisons, %lu excluded "
           "inactive peers, %d failed draws\n",
           total_draws, total_records, total_checked, total_skipped, failures);
  free(helper);
  glDeleteQueries(1, &query);
  glDeleteBuffers(1, &tfbo);
  glDeleteBuffers(1, &ibo);
  glDeleteBuffers(1, &vbo);
  glDeleteVertexArrays(1, &vao);
  glDeleteTextures(1, &texture);
  glDeleteFramebuffers(1, &framebuffer);
  eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  eglDestroySurface(display, surface);
  eglDestroyContext(display, context);
  eglTerminate(display);
  return failures ? 2 : 0;
}
