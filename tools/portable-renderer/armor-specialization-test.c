// Compile and link expanded shaders on a real headless OpenGL driver.
// Usage: ./compile vertex.glsl fragment.glsl [major.minor]
// Reports context failures explicitly; defaults to 4.5 for the shipped shaders.
#include <epoxy/egl.h>
#include <epoxy/gl.h>
#include <stdio.h>
#include <stdlib.h>

static void failEGL(const char* operation) {
    fprintf(stderr, "%s failed (EGL error 0x%x)\n", operation, eglGetError());
    exit(4);
}

static char* slurp(const char* path) {
    FILE* file = fopen(path, "rb");
    if (!file) { perror(path); exit(1); }
    if (fseek(file, 0, SEEK_END)) { perror(path); exit(1); }
    long length = ftell(file);
    if (length < 0 || fseek(file, 0, SEEK_SET)) { perror(path); exit(1); }
    char* source = malloc((size_t)length + 1);
    if (!source || fread(source, 1, (size_t)length, file) != (size_t)length) {
        fprintf(stderr, "cannot read %s\n", path); exit(1);
    }
    source[length] = 0;
    fclose(file);
    return source;
}

static GLuint compileStage(GLenum type, const char* path) {
    char* source = slurp(path);
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, (const char**)&source, NULL);
    free(source);
    glCompileShader(shader);
    GLint ok = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    char log[8192];
    GLsizei length = 0;
    glGetShaderInfoLog(shader, sizeof log, &length, log);
    if (length) fprintf(stderr, "[%s]\n%s\n", path, log);
    if (!ok) { fprintf(stderr, "COMPILE FAILED: %s\n", path); exit(2); }
    return shader;
}

#include <string.h>
#include <math.h>

