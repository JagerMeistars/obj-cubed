#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int modelFaces = 0, guardFaces = 0, skipBlendRows = 0, ordinary = 0;
static int marker_width(void) { return skipBlendRows ? 2 : 32; }
static int marker_height(void) { return skipBlendRows ? 1024 : 32; }
static int encoded_face(int logical) {
  if (!skipBlendRows)
    return logical;
  int row = 2, left = logical;
  while (1) {
    if ((row & 255) != 0 && (row & 255) != 255) {
      if (left < 2)
        return (row - 2) * 2 + left;
      left -= 2;
    }
    row++;
  }
}
typedef struct {
  float p[3], uv[2], marker, expected[4][4], ey[4];
} Vertex;
typedef struct {
  float result[4], meta[4];
} Record;
static void fail(const char *s) {
  fprintf(stderr, "%s\n", s);
  exit(1);
}
static char *readfile(const char *p) {
  FILE *f = fopen(p, "rb");
  if (!f) {
    perror(p);
    exit(1);
  }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  rewind(f);
  char *s = malloc(n + 1);
  if (fread(s, 1, n, f) != (size_t)n)
    fail("read");
  s[n] = 0;
  fclose(f);
  return s;
}
static GLuint shader(GLenum type, const char **s, int n) {
  GLuint x = glCreateShader(type);
  glShaderSource(x, n, s, NULL);
  glCompileShader(x);
  GLint ok;
  glGetShaderiv(x, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char l[16384];
    glGetShaderInfoLog(x, sizeof l, NULL, l);
    fail(l);
  }
  return x;
}
static GLuint program(const char *helper, int raster) {
  const char *prefix =
      "#version 450 core\n#extension GL_ARB_shader_ballot : "
      "require\n#extension GL_ARB_gpu_shader_int64 : require\n#extension "
      "GL_ARB_shader_draw_parameters : require\n#define OBJMC_VERTEX_ID "
      "gl_VertexID\nuniform sampler2D Sampler0;\n";
  const char *suffix =
      "\nlayout(location=0)in vec3 Position;layout(location=1)in vec2 "
      "UV;layout(location=2)in float Marker;layout(location=3)in vec4 "
      "E0;layout(location=4)in vec4 E1;layout(location=5)in vec4 "
      "E2;layout(location=6)in vec4 E3;layout(location=7)in vec4 EY;uniform "
      "int Mode;uniform int Base;\n"
      "#ifdef RASTER\nvec4 result,meta;out vec3 rasterResult;\n#else\nout vec4 "
      "result,meta;\n#endif\n"
      "void main(){int local=gl_VertexID-Base;bool "
      "eligible=Mode==0||Marker>.5;if(Mode==2&&(local&3)==1)eligible=false;"
      "result=vec4(0);meta=vec4(gl_VertexID,eligible?1:0,gl_"
      "SubGroupInvocationARB,gl_SubGroupSizeARB);if(eligible){vec3 p[4];vec2 "
      "t[4];oc_read_carrier(Position,UV,p,t);bool "
      "valid=oc_carrier_status==1||oc_carrier_status==4;result.y=float(oc_"
      "carrier_status);result.z=float(oc_carrier_count);result.w=1;if(valid){"
      "vec4 e[4]=vec4[4](E0,E1,E2,E3);for(int "
      "i=0;i<4;i++){result.x+=(any(isnan(p[i]))||any(isinf(p[i]))||any(isnan(t["
      "i]))||any(isinf(t[i])))?1:0;result.x+=any(greaterThan(abs(p[i]-e[i].xyz)"
      ",vec3(.002)))?"
      "1:0;result.x+=any(greaterThan(abs(t[i]-vec2(e[i].w,EY[i])),vec2(.000001)"
      "))?1:0;}result.x+=oc_carrier_corner!=(local&3)?1:0;} }\n"
      "#ifdef "
      "RASTER\nrasterResult=vec3(result.x,(result.y==2||result.y==3)?1:0,("
      "eligible&&result.y==0)?1:0);int q=local/4;vec2 "
      "co[4]=vec2[4](vec2(0,0),vec2(1,0),vec2(1,1),vec2(0,1));vec2 "
      "pixel=vec2(q%32,q/32)*6+2+co[local&3]*4;gl_Position=vec4(pixel/"
      "128-1,0,1);\n#else\ngl_Position=vec4(0,0,0,1);\n#endif\n}\n";
  const char *parts[] = {prefix, raster ? "#define RASTER\n" : "", helper,
                         suffix};
  GLuint vs = shader(GL_VERTEX_SHADER, parts, 4), p = glCreateProgram();
  glAttachShader(p, vs);
  if (raster) {
    const char *fs =
        "#version 450 core\nin vec3 rasterResult;out vec4 color;void "
        "main(){color=rasterResult.x>0.00001?vec4(1,0,0,1):rasterResult.y>0."
        "00001?vec4(1,0,1,1):rasterResult.z>0.00001?vec4(0,0,1,1):vec4(0,1,0,1)"
        ";}";
    GLuint f = shader(GL_FRAGMENT_SHADER, &fs, 1);
    glAttachShader(p, f);
    glDeleteShader(f);
  } else {
    const char *v[] = {"result", "meta"};
    glTransformFeedbackVaryings(p, 2, v, GL_INTERLEAVED_ATTRIBS);
  }
  glLinkProgram(p);
  GLint ok;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) {
    char l[16384];
    glGetProgramInfoLog(p, sizeof l, NULL, l);
    fail(l);
  }
  glDeleteShader(vs);
  return p;
}
static void vertex_values(int q, int c, int style, int far, float *p,
                          float *uv) {
  float xy[4][2] = {{1, 1}, {1, 0}, {0, 0}, {0, 1}};
  float x = xy[c][0], y = xy[c][1];
  float origin = far ? 4096 : 0;
  int pose = modelFaces && style < 2 ? q / modelFaces : q;
  p[0] = origin + pose * .125f + x * 1.25f + y * .25f;
  p[1] = -origin + pose * .0625f + x * .5f + y * .75f;
  p[2] = origin * .5f + pose * .03125f - x * .25f + y * .125f;
  if (modelFaces && style < 2) {
    int face = encoded_face(q % modelFaces);
    uv[0] = ((face % marker_width()) + .25f + (1 - x) * .5f) / 32;
    uv[1] = ((face / marker_width()) + 2.25f + (1 - y) * .5f) / marker_height();
  } else if (style < 2) {
    float u = style == 0 ? (q % 31) / 64.f : 0.25f,
          v = style == 0 ? (q / 31) / 64.f : 0.125f;
    uv[0] = u + (1 - x) / 128.f;
    uv[1] = v + (1 - y) / 128.f;
  } else {
    int part = (q / 6) % 4, face = q % 6;
    float origins[4][2] = {{0, 0}, {16, 16}, {40, 16}, {0, 16}},
          w[4] = {8, 8, 4, 4}, h[4] = {8, 12, 12, 12}, d[4] = {8, 4, 4, 4};
    float u = origins[part][0], v = origins[part][1], uu = 0, vv = 0, ww = 0,
          hh = 0;
    if (face < 2) {
      uu = d[part] + (face == 0 ? w[part] : 0);
      vv = 0;
      ww = w[part];
      hh = d[part];
    } else {
      float starts[4] = {0, d[part], d[part] + w[part], 2 * d[part] + w[part]};
      uu = starts[face - 2];
      vv = d[part];
      ww = (face == 2 || face == 4) ? d[part] : w[part];
      hh = h[part];
    }
    float a[4][2] = {{1, 0}, {0, 0}, {0, 1}, {1, 1}};
    int k = style == 3 ? 3 - c : c;
    uv[0] = (u + uu + a[k][0] * ww) / 64;
    uv[1] = (v + vv + a[k][1] * hh) / 32;
  }
}
int main(int argc, char **argv) {
  if (argc < 2)
    fail("gather-oracle HELPER [--raster] [--quick]");
  int raster = 0, quick = 0, bench = 0, itemsOnly = 0;
  for (int i = 2; i < argc; i++) {
    if (!strcmp(argv[i], "--ordinary"))
      ordinary = 1;
    else if (!strcmp(argv[i], "--raster"))
      raster = 1;
    else if (!strcmp(argv[i], "--skip-blend-rows"))
      skipBlendRows = 1;
    else if (!strcmp(argv[i], "--items-only"))
      itemsOnly = 1;
    else if (!strcmp(argv[i], "--quick"))
      quick = 1;
    else if (!strcmp(argv[i], "--guard-faces") && i + 1 < argc) {
      guardFaces = atoi(argv[++i]);
    } else if (!strcmp(argv[i], "--model-faces") && i + 1 < argc) {
      modelFaces = atoi(argv[++i]);
    } else if (!strcmp(argv[i], "--benchmark")) {
      bench = 1;
      raster = 1;
      quick = 1;
    }
  }
  PFNEGLGETPLATFORMDISPLAYEXTPROC get =
      (void *)eglGetProcAddress("eglGetPlatformDisplayEXT");
  EGLDisplay d = get(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL);
  EGLint a, b, n;
  if (!eglInitialize(d, &a, &b) || !eglBindAPI(EGL_OPENGL_API))
    fail("EGL");
  EGLConfig cfg;
  EGLint ca[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE,
                 EGL_OPENGL_BIT, EGL_NONE};
  eglChooseConfig(d, ca, &cfg, 1, &n);
  EGLint ctxa[] = {EGL_CONTEXT_MAJOR_VERSION,
                   4,
                   EGL_CONTEXT_MINOR_VERSION,
                   5,
                   EGL_CONTEXT_OPENGL_PROFILE_MASK,
                   EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
                   EGL_NONE};
  EGLContext ctx = eglCreateContext(d, cfg, EGL_NO_CONTEXT, ctxa);
  EGLint sa[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE};
  EGLSurface surf = eglCreatePbufferSurface(d, cfg, sa);
  if (!eglMakeCurrent(d, surf, surf, ctx))
    fail("context");
  printf("%s / %s mode=%s\n", glGetString(GL_VERSION), glGetString(GL_RENDERER),
         raster ? "raster" : "TF");
  char *help = readfile(argv[1]);
  GLuint prog = program(help, raster);
  glUseProgram(prog);
  GLuint vao, vbo, ibo, outbuf, tex, fbo, marker;
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glGenBuffers(1, &vbo);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glGenBuffers(1, &ibo);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo);
  int sz[8] = {3, 2, 1, 4, 4, 4, 4, 4};
  size_t off[8] = {offsetof(Vertex, p),           offsetof(Vertex, uv),
                   offsetof(Vertex, marker),      offsetof(Vertex, expected[0]),
                   offsetof(Vertex, expected[1]), offsetof(Vertex, expected[2]),
                   offsetof(Vertex, expected[3]), offsetof(Vertex, ey)};
  for (int i = 0; i < 8; i++) {
    glVertexAttribPointer(i, sz[i], GL_FLOAT, GL_FALSE, sizeof(Vertex),
                          (void *)off[i]);
    glEnableVertexAttribArray(i);
  }
  glGenTextures(1, &marker);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, marker);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glUniform1i(glGetUniformLocation(prog, "Sampler0"), 0);
  if (raster) {
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glGenTextures(1, &tex);
    glBindTexture(GL_TEXTURE_2D, tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 256, 256, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, NULL);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                           tex, 0);
    glViewport(0, 0, 256, 256);
    glClearColor(0, 0, 0, 0);
  } else {
    glGenBuffers(1, &outbuf);
    glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER, 0, outbuf);
    glEnable(GL_RASTERIZER_DISCARD);
  }
  Vertex verts[4 * 514 + 8];
  GLuint indices[6 * 514];
  Record rec[6 * 514];
  unsigned char pixels[256 * 256 * 4];
  int counts[] = {1, 7, 8, 9, 15, 16, 17, 31, 32, 33, 64, 65, 257};
  if (bench)
    counts[0] = 257;
  if (skipBlendRows)
    counts[0] = 513;
  unsigned long histogram[5] = {0}, wrong = 0, missing = 0, ambig = 0,
                covered = 0, draws = 0;
  int details = 0;
  unsigned long misses[3][2] = {{0}}, bads[3][2] = {{0}};
  unsigned long styleMissing[4] = {0}, styleWrong[4] = {0}, realMissing = 0,
                guardMissing = 0, realFullMissing = 0, guardFullMissing = 0;
  for (int style = 0; style < (itemsOnly ? 2 : 4); style++)
    for (int far = 0; far < (quick ? 1 : 2); far++)
      for (int nc = 0; nc < (quick ? 3 : 13); nc++)
        for (int base = 0; base < 8; base++)
          for (int mode = 0; mode < (ordinary ? 2 : 3); mode++)
            for (int rev = 0; rev < (quick ? 1 : 2); rev++)
              for (int tail = 0; tail < ((ordinary || quick) ? 1 : 2); tail++) {
                int nq = counts[nc], nv = base + 4 * nq + 3 * tail,
                    ni = 6 * nq + 3 * tail;
                memset(verts, 0, sizeof verts);
                for (int j = base; j < nv; j++) {
                  int q = (j - base) / 4, c = (j - base) & 3;
                  Vertex *v = &verts[j];
                  vertex_values(q, c, style, far, v->p, v->uv);
                  v->marker = q % 3 != 1;
                  for (int k = 0; k < 4; k++) {
                    float p[3], uv[2];
                    vertex_values(q, k, style, far, p, uv);
                    for (int z = 0; z < 3; z++)
                      v->expected[k][z] = p[z];
                    v->expected[k][3] = uv[0];
                    v->ey[k] = uv[1];
                  }
                }
                int pat[] = {0, 1, 2, 2, 3, 0};
                for (int q = 0; q < nq; q++)
                  for (int k = 0; k < 6; k++)
                    indices[6 * q + k] = (rev ? nq - 1 - q : q) * 4 + pat[k];
                for (int k = 0; k < 3 * tail; k++)
                  indices[nq * 6 + k] = nq * 4 + k;
                glBindBuffer(GL_ARRAY_BUFFER, vbo);
                glBufferData(GL_ARRAY_BUFFER, nv * sizeof(Vertex), verts,
                             GL_STREAM_DRAW);
                glBufferData(GL_ELEMENT_ARRAY_BUFFER, ni * sizeof(GLuint),
                             indices, GL_STREAM_DRAW);
                glUniform1i(glGetUniformLocation(prog, "Mode"), mode);
                glUniform1i(glGetUniformLocation(prog, "Base"), base);
                unsigned char mark[] = {
                    style >= 2 ? 12 : 0, style >= 2 ? 34 : 0,
                    style >= 2 ? 56 : 0, style >= 2 ? 253 : 255};
                glBindTexture(GL_TEXTURE_2D, marker);
                if (modelFaces && style < 2) {
                  unsigned char data[32 * 1024 * 4] = {0};
                  data[0] = 12;
                  data[1] = 34;
                  data[2] = 56;
                  data[3] = 255;
                  data[5] = marker_width();
                  for (int f = 0; f < modelFaces; f++) {
                    int ef = encoded_face(f);
                    int x = ef % marker_width(), y = 2 + ef / marker_width(),
                        k = (y * 32 + x) * 4;
                    data[k + 1] = x;
                    data[k + 2] = y / 256;
                    data[k + 3] = y % 256;
                  }
                  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 32, marker_height(),
                               0, GL_RGBA, GL_UNSIGNED_BYTE, data);
                } else
                  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 1, 1, 0, GL_RGBA,
                               GL_UNSIGNED_BYTE, mark);
                if (bench) {
                  GLuint query;
                  glGenQueries(1, &query);
                  for (int it = 0; it < 5; it++)
                    glDrawElementsBaseVertex(GL_TRIANGLES, ni, GL_UNSIGNED_INT,
                                             NULL, base);
                  glFinish();
                  glBeginQuery(GL_TIME_ELAPSED, query);
                  for (int it = 0; it < 100; it++)
                    glDrawElementsBaseVertex(GL_TRIANGLES, ni, GL_UNSIGNED_INT,
                                             NULL, base);
                  glEndQuery(GL_TIME_ELAPSED);
                  GLuint64 ns;
                  glGetQueryObjectui64v(query, GL_QUERY_RESULT, &ns);
                  printf("benchmark 100 indexed draws, %d quads each, GPU %.3f "
                         "ms total / %.3f us per draw\n",
                         nq, ns / 1e6, ns / 1e5);
                  return 0;
                }
                if (raster) {
                  glClear(GL_COLOR_BUFFER_BIT);
                  glDrawElementsBaseVertex(GL_TRIANGLES, ni, GL_UNSIGNED_INT,
                                           NULL, base);
                  glReadPixels(0, 0, 256, 256, GL_RGBA, GL_UNSIGNED_BYTE,
                               pixels);
                  unsigned long w = 0, m = 0, am = 0;
                  for (int i = 0; i < 256 * 256; i++) {
                    unsigned char *p = &pixels[4 * i];
                    if (p[3]) {
                      covered++;
                      int px = i % 256, py = i / 256;
                      int q = ((py - 2) / 6) * 32 + (px - 2) / 6;
                      if (p[0]) {
                        bads[mode][q == nq]++;
                        if (p[2])
                          am++;
                        else
                          w++;
                      } else if (p[2]) {
                        m++;
                        misses[mode][q == nq]++;
                        if (modelFaces && style < 2 && guardFaces) {
                          int f = q % modelFaces;
                          if (f >= guardFaces && f < modelFaces - guardFaces) {
                            realMissing++;
                            if (q < nq)
                              realFullMissing++;
                          } else {
                            guardMissing++;
                            if (q < nq)
                              guardFullMissing++;
                          }
                        }
                      }
                    }
                  }
                  for (int q = 0; q < nq; q++)
                    for (int y = 0; y < 4; y++)
                      for (int x = 0; x < 4; x++)
                        if (!pixels[((q / 32 * 6 + 2 + y) * 256 + q % 32 * 6 +
                                     2 + x) *
                                        4 +
                                    3])
                          fail("coverage missing");
                  wrong += w;
                  missing += m;
                  ambig += am;
                  styleMissing[style] += m;
                  styleWrong[style] += w + am;
                  if ((w || m || am) && details++ < 8)
                    printf("issue style%d far%d n%d base%d mode%d rev%d tail%d "
                           "wrong%lu missing%lu ambiguous%lu\n",
                           style, far, nq, base, mode, rev, tail, w, m, am);
                } else {
                  glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER, outbuf);
                  glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER,
                               ni * sizeof(Record), NULL, GL_STREAM_READ);
                  glBeginTransformFeedback(GL_TRIANGLES);
                  glDrawElementsBaseVertex(GL_TRIANGLES, ni, GL_UNSIGNED_INT,
                                           NULL, base);
                  glEndTransformFeedback();
                  glGetBufferSubData(GL_TRANSFORM_FEEDBACK_BUFFER, 0,
                                     ni * sizeof(Record), rec);
                  for (int j = 0; j < ni; j++) {
                    Record *r = &rec[j];
                    int id = base + (int)indices[j], local = id - base;
                    int eligible = mode == 0 || verts[id].marker > .5f;
                    if (mode == 2 && (local & 3) == 1)
                      eligible = 0;
                    if (r->meta[0] != (float)id ||
                        r->meta[1] != (float)eligible ||
                        r->result[3] != (float)eligible)
                      fail("transform-feedback identity/eligibility mismatch");
                    if (!eligible)
                      continue;
                    int status = (int)r->result[1];
                    if (status >= 0 && status < 5)
                      histogram[status]++;
                    int w = !isfinite(r->result[0]) || r->result[0] != 0,
                        m = status == 0, am = status == 2 || status == 3;
                    wrong += w;
                    missing += m;
                    ambig += am;
                    styleMissing[style] += m;
                    styleWrong[style] += w + am;
                    misses[mode][indices[j] / 4 == nq] += m;
                    bads[mode][indices[j] / 4 == nq] += w + am;
                    if ((w || m || am) && details++ < 8)
                      printf(
                          "issue style%d far%d n%d base%d mode%d rev%d tail%d "
                          "id%.0f lane%.0f status%d count%.0f error%.0f\n",
                          style, far, nq, base, mode, rev, tail, r->meta[0],
                          r->meta[2], status, r->result[2], r->result[0]);
                  }
                }
                if (glGetError() != GL_NO_ERROR)
                  fail("GL error");
                draws++;
              }
  printf("draws=%lu wrong=%lu missing=%lu ambiguous_or_conflict=%lu "
         "covered_pixels=%lu statuses missing=%lu full=%lu ambiguous=%lu "
         "conflict=%lu recovered=%lu\n",
         draws, wrong, missing, ambig, covered, histogram[0], histogram[1],
         histogram[2], histogram[3], histogram[4]);
  for (int m = 0; m < 3; m++)
    printf("mode%d missing full=%lu tail=%lu wrong_or_ambiguous full=%lu "
           "tail=%lu\n",
           m, misses[m][0], misses[m][1], bads[m][0], bads[m][1]);
  for (int st = 0; st < 4; st++)
    printf("style%d missing=%lu wrong_or_ambiguous=%lu\n", st, styleMissing[st],
           styleWrong[st]);
  if (guardFaces)
    printf("guarded model missing real=%lu guard=%lu; fullquads real=%lu "
           "guard=%lu\n",
           realMissing, guardMissing, realFullMissing, guardFullMissing);
  return wrong || ambig                                                   ? 2
         : (ordinary && raster && guardFaces ? realFullMissing : missing) ? 3
                                                                          : 0;
}
