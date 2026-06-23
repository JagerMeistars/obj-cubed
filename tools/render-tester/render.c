// Visual render-tester A: obj3 decoded cube vs a vanilla display-baked reference cube,
// rendered through the SAME camera, then a per-pixel coverage diff. Where the obj3
// shader reconstructs the display transform correctly the two silhouettes coincide;
// where it can't (e.g. per-axis Z on a flat carrier) they diverge -> red/green fringe.
//   inputs (from prep.mjs): tex.raw, verts.f32 (baked carrier), uv.f32, ref.f32 (baked
//   reference cube), meta.txt.  shaders: entity.vert/frag.glsl (obj3), ref.vert/frag.glsl.
//   build: cc render.c -o render $(pkg-config --cflags --libs egl epoxy) -lm
//   run:   ./render entity.vert.glsl entity.frag.glsl
#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

enum { OUT = 512 };

static char* slurp(const char* p){ FILE* f=fopen(p,"rb"); if(!f){fprintf(stderr,"open %s\n",p);exit(1);} fseek(f,0,SEEK_END); long n=ftell(f); fseek(f,0,SEEK_SET); char* b=malloc(n+1); fread(b,1,n,f); b[n]=0; fclose(f); return b; }
static void* slurpBin(const char* p,long* len){ FILE* f=fopen(p,"rb"); if(!f){fprintf(stderr,"open %s\n",p);exit(1);} fseek(f,0,SEEK_END); long n=ftell(f); fseek(f,0,SEEK_SET); void* b=malloc(n); fread(b,1,n,f); fclose(f); if(len)*len=n; return b; }

static GLuint stage(GLenum t,const char* p){ char* s=slurp(p); GLuint sh=glCreateShader(t); glShaderSource(sh,1,(const char**)&s,0); glCompileShader(sh); GLint ok; glGetShaderiv(sh,GL_COMPILE_STATUS,&ok); char log[8192]; GLsizei l; glGetShaderInfoLog(sh,8192,&l,log); if(l)fprintf(stderr,"[%s]\n%s\n",p,log); if(!ok)exit(2); free(s); return sh; }
static GLuint mkprog2(const char* v,const char* f,const char* tfv){ GLuint p=glCreateProgram(); glAttachShader(p,stage(GL_VERTEX_SHADER,v)); glAttachShader(p,stage(GL_FRAGMENT_SHADER,f)); if(tfv){ glTransformFeedbackVaryings(p,1,&tfv,GL_INTERLEAVED_ATTRIBS);} glLinkProgram(p); GLint ok; glGetProgramiv(p,GL_LINK_STATUS,&ok); char log[8192]; GLsizei l; glGetProgramInfoLog(p,8192,&l,log); if(l)fprintf(stderr,"link[%s]:\n%s\n",v,log); if(!ok)exit(3); return p; }
static GLuint mkprog(const char* v,const char* f){ return mkprog2(v,f,0); }

// column-major mat4
static void perspective(float* m,float fov,float asp,float n,float f){ float t=1.0f/tanf(fov*0.5f); memset(m,0,64); m[0]=t/asp; m[5]=t; m[10]=(f+n)/(n-f); m[11]=-1; m[14]=2*f*n/(n-f); }
static void nrm(float* v){ float l=sqrtf(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); v[0]/=l;v[1]/=l;v[2]/=l; }
static void crs(float* r,const float* a,const float* b){ r[0]=a[1]*b[2]-a[2]*b[1]; r[1]=a[2]*b[0]-a[0]*b[2]; r[2]=a[0]*b[1]-a[1]*b[0]; }
static void lookAt(float* m,float ex,float ey,float ez,float cx,float cy,float cz){
  float fwd[3]={cx-ex,cy-ey,cz-ez}; nrm(fwd);
  float up[3]={0,1,0}; float s[3]; crs(s,fwd,up); nrm(s); float u[3]; crs(u,s,fwd);
  m[0]=s[0]; m[4]=s[1]; m[8]=s[2];  m[12]=-(s[0]*ex+s[1]*ey+s[2]*ez);
  m[1]=u[0]; m[5]=u[1]; m[9]=u[2];  m[13]=-(u[0]*ex+u[1]*ey+u[2]*ez);
  m[2]=-fwd[0]; m[6]=-fwd[1]; m[10]=-fwd[2]; m[14]=(fwd[0]*ex+fwd[1]*ey+fwd[2]*ez);
  m[3]=0; m[7]=0; m[11]=0; m[15]=1;
}

