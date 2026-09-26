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
 if(argc!=2)fail("Usage: armor-carrier-test FIXTURES");
 init();
 GLuint p=glCreateProgram();glAttachShader(p,compile(argv[1],"transfer.vert",GL_VERTEX_SHADER));glAttachShader(p,compile(argv[1],"transfer.frag",GL_FRAGMENT_SHADER));glLinkProgram(p);GLint ok;glGetProgramiv(p,GL_LINK_STATUS,&ok);if(!ok){char log[4096];glGetProgramInfoLog(p,sizeof log,NULL,log);fail(log);}glUseProgram(p);
 long bytes;float *cases=(float*)read_file(argv[1],"carriers.f32",&bytes);if(bytes%(27*sizeof(float)))fail("Bad carrier table");
 GLuint vao,vbo,ibo,output,fbo;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(1,&vbo);glBindBuffer(GL_ARRAY_BUFFER,vbo);glVertexAttribPointer(0,3,GL_FLOAT,GL_FALSE,5*sizeof(float),0);glVertexAttribPointer(1,2,GL_FLOAT,GL_FALSE,5*sizeof(float),(void*)(3*sizeof(float)));glEnableVertexAttribArray(0);glEnableVertexAttribArray(1);glGenBuffers(1,&ibo);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,ibo);const unsigned indices[]={0,1,2,2,3,0};glBufferData(GL_ELEMENT_ARRAY_BUFFER,sizeof indices,indices,GL_STATIC_DRAW);
 glGenTextures(1,&output);glGenFramebuffers(1,&fbo);glBindFramebuffer(GL_FRAMEBUFFER,fbo);
 const int dimensions[][2]={{17,13},{64,64},{320,180}};unsigned draws=0;unsigned long long pixels=0;float *result=malloc(320*180*4*sizeof(float));float largest_position=0,largest_uv=0;
 for(int size=0;size<3;size++){
  int w=dimensions[size][0],h=dimensions[size][1];glBindTexture(GL_TEXTURE_2D,output);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA32F,w,h,0,GL_RGBA,GL_FLOAT,NULL);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,output,0);if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE)fail("FBO");glViewport(0,0,w,h);
  for(unsigned c=0;c<bytes/(27*sizeof(float));c++){
   float *v=cases+c*27;int part=v[0],face=v[1],base=v[3];if(face<2)continue;
   glUniform1i(glGetUniformLocation(p,"flags"),part|(face<<3));
   for(int offset=0;offset<3;offset++){
    float data[8*5]={0};
    for(int i=0;i<4;i++){
     for(int axis=0;axis<3;axis++)data[(base+i)*5+axis]=v[4+i*3+axis]*(offset==2?.01f:1.f)+(offset?(axis==0?400.f:axis==1?-200.f:1234.f):0.f);
     data[(base+i)*5+3]=v[16+i*2]*64;data[(base+i)*5+4]=v[17+i*2]*32;
    }
    glBufferData(GL_ARRAY_BUFFER,sizeof data,data,GL_DYNAMIC_DRAW);
    float clear[4]={-9,-9,-9,-9};glClearBufferfv(GL_COLOR,0,clear);glDrawElementsBaseVertex(GL_TRIANGLES,6,GL_UNSIGNED_INT,0,base);glReadPixels(0,0,w,h,GL_RGBA,GL_FLOAT,result);
    for(int k=0;k<w*h;k++){
     float *q=result+4*k;largest_position=fmaxf(largest_position,q[0]);largest_uv=fmaxf(largest_uv,q[1]);
     if(!isfinite(q[0])||q[0]<0||q[0]>0.00025f||q[1]!=0||q[2]!=0||q[3]!=0){fprintf(stderr,"Mismatch size=%dx%d part=%d face=%d shape=%g cycle=%d offset=%d pixel=%d got=(%g,%g,%g,%g)\n",w,h,part,face,v[2],base,offset,k,q[0],q[1],q[2],q[3]);return 2;}
    }
    draws++;pixels+=(unsigned long long)w*h;
   }
  }
 }
 if(glGetError()!=GL_NO_ERROR)fail("GL error");
 printf("PASS %u draws / %llu pixels; max position difference=%g, UV difference=%g; zero invalid or missed samples\n",draws,pixels,largest_position,largest_uv);free(result);free(cases);return 0;
}
