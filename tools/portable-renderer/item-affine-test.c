// GPU comparison: existing decoder on actual carrier versus canonical decoder
// followed by item-affine.glsl. Inputs are prepared by item-affine-test.mjs.
#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void fail(const char *s) {
  fprintf(stderr, "%s\n", s);
  exit(1);
}
static unsigned char *read_file(const char *dir, const char *name,
                                long *length) {
  char file[4096];
  snprintf(file, sizeof file, "%s/%s", dir, name);
  FILE *f = fopen(file, "rb");
  if (!f) {
    perror(file);
    exit(1);
  }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  rewind(f);
  unsigned char *p = calloc((size_t)n + 1, 1);
  if (!p || fread(p, 1, n, f) != (size_t)n)
    fail("read failed");
  fclose(f);
  if (length)
    *length = n;
  return p;
}
static GLuint program(const char *dir, const char *name) {
  const char *s = (char *)read_file(dir, name, NULL);
  GLuint sh = glCreateShader(GL_VERTEX_SHADER);
  glShaderSource(sh, 1, &s, NULL);
  glCompileShader(sh);
  GLint ok;
  glGetShaderiv(sh, GL_COMPILE_STATUS, &ok);
  char log[8192];
  if (!ok) {
    glGetShaderInfoLog(sh, sizeof log, NULL, log);
    fprintf(stderr, "%s\n", log);
    fail("compile failed");
  }
  GLuint p = glCreateProgram();
  glAttachShader(p, sh);
  const char *names[] = {"result"};
  glTransformFeedbackVaryings(p, 1, names, GL_INTERLEAVED_ATTRIBS);
  glLinkProgram(p);
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) {
    glGetProgramInfoLog(p, sizeof log, NULL, log);
    fprintf(stderr, "%s\n", log);
    fail("link failed");
  }
  glDeleteShader(sh);
  free((void *)s);
  return p;
}
static void init(void) {
  PFNEGLGETPLATFORMDISPLAYEXTPROC g =
      (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress(
          "eglGetPlatformDisplayEXT");
  EGLDisplay d = g ? g(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL)
                   : eglGetDisplay(EGL_DEFAULT_DISPLAY);
  EGLint a, b;
  if (!eglInitialize(d, &a, &b) || !eglBindAPI(EGL_OPENGL_API))
    fail("EGL init failed");
  const EGLint ca[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE,
                       EGL_OPENGL_BIT, EGL_NONE};
  EGLConfig config;
  EGLint count;
  if (!eglChooseConfig(d, ca, &config, 1, &count) || !count)
    fail("EGL config failed");
  const EGLint xa[] = {EGL_CONTEXT_MAJOR_VERSION,
                       3,
                       EGL_CONTEXT_MINOR_VERSION,
                       3,
                       EGL_CONTEXT_OPENGL_PROFILE_MASK,
                       EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
                       EGL_NONE};
  EGLContext ctx = eglCreateContext(d, config, EGL_NO_CONTEXT, xa);
  const EGLint sa[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE};
  EGLSurface surface = eglCreatePbufferSurface(d, config, sa);
  if (ctx == EGL_NO_CONTEXT || surface == EGL_NO_SURFACE ||
      !eglMakeCurrent(d, surface, surface, ctx))
    fail("GL3.3 context failed");
  printf("GL %s on %s\n", glGetString(GL_VERSION), glGetString(GL_RENDERER));
}
int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "Usage: %s PREPARED_DIRECTORY\n", argv[0]);
    return 1;
  }
  init();
  const char *dir = argv[1];
  char *size = (char *)read_file(dir, "size.txt", NULL);
  int width, height;
  if (sscanf(size, "%d %d", &width, &height) != 2 || width < 23)
    fail("invalid texture size");
  free(size);
  long raw_size;
  unsigned char *raw = read_file(dir, "texture.rgba", &raw_size);
  if (raw_size != (long)width * height * 4)
    fail("invalid texture bytes");
  unsigned vertices = (unsigned)raw[8] * 16777216u + (unsigned)raw[9] * 65536u +
                      (unsigned)raw[10] * 256u + raw[29];
  unsigned faces = vertices / 4;
  if (faces == 0)
    fail("texture has no faces");
  unsigned char *row0 = malloc((size_t)width * 4),
                *row1 = malloc((size_t)width * 4);
  GLuint tex, vao, tf, query;
  glGenQueries(1, &query);
  glGenTextures(1, &tex);
  glBindTexture(GL_TEXTURE_2D, tex);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA,
               GL_UNSIGNED_BYTE, raw);
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glGenBuffers(1, &tf);
  glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER, 0, tf);
  glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER, 16 * sizeof(float), NULL,
               GL_STREAM_READ);
  glEnable(GL_RASTERIZER_DISCARD);
  unsigned cases = 0, failed = 0;
  float largest_p = 0, largest_uv = 0;
  for (int block = 0; block < 2; block++) {
    GLuint p = program(dir, block ? "parity-block.vert" : "parity.vert");
    glUseProgram(p);
    GLint carrier_loc = glGetUniformLocation(p, "Carrier"),
          uv_loc = glGetUniformLocation(p, "CarrierUV"),
          projection_loc = glGetUniformLocation(p, "ProjMat"),
          color_loc = glGetUniformLocation(p, "Color"),
          time_loc = glGetUniformLocation(p, "GameTime"),
          marker_loc = glGetUniformLocation(p, "MarkerPixel"),
          cycle_loc = glGetUniformLocation(p, "CyclicOffset");
    glUniform1i(glGetUniformLocation(p, "Sampler0"), 0);
    unsigned before = failed;
    for (int version = 0; version < 3; version++)
      for (int slot = 0; slot < 9; slot++)
        for (int context = 0; context < 5; context++)
          for (int shape = 0; shape < 3; shape++)
            for (int visibility = 0; visibility < 8; visibility++)
              for (int gui_version = 0; gui_version < 2; gui_version++) {
                memcpy(row0, raw, (size_t)width * 4);
                memcpy(row1, raw + (size_t)width * 4, (size_t)width * 4);
                row0[6 * 4] = (row0[6 * 4] & 0xe3) | (visibility << 2);
                row0[6 * 4 + 2] = gui_version ? 2 : 0;
                const unsigned char behavior[] = {73, 0, 146, 219};
                row0[6 * 4 + 1] = behavior[cases % 4];
                row0[4 * 4 + 3] = (row0[4 * 4 + 3] & 0xcf) | ((cases % 4) << 4);
                row1[5 * 4] = 8 << 1;
                row1[5 * 4 + 1] = 0;
                row1[5 * 4 + 2] = version;
                for (int s = 1; s <= 8; s++) {
                  int x = s <= 4 ? s - 1 : 6 + s - 5;
                  unsigned z = s % 2 ? 32768 : 0;
                  row1[x * 4] = z >> 8;
                  row1[x * 4 + 1] = z & 255;
                  row1[x * 4 + 2] = (s % 2 ? 1 : 0) | (s % 3 ? 2 : 0);
                  row1[x * 4 + 3] = 255;
                }
                glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, width, 1, GL_RGBA,
                                GL_UNSIGNED_BYTE, row0);
                glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 1, width, 1, GL_RGBA,
                                GL_UNSIGNED_BYTE, row1);
                float projection[16] = {0};
                projection[0] = projection[5] = 1;
                projection[10] = projection[15] = 1;
                projection[11] = -1;
                projection[14] = -.2f;
                // world, legacy hand, GUI, inventory player preview, unusual
                // GUI+legacy-hand.
                if (context == 1)
                  projection[14] = -.10005f;
                if (context >= 2) {
                  projection[11] = 0;
                  projection[0] = context == 3 ? .015f : .007f;
                }
                if (context == 4)
                  projection[14] = -.10005f;
                glUniformMatrix4fv(projection_loc, 1, GL_FALSE, projection);
                float pos[4][3], uv[4][2];
                unsigned face = (cases / 16) % faces;
                int marker_x = (int)(face % (unsigned)width),
                    marker_y = 2 + (int)(face / (unsigned)width);
                glUniform2i(marker_loc, marker_x, marker_y);
                const float xs[] = {1, 1, 0, 0}, ys[] = {1, 0, 0, 1};
                float sx = shape == 0   ? 1
                           : shape == 1 ? 2.3f
                                        : -.65f,
                      sy = shape == 0   ? 1
                           : shape == 1 ? .37f
                                        : 1.7f;
                float angle = .37f + shape * .52f, c = cosf(angle),
                      sn = sinf(angle), shear = shape == 2 ? .2f : 0;
                float mid =
                    version == 0 ? (slot ? .65f : .5f) : .5f + slot * .035f;
                float half = slot ? .2f : .4f;
                float shrink = 1.f - (cases % 3) * .025f;
                for (int v = 0; v < 4; v++) {
                  float x = xs[v] * sx + ys[v] * shear, y = ys[v] * sy;
                  pos[v][0] = 12 + c * x - sn * y;
                  pos[v][1] = -3 + sn * x + c * y;
                  pos[v][2] = .7f * x + .4f * y + 2;
                  uv[v][0] =
                      (marker_x + mid + (xs[v] ? -half : half) * shrink) /
                      width;
                  uv[v][1] =
                      (marker_y + .5f + (ys[v] ? -.4f : .4f) * shrink) / height;
                }
                glUniform3fv(carrier_loc, 4, (float *)pos);
                glUniform2fv(uv_loc, 4, (float *)uv);
                glUniform1i(cycle_loc, (int)(cases % 4));
                const float colors[][4] = {{0, 0, 0, 1},
                                           {1, 1, 1, 1},
                                           {128.f / 255, 0, 10.f / 255, 1},
                                           {.23f, .57f, .84f, 1}};
                glUniform4fv(color_loc, 1, colors[(cases / 4) % 4]);
                glUniform1f(time_loc, (float)(cases % 7) * .000137f);
                glBeginQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN, query);
                glBeginTransformFeedback(GL_POINTS);
                glDrawArrays(GL_POINTS, 0, 4);
                glEndTransformFeedback();
                glEndQuery(GL_TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN);
                GLuint written;
                glGetQueryObjectuiv(query, GL_QUERY_RESULT, &written);
                if (written != 4)
                  fail("transform feedback must capture four points");
                float output[4][4];
                glGetBufferSubData(GL_TRANSFORM_FEEDBACK_BUFFER, 0,
                                   sizeof output, output);
                int bad = 0;
                for (int v = 0; v < 4; v++) {
                  largest_p = fmaxf(largest_p, output[v][0]);
                  largest_uv = fmaxf(largest_uv, output[v][1]);
                  if (!isfinite(output[v][0]) || output[v][0] > 2e-5f ||
                      output[v][1] > 1e-6f || output[v][2] > 1e-6f)
                    bad++;
                }
                if (bad) {
                  if (failed < 12)
                    printf(
                        "FAIL block=%d version=%d slot=%d context=%d shape=%d "
                        "visibility=%d guiVersion=%d result0=(%g,%g,%g,%g)\n",
                        block, version, slot, context, shape, visibility,
                        gui_version, output[0][0], output[0][1], output[0][2],
                        output[0][3]);
                  failed++;
                }
                cases++;
              }
    printf("%s: %u failed draws\n", block ? "BLOCK" : "ENTITY",
           failed - before);
    glDeleteProgram(p);
  }
  GLenum error = glGetError();
  if (error != GL_NO_ERROR) {
    printf("GL error 0x%x\n", error);
    failed++;
  }
  printf("%u draws / %u corners, %u failed; maximum position=%g UV=%g\n", cases,
         cases * 4, failed, largest_p, largest_uv);
  free(raw);
  free(row0);
  free(row1);
  return failed ? 2 : 0;
}
