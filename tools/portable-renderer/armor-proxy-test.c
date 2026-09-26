// Real GL3.3 raster coverage test; no transform feedback or storage writes.
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

static GLuint compile_stage(GLenum type,const char *dir,const char *name){
 const char *s=(char*)read_file(dir,name,NULL);GLuint sh=glCreateShader(type);glShaderSource(sh,1,&s,NULL);glCompileShader(sh);free((void*)s);
 GLint ok;glGetShaderiv(sh,GL_COMPILE_STATUS,&ok);if(!ok){char log[8192];glGetShaderInfoLog(sh,sizeof log,NULL,log);fprintf(stderr,"%s\n",log);fail("compile");}return sh;
}
static GLuint program(const char *dir,const char *vert,const char *frag){GLuint p=glCreateProgram();glAttachShader(p,compile_stage(GL_VERTEX_SHADER,dir,vert));glAttachShader(p,compile_stage(GL_FRAGMENT_SHADER,dir,frag));glLinkProgram(p);GLint ok;glGetProgramiv(p,GL_LINK_STATUS,&ok);if(!ok){char log[8192];glGetProgramInfoLog(p,sizeof log,NULL,log);fprintf(stderr,"%s\n",log);fail("link");}return p;}
static int kind(int p){return p==1?0:p==0?1:p<=3?2:3;}
int main(int argc,char **argv){
 if(argc<2||argc>3)fail("Usage: armor-proxy-test DIRECTORY [--negative | --early]");init();const char *dir=argv[1];int negative=argc==3&&!strcmp(argv[2],"--negative"),early=argc==3&&!strcmp(argv[2],"--early");
 long bytes;float *carriers=(float*)read_file(dir,"carriers.f32",&bytes);if(bytes%(27*sizeof(float)))fail("fixtures");
 GLuint p=program(dir,early?"early.vert":"proxy.vert",negative?"negative.frag":"proxy.frag");glUseProgram(p);
 GLuint vao,ibo,fbo,tex;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(1,&ibo);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,ibo);
 unsigned short indices[]={0,1,2,2,3,0};glBufferData(GL_ELEMENT_ARRAY_BUFFER,sizeof indices,indices,GL_STATIC_DRAW);
 glGenTextures(1,&tex);glBindTexture(GL_TEXTURE_2D,tex);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA32F,16,16,0,GL_RGBA,GL_FLOAT,NULL);
 glGenFramebuffers(1,&fbo);glBindFramebuffer(GL_FRAMEBUFFER,fbo);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,tex,0);
 if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE)fail("framebuffer");glViewport(0,0,16,16);glUniform2f(glGetUniformLocation(p,"viewport"),16,16);
 GLint lp=glGetUniformLocation(p,"input_positions"),lu=glGetUniformLocation(p,"input_uvs"),le=glGetUniformLocation(p,"expected_positions"),lf=glGetUniformLocation(p,"flags"),lb=glGetUniformLocation(p,"baseVertex");
 unsigned draws=0,failed=0,full=0,empty=0,pixels=0,culled=0;
 for(int target=0;target<8;target++)for(int face=2;face<6;face++)for(unsigned c=0;c<bytes/(27*sizeof(float));c++){
 const float *v=carriers+c*27;int part=v[0],source_face=v[1],shape=v[2],cyclic=v[3];if(shape!=0)continue;
 int selected=kind(part)==kind(target)&&source_face==face;
 // Full coverage checks use every cyclic order and arena offset for each matching wearer part.
 // Other cubes/faces need one representative order: all their vertices must collapse to a line/point.
 if(!selected&&cyclic!=0)continue;
 int offsets=selected&&part==target?8:1;
 glUniform3fv(lp,4,v+4);glUniform2fv(lu,4,v+16);glUniform1i(lf,target|(face<<3));
 float expected[12]={0};float mx=0,my=0;for(int i=0;i<4;i++){mx+=v[16+2*i]*.25f;my+=v[17+2*i]*.25f;}
 for(int i=0;i<4;i++){int role=v[16+2*i]>mx?(v[17+2*i]<my?0:3):(v[17+2*i]<my?1:2);memcpy(expected+3*role,v+4+3*i,3*sizeof(float));}
 glUniform3fv(le,4,expected);
 for(int base=0;base<offsets;base++)for(int cull=0;cull<(selected&&part==target?2:1);cull++){
 if(cull)glEnable(GL_CULL_FACE);else glDisable(GL_CULL_FACE);glCullFace(GL_BACK);glFrontFace(GL_CCW);glUniform1i(lb,base);
 glClearColor(0,0,0,0);glClear(GL_COLOR_BUFFER_BIT);glDrawElementsBaseVertex(GL_TRIANGLES,6,GL_UNSIGNED_SHORT,0,base);
 float rgba[16*16*4];glReadPixels(0,0,16,16,GL_RGBA,GL_FLOAT,rgba);int drawn=0,bad=0;
 for(int i=0;i<256;i++){if(rgba[4*i+1]>.5f){drawn++;if(rgba[4*i]>.5f)bad++;if(part==target&&rgba[4*i+2]<.5f)bad++;}}
 if((selected&&drawn!=256)||(!selected&&drawn!=0)||bad){if(failed<12)printf("FAIL target=%d face=%d src=%d/%d cyclic=%d base=%d cull=%d pixels=%d bad=%d\n",target,face,part,source_face,cyclic,base,cull,drawn,bad);failed++;}
 if(selected)full++;else empty++;if(cull)culled++;pixels+=drawn;draws++;
 }
 }
 if(glGetError()!=GL_NO_ERROR)fail("GL error");printf("%u draws: %u full / %u degenerate; %u cull-enabled; %u covered pixels; %u failed\n",draws,full,empty,culled,pixels,failed);return failed?2:0;
}
