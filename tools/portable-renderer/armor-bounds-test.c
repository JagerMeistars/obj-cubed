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
static GLuint compile(const char *dir,const char *name,GLenum stage){
 const char *src=(char*)read_file(dir,name,NULL);GLuint s=glCreateShader(stage);glShaderSource(s,1,&src,NULL);glCompileShader(s);GLint ok;glGetShaderiv(s,GL_COMPILE_STATUS,&ok);if(!ok){char log[4096];glGetShaderInfoLog(s,sizeof log,NULL,log);fail(log);}free((void*)src);return s;
}
int main(int argc,char **argv){
 if(argc!=2)fail("Usage: bounds-test FIXTURES");
 init();const char *dir=argv[1];long n,raw_size;float *cases=(float*)read_file(dir,"cases.f32",&n);unsigned char *raw=read_file(dir,"texture.rgba",&raw_size);char *size=(char*)read_file(dir,"size.txt",NULL);int width,height;if(sscanf(size,"%d %d",&width,&height)!=2||raw_size!=(long)width*height*4||n%(53*sizeof(float)))fail("Bad fixture");
 GLuint header,output,fbo,vao;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenTextures(1,&output);glBindTexture(GL_TEXTURE_2D,output);glTexImage2D(GL_TEXTURE_2D,0,GL_R32F,1,1,0,GL_RED,GL_FLOAT,NULL);glGenFramebuffers(1,&fbo);glBindFramebuffer(GL_FRAMEBUFFER,fbo);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,output,0);if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE)fail("FBO");glViewport(0,0,1,1);
 glGenTextures(1,&header);glBindTexture(GL_TEXTURE_2D,header);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,width,height,0,GL_RGBA,GL_UNSIGNED_BYTE,raw);
 unsigned total=0,misses=0;for(int zero=0;zero<2;zero++){
  char fs[64];snprintf(fs,sizeof fs,"bounds-%d.frag",zero);GLuint p=glCreateProgram();glAttachShader(p,compile(dir,"bounds.vert",GL_VERTEX_SHADER));glAttachShader(p,compile(dir,fs,GL_FRAGMENT_SHADER));glLinkProgram(p);GLint ok;glGetProgramiv(p,GL_LINK_STATUS,&ok);if(!ok){char log[4096];glGetProgramInfoLog(p,sizeof log,NULL,log);fail(log);}glUseProgram(p);glUniform1i(glGetUniformLocation(p,"Sampler0"),0);
  GLint face=glGetUniformLocation(p,"Face"),anchor=glGetUniformLocation(p,"Anchor"),basis=glGetUniformLocation(p,"Basis"),scale=glGetUniformLocation(p,"Scale"),offset=glGetUniformLocation(p,"Offset"),left=glGetUniformLocation(p,"Left"),screen=glGetUniformLocation(p,"Screen"),proj=glGetUniformLocation(p,"ProjMat"),mv=glGetUniformLocation(p,"ModelViewMat");
  for(unsigned i=0;i<n/(53*sizeof(float));i++){
   float *v=cases+i*53;if((int)v[0]!=zero)continue;glUniform1i(face,v[1]);glUniform3fv(anchor,1,v+2);glUniformMatrix3fv(basis,1,GL_FALSE,v+5);glUniform1f(scale,v[14]);glUniform3fv(offset,1,v+15);glUniform1i(left,v[18]);glUniform2fv(screen,1,v+19);glUniformMatrix4fv(proj,1,GL_FALSE,v+21);glUniformMatrix4fv(mv,1,GL_FALSE,v+37);float clear=-9;glClearBufferfv(GL_COLOR,0,&clear);glDrawArrays(GL_TRIANGLES,0,3);float got;glReadPixels(0,0,1,1,GL_RED,GL_FLOAT,&got);if(got!=1){fprintf(stderr,"FALSE CULL record=%u zero=%d face=%g scale=%g left=%g point=(%g,%g)\n",i,zero,v[1],v[14],v[18],v[19],v[20]);return 2;}total++;
   if(i%64==0){
    glUniform2f(screen,v[19]+100.0f,v[20]+100.0f);glClearBufferfv(GL_COLOR,0,&clear);glDrawArrays(GL_TRIANGLES,0,3);glReadPixels(0,0,1,1,GL_RED,GL_FLOAT,&got);
    if(got!=0){fprintf(stderr,"OFF-BOX RAY ACCEPTED record=%u zero=%d face=%g\n",i,zero,v[1]);return 3;}misses++;
   }
  }
  glDeleteProgram(p);
 }
 if(glGetError()!=GL_NO_ERROR)fail("GL error");
 printf("PASS %u off-box rays rejected; %u projected original surface points retained across two depth conventions, perspective/ortho, reflected bases, both sides and scales 0.05/1/16/80\n",misses,total);return 0;
}