static void init(void){int major=3,minor=3;
    PFNEGLGETPLATFORMDISPLAYEXTPROC getDisplay =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay display = getDisplay
        ? getDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL)
        : eglGetDisplay(EGL_DEFAULT_DISPLAY);
    EGLint eglMajor, eglMinor;
    if (display == EGL_NO_DISPLAY || !eglInitialize(display, &eglMajor, &eglMinor)) failEGL("eglInitialize");
    if (!eglBindAPI(EGL_OPENGL_API)) failEGL("eglBindAPI");
    EGLint configAttributes[] = {EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_NONE};
    EGLConfig config;
    EGLint configCount;
    if (!eglChooseConfig(display, configAttributes, &config, 1, &configCount) || !configCount) failEGL("eglChooseConfig");
    EGLint contextAttributes[] = {EGL_CONTEXT_MAJOR_VERSION, major, EGL_CONTEXT_MINOR_VERSION, minor,
        EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE};
    EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttributes);
    if (context == EGL_NO_CONTEXT) failEGL("eglCreateContext");
    EGLint surfaceAttributes[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE};
    EGLSurface surface = eglCreatePbufferSurface(display, config, surfaceAttributes);
    if (surface == EGL_NO_SURFACE) failEGL("eglCreatePbufferSurface");
    if (!eglMakeCurrent(display, surface, surface, context)) failEGL("eglMakeCurrent");
    printf("GL %s on %s\n", glGetString(GL_VERSION), glGetString(GL_RENDERER));

}
static GLuint program(const char *v,const char *f){GLuint p=glCreateProgram();glAttachShader(p,compileStage(GL_VERTEX_SHADER,v));glAttachShader(p,compileStage(GL_FRAGMENT_SHADER,f));glLinkProgram(p);GLint ok;glGetProgramiv(p,GL_LINK_STATUS,&ok);if(!ok){char log[8192];glGetProgramInfoLog(p,sizeof log,0,log);fprintf(stderr,"%s\n",log);exit(3);}return p;}
static int ends(const char*s,const char*t){size_t a=strlen(s),b=strlen(t);return a>=b&&!strcmp(s+a-b,t);}
static void uniforms(GLuint p){
 GLint blocks;glGetProgramiv(p,GL_ACTIVE_UNIFORM_BLOCKS,&blocks);
 for(GLuint b=0;b<(GLuint)blocks;b++){
  GLint size,n;glGetActiveUniformBlockiv(p,b,GL_UNIFORM_BLOCK_DATA_SIZE,&size);glGetActiveUniformBlockiv(p,b,GL_UNIFORM_BLOCK_ACTIVE_UNIFORMS,&n);unsigned char *data=calloc(size,1);GLint *ids=calloc(n,sizeof(GLint));glGetActiveUniformBlockiv(p,b,GL_UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES,ids);
  for(int i=0;i<n;i++){GLuint id=ids[i];GLint off,count;GLenum type;char name[256];glGetActiveUniform(p,id,sizeof name,0,&count,&type,name);glGetActiveUniformsiv(p,1,&id,GL_UNIFORM_OFFSET,&off);float *v=(float*)(data+off);
   if(type==GL_FLOAT_MAT4){for(int k=0;k<4;k++)v[k*5]=1;}
   if(ends(name,"ColorModulator")){for(int k=0;k<4;k++)v[k]=1;}
   if(strstr(name,"Light")&&strstr(name,"Direction")){v[0]=.2;v[1]=.7;v[2]=.4;}
   if(type==GL_FLOAT&&strstr(name,"Start"))*v=1000;
   if(type==GL_FLOAT&&strstr(name,"End"))*v=2000;
   if(ends(name,"GlintAlpha"))*v=.4;
  }
  GLuint buffer;glGenBuffers(1,&buffer);glBindBuffer(GL_UNIFORM_BUFFER,buffer);glBufferData(GL_UNIFORM_BUFFER,size,data,GL_STATIC_DRAW);glUniformBlockBinding(p,b,b);glBindBufferBase(GL_UNIFORM_BUFFER,b,buffer);free(data);free(ids);
 }
 glUniform1i(glGetUniformLocation(p,"Sampler0"),0);glUniform1i(glGetUniformLocation(p,"Sampler1"),1);glUniform1i(glGetUniformLocation(p,"Sampler2"),2);glUniform1i(glGetUniformLocation(p,"GlintSampler"),3);
}
int main(int argc,char**argv){if(argc!=5){fprintf(stderr,"VS_BASE FS_BASE VS_SPECIAL FS_SPECIAL\n");return 1;}init();
 GLuint p[2]={program(argv[1],argv[2]),program(argv[3],argv[4])};GLuint vao,vbo,ibo;glGenVertexArrays(1,&vao);glBindVertexArray(vao);glGenBuffers(1,&vbo);glBindBuffer(GL_ARRAY_BUFFER,vbo);
 float vertex[]={-.75,-.75,.5,0,0, .75,-.75,.5,1,0, .75,.75,.5,1,1, -.75,.75,.5,0,1};glBufferData(GL_ARRAY_BUFFER,sizeof vertex,vertex,GL_STATIC_DRAW);glVertexAttribPointer(0,3,GL_FLOAT,0,20,0);glEnableVertexAttribArray(0);glVertexAttribPointer(2,2,GL_FLOAT,0,20,(void*)12);glEnableVertexAttribArray(2);glVertexAttrib4f(1,.7,.8,.9,1);glVertexAttribI2i(3,0,0);glVertexAttribI2i(4,0,0);glVertexAttrib3f(5,0,0,1);
 unsigned short indices[]={0,1,2,2,3,0};glGenBuffers(1,&ibo);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,ibo);glBufferData(GL_ELEMENT_ARRAY_BUFFER,sizeof indices,indices,GL_STATIC_DRAW);
 for(int i=0;i<4;i++){GLuint t;glGenTextures(1,&t);glActiveTexture(GL_TEXTURE0+i);glBindTexture(GL_TEXTURE_2D,t);unsigned char data[]={70,130,200,255,200,50,90,255,40,210,70,255,210,190,30,255};if(i==2)memset(data,255,sizeof data);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,2,2,0,GL_RGBA,GL_UNSIGNED_BYTE,data);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);}
 GLuint fbo,tex;glGenFramebuffers(1,&fbo);glBindFramebuffer(GL_FRAMEBUFFER,fbo);glGenTextures(1,&tex);glActiveTexture(GL_TEXTURE4);glBindTexture(GL_TEXTURE_2D,tex);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA32F,16,16,0,GL_RGBA,GL_FLOAT,0);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,tex,0);glViewport(0,0,16,16);glDisable(GL_DEPTH_TEST);
 float pixels[2][16*16*4];for(int i=0;i<2;i++){glUseProgram(p[i]);uniforms(p[i]);glClearColor(0,0,0,0);glClear(GL_COLOR_BUFFER_BIT);glDrawElements(GL_TRIANGLES,6,GL_UNSIGNED_SHORT,0);glReadPixels(0,0,16,16,GL_RGBA,GL_FLOAT,pixels[i]);}
 float max=0;int errors=0,covered=0;for(int i=0;i<16*16*4;i++){float d=fabsf(pixels[0][i]-pixels[1][i]);if(!isfinite(d)||d>1e-6)errors++;if(d>max)max=d;if(i%4==3&&pixels[0][i]>.5)covered++;}GLenum e=glGetError();printf("Ordinary raster: covered=%d maximum difference=%g failed components=%d GLerror=%x\n",covered,max,errors,e);return errors||covered!=144||e?2:0;
}