static void initEGL(void){
  PFNEGLGETPLATFORMDISPLAYEXTPROC g=(PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
  EGLDisplay d=g?g(EGL_PLATFORM_SURFACELESS_MESA,EGL_DEFAULT_DISPLAY,0):eglGetDisplay(EGL_DEFAULT_DISPLAY);
  EGLint a,b; eglInitialize(d,&a,&b); eglBindAPI(EGL_OPENGL_API);
  EGLint ca[]={EGL_SURFACE_TYPE,EGL_PBUFFER_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_BIT,EGL_NONE}; EGLConfig c; EGLint n; eglChooseConfig(d,ca,&c,1,&n);
  EGLint xa[]={EGL_CONTEXT_MAJOR_VERSION,4,EGL_CONTEXT_MINOR_VERSION,6,EGL_CONTEXT_OPENGL_PROFILE_MASK,EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,EGL_NONE};
  EGLContext x=eglCreateContext(d,c,EGL_NO_CONTEXT,xa); eglMakeCurrent(d,EGL_NO_SURFACE,EGL_NO_SURFACE,x);
}
static GLuint mkubo(int binding,const void* data,int size){
  GLuint b; glGenBuffers(1,&b); glBindBuffer(GL_UNIFORM_BUFFER,b);
  char zero[512]={0}; glBufferData(GL_UNIFORM_BUFFER,512,zero,GL_STATIC_DRAW);
  if(data) glBufferSubData(GL_UNIFORM_BUFFER,0,size,data);
  glBindBufferBase(GL_UNIFORM_BUFFER,binding,b); return b;
}
static void bindBlock(GLuint prog,const char* name,int binding){ GLuint i=glGetUniformBlockIndex(prog,name); if(i!=GL_INVALID_INDEX) glUniformBlockBinding(prog,i,binding); }

// upload a vec3 vertex buffer + Position attrib, build a quad index buffer; returns VAO, sets *nidx
static GLuint meshFromFile(const char* path,GLuint prog,GLuint* ibo,int* nidx){
  long bl; void* d=slurpBin(path,&bl); int nv=bl/12, faces=nv/4;
  GLuint vao,vbo; glGenVertexArrays(1,&vao); glBindVertexArray(vao);
  glGenBuffers(1,&vbo); glBindBuffer(GL_ARRAY_BUFFER,vbo); glBufferData(GL_ARRAY_BUFFER,bl,d,GL_STATIC_DRAW);
  GLint pl=glGetAttribLocation(prog,"Position"); if(pl>=0){ glEnableVertexAttribArray(pl); glVertexAttribPointer(pl,3,GL_FLOAT,GL_FALSE,12,0); }
  unsigned* idx=malloc(faces*6*4); for(int f=0;f<faces;f++){ int o=f*4; unsigned p[6]={o,o+1,o+2,o+2,o+3,o}; memcpy(idx+f*6,p,24);}
  glGenBuffers(1,ibo); glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,*ibo); glBufferData(GL_ELEMENT_ARRAY_BUFFER,faces*6*4,idx,GL_STATIC_DRAW);
  *nidx=faces*6; free(idx); return vao;
}

