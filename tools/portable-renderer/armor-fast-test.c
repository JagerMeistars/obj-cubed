// Real-driver parity for the optimized armor face decoder.
// Prepare inputs with armor-fast-test.mjs, then run this private EGL harness.
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
  if(argc!=2) fail("Usage: armor-fast-test PREPARED_DIRECTORY");
  init();
  const char *dir=argv[1];
  long raw_size,carrier_size;
  unsigned char *raw=read_file(dir,"texture.rgba",&raw_size);
  float *carrier=(float*)read_file(dir,"carriers.f32",&carrier_size);
  const int width=64,height=64,stride=27;
  if(raw_size!=width*height*4||carrier_size%(stride*sizeof(float)))fail("Bad fixtures");
  unsigned char row0[width*4],row1[width*4];
  GLuint tex,vao,tf;
  glGenTextures(1,&tex);glBindTexture(GL_TEXTURE_2D,tex);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
  glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,width,height,0,GL_RGBA,GL_UNSIGNED_BYTE,raw);
  glGenVertexArrays(1,&vao);glBindVertexArray(vao);
  glGenBuffers(1,&tf);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,tf);
  glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER,16*sizeof(float),NULL,GL_STREAM_READ);
  glEnable(GL_RASTERIZER_DISCARD);
  unsigned cases=0,failed=0,hidden=0;
  float largest_p=0,largest_uv=0,largest_other=0;
  const char *names[]={"parity-cardinal.vert","parity-NO_CARDINAL_LIGHTING.vert","parity-PER_FACE_LIGHTING.vert"};
  for(int lighting=0;lighting<3;lighting++) {
    GLuint p=program(dir,names[lighting]);glUseProgram(p);
    GLint pos_loc=glGetUniformLocation(p,"oc_carrier_positions"),
          uv_loc=glGetUniformLocation(p,"oc_carrier_uvs"),
          norm_loc=glGetUniformLocation(p,"oc_source_normal"),
          color_loc=glGetUniformLocation(p,"oc_control_color"),
          time_loc=glGetUniformLocation(p,"GameTime");
    float proj[16]={0};proj[0]=proj[5]=proj[10]=proj[15]=1;
    glUniformMatrix4fv(glGetUniformLocation(p,"ProjMat"),1,GL_FALSE,proj);
    glUniform1i(glGetUniformLocation(p,"Sampler0"),0);
    for(unsigned c=0;c<carrier_size/(stride*sizeof(float));c++) {
      const float *v=carrier+c*stride;
      int part=(int)v[0],face=(int)v[1],shape=(int)v[2],cyclic=(int)v[3];
      glUniform3fv(pos_loc,4,v+4);glUniform2fv(uv_loc,4,v+16);glUniform3fv(norm_loc,1,v+24);
      for(int feature=0;feature<32;feature++) {
        memcpy(row0,raw,sizeof row0);memcpy(row1,raw+sizeof row0,sizeof row1);
        for(int b=0;b<3;b++) {
          int offsets[]={8+b,11+b,14+b,17+b};
          for(int f=0;f<4;f++){row0[offsets[f]*4]=row0[offsets[f]*4+1]=255;}
          row0[(8+b)*4+2]=0;
        }
        int nboxes=1+(feature/2)%3;
        row0[8*4+3]=nboxes;
        int b=part%nboxes;
        row0[(8+b)*4+2]=part;
        // A waist carries part 0 alongside an empty leg box on the inner layer.
        if(part==0&&(feature&1)&&nboxes>1)row0[(8+(b+1)%nboxes)*4+2]=4;
        int offsets[]={8+b,11+b,14+b,17+b};
        for(int f=0;f<4;f++){
          row0[offsets[f]*4]=0;row0[offsets[f]*4+1]=f;
          row0[(20+b)*4+f]=(feature&2)?f+1:0;
        }
        // The final feature intentionally leaves the selected slot empty.
        if(feature%16==15)for(int f=0;f<4;f++)row0[offsets[f]*4]=row0[offsets[f]*4+1]=255;
        row0[3*4+2]=(feature&16)?1:4;
        row0[3*4+3]=(feature%3==0)?2:1;
        row0[4*4+3]=((feature&1)?64:0)|((feature%4)<<4);
        row0[6*4]=(feature&4)?128:0;
        row1[5*4]=(feature&2)?1:0;
        row1[5*4+1]=(feature%3==1)?2:0;
        glTexSubImage2D(GL_TEXTURE_2D,0,0,0,width,1,GL_RGBA,GL_UNSIGNED_BYTE,row0);
        glTexSubImage2D(GL_TEXTURE_2D,0,0,1,width,1,GL_RGBA,GL_UNSIGNED_BYTE,row1);
        const float colors[][4]={{1,1,1,1},{128.f/255,0,3.f/255,1},{0,128.f/255,1.f/255,1},{0,0,2.f/255,1}};
        glUniform4fv(color_loc,1,colors[(feature/4)%4]);
        glUniform1f(time_loc,(.7f+(c%13)*.91f)/24000.f);
        glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,0,4);glEndTransformFeedback();
        float output[4][4];glGetBufferSubData(GL_TRANSFORM_FEEDBACK_BUFFER,0,sizeof output,output);
        int bad=0;
        for(int corner=0;corner<4;corner++) {
          largest_p=fmaxf(largest_p,output[corner][0]);largest_uv=fmaxf(largest_uv,output[corner][1]);largest_other=fmaxf(largest_other,output[corner][2]);
          if(!isfinite(output[corner][0])||output[corner][0]>5e-5f||output[corner][1]>2e-6f||output[corner][2]>2e-6f)bad++;
          if(output[corner][3]>.5f)hidden++;
        }
        if(bad) {
          if(failed<12)printf("FAIL light=%d part=%d face=%d shape=%d cycle=%d feature=%d output=(%g,%g,%g,%g)\n",lighting,part,face,shape,cyclic,feature,output[0][0],output[0][1],output[0][2],output[0][3]);
          failed++;
        }
        cases++;
      }
    }
    glDeleteProgram(p);
    printf("Lighting %d complete: cumulative failed=%u\n",lighting,failed);fflush(stdout);
  }
  if(glGetError()!=GL_NO_ERROR)fail("GL error");
  printf("%u draws / %u corners (%u hidden), %u failed; max position=%g UV=%g other=%g\n",cases,cases*4,hidden,failed,largest_p,largest_uv,largest_other);
  free(raw);free(carrier);return failed?2:0;
}
