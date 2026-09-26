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
 if(argc!=2)fail("Usage: early-test FIXTURES");
 init();
 GLuint p=glCreateProgram();glAttachShader(p,compile(argv[1],"early.vert",GL_VERTEX_SHADER));glAttachShader(p,compile(argv[1],"early.frag",GL_FRAGMENT_SHADER));glLinkProgram(p);GLint ok;glGetProgramiv(p,GL_LINK_STATUS,&ok);if(!ok){char log[4096];glGetProgramInfoLog(p,sizeof log,NULL,log);fail(log);}glUseProgram(p);
 long bytes;float *cases=(float*)read_file(argv[1],"carriers.f32",&bytes);if(bytes%(27*sizeof(float)))fail("Bad carrier table");
 GLuint vao,vbo,ibo,header,output,fbo;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(1,&vbo);glBindBuffer(GL_ARRAY_BUFFER,vbo);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,0,0);glEnableVertexAttribArray(0);glGenBuffers(1,&ibo);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,ibo);const unsigned indices[]={0,1,2,2,3,0};glBufferData(GL_ELEMENT_ARRAY_BUFFER,sizeof indices,indices,GL_STATIC_DRAW);
 glGenTextures(1,&header);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,header);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glUniform1i(glGetUniformLocation(p,"Sampler0"),0);
 glGenTextures(1,&output);glGenFramebuffers(1,&fbo);glBindFramebuffer(GL_FRAMEBUFFER,fbo);
 const int dimensions[][2]={{17,13},{64,64},{320,180}};unsigned draws=0;unsigned long long pixels=0,rejected=0;float *result=malloc(320*180*sizeof(float));
 for(int size=0;size<3;size++){
  int w=dimensions[size][0],h=dimensions[size][1];glBindTexture(GL_TEXTURE_2D,output);glTexImage2D(GL_TEXTURE_2D,0,GL_R32F,w,h,0,GL_RED,GL_FLOAT,NULL);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,output,0);if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE)fail("FBO");glViewport(0,0,w,h);glBindTexture(GL_TEXTURE_2D,header);
  for(unsigned c=0;c<bytes/(27*sizeof(float));c++){
   float *v=cases+c*27;if(v[2]!=0)continue;int part=v[0],face=v[1],base=v[3];
   float uv[16]={0};for(int i=0;i<4;i++){uv[(base+i)*2]=v[16+i*2]*64;uv[(base+i)*2+1]=v[17+i*2]*32;}glBufferData(GL_ARRAY_BUFFER,sizeof uv,uv,GL_DYNAMIC_DRAW);
   for(int state=0;state<4;state++){
    unsigned char data[32*4]={0};for(int b=0;b<3;b++)for(int f=0;f<4;f++){int x=8+f*3+b;data[x*4]=data[x*4+1]=255;}data[8*4+3]=3;
    int target=state==3?(part==1?2:1):part;data[10*4+2]=target;
    // state 0 empty; 1 selected route; 2 all routes; 3 another kind only.
    for(int f=0;f<4;f++){int fk=(int[]){3,5,2,4}[f];if(state==2||state==3||(state==1&&face==fk)){data[(10+3*f)*4]=0;data[(10+3*f)*4+1]=7;}}
    glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,32,1,0,GL_RGBA,GL_UNSIGNED_BYTE,data);
    float expected=(face>=2&&(state==1||state==2))?1:0;
    float clear=-9;glClearBufferfv(GL_COLOR,0,&clear);glDrawElementsBaseVertex(GL_TRIANGLES,6,GL_UNSIGNED_INT,0,base);glReadPixels(0,0,w,h,GL_RED,GL_FLOAT,result);
    for(int k=0;k<w*h;k++)if(result[k]!=expected){fprintf(stderr,"Mismatch size=%dx%d part=%d face=%d cycle=%d state=%d pixel=%d expected=%g got=%g\n",w,h,part,face,base,state,k,expected,result[k]);return 2;}
    draws++;pixels+=(unsigned long long)w*h;if(!expected)rejected+=(unsigned long long)w*h;
   }
  }
 }
 if(glGetError()!=GL_NO_ERROR)fail("GL error");
 printf("PASS %u draws / %llu pixels; %llu unused pixels rejected, zero false rejections across all armor parts/faces/mirrors/cyclic offsets\n",draws,pixels,rejected);return 0;
}