int main(int argc,char**argv){
  if(argc<3){fprintf(stderr,"usage: %s entity.vert entity.frag\n",argv[0]);return 1;}
  initEGL();
  int tw,th,nv; { char* m=slurp("meta.txt"); sscanf(m,"%d %d %d",&tw,&th,&nv); free(m); }
  printf("GL %s | tex %dx%d\n",glGetString(GL_RENDERER),tw,th);

  GLuint objP=mkprog2(argv[1],argv[2],"Pos");   // TF-capture obj3 world Pos for diagnostics
  GLuint refP=mkprog("ref.vert.glsl","ref.frag.glsl");

  // encoded model texture (unit 0) + white overlay/lightmap (units 1,2)
  long tl; void* tex=slurpBin("tex.raw",&tl);
  GLuint t; glGenTextures(1,&t); glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,t);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST); glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
  glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,tw,th,0,GL_RGBA,GL_UNSIGNED_BYTE,tex);
  unsigned char white[4]={255,255,255,255};
  for(int u=1;u<=2;u++){ GLuint w; glGenTextures(1,&w); glActiveTexture(GL_TEXTURE0+u); glBindTexture(GL_TEXTURE_2D,w);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST); glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
    glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,1,1,0,GL_RGBA,GL_UNSIGNED_BYTE,white); }

  // obj3 carrier mesh (Position + UV0); ref mesh (Position only)
  GLuint iboObj,iboRef; int nidxObj,nidxRef;
  GLuint vaoObj=meshFromFile("verts.f32",objP,&iboObj,&nidxObj);
  // UV0 for the carrier (the marker-offset data pixels)
  long ul; void* ud=slurpBin("uv.f32",&ul);
  GLuint uvbo; glGenBuffers(1,&uvbo); glBindBuffer(GL_ARRAY_BUFFER,uvbo); glBufferData(GL_ARRAY_BUFFER,ul,ud,GL_STATIC_DRAW);
  GLint uvLoc=glGetAttribLocation(objP,"UV0"); if(uvLoc>=0){ glEnableVertexAttribArray(uvLoc); glVertexAttribPointer(uvLoc,2,GL_FLOAT,GL_FALSE,8,0); }
  GLuint vaoRef=meshFromFile("ref.f32",refP,&iboRef,&nidxRef);

  // constant attribs for obj3 (used when arrays disabled)
  glUseProgram(objP);
  GLint s0=glGetUniformLocation(objP,"Sampler0"); if(s0>=0)glUniform1i(s0,0);
  GLint s1=glGetUniformLocation(objP,"Sampler1"); if(s1>=0)glUniform1i(s1,1);
  GLint s2=glGetUniformLocation(objP,"Sampler2"); if(s2>=0)glUniform1i(s2,2);
  GLint cl=glGetAttribLocation(objP,"Color"); if(cl>=0)glVertexAttrib4f(cl,1,1,1,1);
  GLint a1=glGetAttribLocation(objP,"UV1"); if(a1>=0)glVertexAttribI2i(a1,0,0);
  GLint a2=glGetAttribLocation(objP,"UV2"); if(a2>=0)glVertexAttribI2i(a2,15,15);
  GLint nl=glGetAttribLocation(objP,"Normal"); if(nl>=0)glVertexAttrib3f(nl,0,0,1);

  // camera: angled view so all 3 axes are visible (head-on hides Z divergence).
  // carrier centre ~ (1, 0.5, 0.5); look from over-the-shoulder.
  float proj[16]; perspective(proj,1.0f,1.0f,0.1f,100.0f);   // near 0.1 != hand sig
  float mv[16]; lookAt(mv, 3.2f,2.6f,3.4f, 1.0f,0.55f,0.5f);
  float dyn[40]; memset(dyn,0,sizeof dyn); memcpy(dyn,mv,64); dyn[16]=dyn[17]=dyn[18]=dyn[19]=1;
  float lit[8]={0.2f,1.0f,-0.7f,0, -0.2f,1.0f,0.7f,0};
  mkubo(0,proj,64); mkubo(1,dyn,160); mkubo(2,lit,32); mkubo(3,0,0); mkubo(4,0,0);
  bindBlock(objP,"Projection",0); bindBlock(objP,"DynamicTransforms",1); bindBlock(objP,"Lighting",2); bindBlock(objP,"Fog",3); bindBlock(objP,"Globals",4);
  bindBlock(refP,"Projection",0); bindBlock(refP,"DynamicTransforms",1);

  // FBO
  GLuint ct; glGenTextures(1,&ct); glActiveTexture(GL_TEXTURE0+3); glBindTexture(GL_TEXTURE_2D,ct); glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,OUT,OUT,0,GL_RGBA,GL_UNSIGNED_BYTE,0);
  GLuint depth; glGenRenderbuffers(1,&depth); glBindRenderbuffer(GL_RENDERBUFFER,depth); glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH_COMPONENT24,OUT,OUT);
  GLuint fbo; glGenFramebuffers(1,&fbo); glBindFramebuffer(GL_FRAMEBUFFER,fbo);
  glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,ct,0);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_RENDERBUFFER,depth);
  if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE){fprintf(stderr,"FBO incomplete\n");return 4;}
  glViewport(0,0,OUT,OUT); glEnable(GL_DEPTH_TEST);

  // DIAGNOSTIC: obj3 reconstructed world Pos bbox vs reference cube world bbox
  if(getenv("TFDIAG")){
    GLuint tfb; glGenBuffers(1,&tfb); glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,tfb);
    glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER,nv*12,0,GL_DYNAMIC_READ); glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,tfb);
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,t);
    glUseProgram(objP); glBindVertexArray(vaoObj);
    glEnable(GL_RASTERIZER_DISCARD); glBeginTransformFeedback(GL_POINTS); glDrawArrays(GL_POINTS,0,nv); glEndTransformFeedback(); glDisable(GL_RASTERIZER_DISCARD);
    float* pos=malloc(nv*12); glGetBufferSubData(GL_TRANSFORM_FEEDBACK_BUFFER,0,nv*12,pos);
    float omn[3]={1e9,1e9,1e9},omx[3]={-1e9,-1e9,-1e9};
    for(int i=0;i<nv;i++)for(int c=0;c<3;c++){float v=pos[i*3+c]; if(v<omn[c])omn[c]=v; if(v>omx[c])omx[c]=v;}
    long rl; float* rf=slurpBin("ref.f32",&rl); int nr=rl/12;
    float rmn[3]={1e9,1e9,1e9},rmx[3]={-1e9,-1e9,-1e9};
    for(int i=0;i<nr;i++)for(int c=0;c<3;c++){float v=rf[i*3+c]; if(v<rmn[c])rmn[c]=v; if(v>rmx[c])rmx[c]=v;}
    printf("obj3 world bbox: x[%.3f..%.3f] y[%.3f..%.3f] z[%.3f..%.3f]\n",omn[0],omx[0],omn[1],omx[1],omn[2],omx[2]);
    printf("ref  world bbox: x[%.3f..%.3f] y[%.3f..%.3f] z[%.3f..%.3f]\n",rmn[0],rmx[0],rmn[1],rmx[1],rmn[2],rmx[2]);
    printf("world centre delta (obj3-ref): dx=%.3f dy=%.3f dz=%.3f\n",
      (omn[0]+omx[0]-rmn[0]-rmx[0])/2,(omn[1]+omx[1]-rmn[1]-rmx[1])/2,(omn[2]+omx[2]-rmn[2]-rmx[2])/2);
    free(pos); free(rf);
  }

  unsigned char* pxA=malloc(OUT*OUT*4); unsigned char* pxB=malloc(OUT*OUT*4);
  // pass A: obj3 (alpha 0 clear -> coverage = alpha>0)
  glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,t);   // rebind encoded tex to unit 0
  glClearColor(0,0,0,0); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
  glUseProgram(objP); glBindVertexArray(vaoObj); glDrawElements(GL_TRIANGLES,nidxObj,GL_UNSIGNED_INT,0);
  glFinish(); glReadPixels(0,0,OUT,OUT,GL_RGBA,GL_UNSIGNED_BYTE,pxA);
  // pass B: reference cube
  glClearColor(0,0,0,0); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
  glUseProgram(refP); glBindVertexArray(vaoRef); glDrawElements(GL_TRIANGLES,nidxRef,GL_UNSIGNED_INT,0);
  glFinish(); glReadPixels(0,0,OUT,OUT,GL_RGBA,GL_UNSIGNED_BYTE,pxB);
  GLenum e=glGetError(); if(e)fprintf(stderr,"GL error 0x%x\n",e);

  // diff: both->white, obj3-only->red, ref-only->green, neither->bg
  unsigned char* out=malloc(OUT*OUT*4);
  long both=0,aOnly=0,bOnly=0,ca=0,cb=0;
  int axmin=OUT,axmax=-1,aymin=OUT,aymax=-1, bxmin=OUT,bxmax=-1,bymin=OUT,bymax=-1;
  for(int y=0;y<OUT;y++)for(int x=0;x<OUT;x++){ int i=y*OUT+x; int A=pxA[i*4+3]>10, B=pxB[i*4+3]>10; ca+=A; cb+=B;
    if(A){if(x<axmin)axmin=x;if(x>axmax)axmax=x;if(y<aymin)aymin=y;if(y>aymax)aymax=y;}
    if(B){if(x<bxmin)bxmin=x;if(x>bxmax)bxmax=x;if(y<bymin)bymin=y;if(y>bymax)bymax=y;}
    unsigned char r,g,b;
    if(A&&B){r=g=b=235; both++;} else if(A){r=230;g=40;b=40; aOnly++;} else if(B){r=40;g=210;b=60; bOnly++;} else {r=22;g=24;b=32;}
    out[i*4]=r; out[i*4+1]=g; out[i*4+2]=b; out[i*4+3]=255;
  }
  // NOTE screen y is top-down here; world up = smaller y.
  printf("obj3 bbox x[%d..%d] y[%d..%d] (%dx%d)\n",axmin,axmax,aymin,aymax,axmax-axmin+1,aymax-aymin+1);
  printf("ref  bbox x[%d..%d] y[%d..%d] (%dx%d)\n",bxmin,bxmax,bymin,bymax,bxmax-bxmin+1,bymax-bymin+1);
  printf("center delta: dx=%.1f dy=%.1f (obj3 - ref, screen px)\n",(axmin+axmax)/2.0-(bxmin+bxmax)/2.0,(aymin+aymax)/2.0-(bymin+bymax)/2.0);
  FILE* o=fopen("out.raw","wb"); fwrite(out,1,OUT*OUT*4,o); fclose(o);
  double iou = both ? (double)both/(both+aOnly+bOnly) : 0;
  printf("obj3 covers %ld px | ref covers %ld px\n",ca,cb);
  printf("agree(both)=%ld  obj3-only(red)=%ld  ref-only(green)=%ld  IoU=%.4f\n",both,aOnly,bOnly,iou);
  printf("%s\n", iou>0.98 ? "MATCH (cubes coincide)" : iou>0.85 ? "CLOSE (minor fringe)" : "DIVERGE (see red/green in out.png)");
  return 0;
}
