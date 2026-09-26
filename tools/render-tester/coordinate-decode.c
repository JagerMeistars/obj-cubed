// Exhaustive RGB24 position decoding against the signed fixed-point format.
// The runner extracts getpos from the actual resource-pack include.
#define main compile_only_main
#include "compile.c"
#undef main
#include <stdint.h>
#include <math.h>

int main(int argc, char** argv) {
    if (argc != 2) return 1;
    PFNEGLGETPLATFORMDISPLAYEXTPROC getDisplay =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay d = getDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL);
    if (!eglInitialize(d, NULL, NULL) || !eglBindAPI(EGL_OPENGL_API)) failEGL("initialize");
    EGLint ca[] = {EGL_SURFACE_TYPE,EGL_PBUFFER_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_BIT,EGL_NONE};
    EGLConfig cfg; EGLint count;
    if (!eglChooseConfig(d,ca,&cfg,1,&count) || !count) failEGL("config");
    EGLint ctxa[] = {EGL_CONTEXT_MAJOR_VERSION,3,EGL_CONTEXT_MINOR_VERSION,3,
        EGL_CONTEXT_OPENGL_PROFILE_MASK,EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,EGL_NONE};
    EGLContext ctx=eglCreateContext(d,cfg,EGL_NO_CONTEXT,ctxa);
    EGLint sa[] = {EGL_WIDTH,1,EGL_HEIGHT,1,EGL_NONE};
    EGLSurface surf=eglCreatePbufferSurface(d,cfg,sa);
    if (ctx==EGL_NO_CONTEXT || surf==EGL_NO_SURFACE || !eglMakeCurrent(d,surf,surf,ctx)) failEGL("context");
    printf("GPU: %s\n",glGetString(GL_RENDERER));
    GLuint prog=glCreateProgram(), shader=compileStage(GL_VERTEX_SHADER,argv[1]);
    glAttachShader(prog,shader);
    const char* varying="decoded";
    glTransformFeedbackVaryings(prog,1,&varying,GL_INTERLEAVED_ATTRIBS);
    glLinkProgram(prog);
    GLint ok; glGetProgramiv(prog,GL_LINK_STATUS,&ok);
    if (!ok) {char log[8192];glGetProgramInfoLog(prog,sizeof log,NULL,log);puts(log);return 2;}
    glUseProgram(prog);
    enum {N=65536};
    unsigned char* bytes=malloc(N*12); float* result=malloc(N*3*sizeof(float));
    GLuint vao,tex,tf;
    glGenVertexArrays(1,&vao);glBindVertexArray(vao);
    glGenTextures(1,&tex);glBindTexture(GL_TEXTURE_2D,tex);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
    glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,768,256,0,GL_RGBA,GL_UNSIGNED_BYTE,NULL);
    glGenBuffers(1,&tf);glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,tf);
    glBufferData(GL_TRANSFORM_FEEDBACK_BUFFER,N*3*sizeof(float),NULL,GL_STREAM_READ);
    glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,tf);
    glEnable(GL_RASTERIZER_DISCARD);
    uint64_t errors=0; float maxError=0;
    for (unsigned red=0;red<256;red++) {
        for (unsigned i=0;i<N;i++) {
            unsigned code=(red<<16)|i;
            unsigned codes[3]={code,code^0xffffffu,(code*65537u)&0xffffffu};
            for(unsigned a=0;a<3;a++) {
                unsigned off=(i*3+a)*4, c=codes[a];
                bytes[off]=c>>16;bytes[off+1]=c>>8;bytes[off+2]=c;bytes[off+3]=255;
            }
        }
        glTexSubImage2D(GL_TEXTURE_2D,0,0,0,768,256,GL_RGBA,GL_UNSIGNED_BYTE,bytes);
        glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,0,N);glEndTransformFeedback();
        glGetBufferSubData(GL_TRANSFORM_FEEDBACK_BUFFER,0,N*3*sizeof(float),result);
        GLenum err=glGetError();
        if(err!=GL_NO_ERROR) {fprintf(stderr,"GL error 0x%x\n",err);return 3;}
        for (unsigned i=0;i<N;i++) for(unsigned a=0;a<3;a++) {
            unsigned off=(i*3+a)*4;
            int code=(bytes[off]<<16)|(bytes[off+1]<<8)|bytes[off+2];
            float expected=(float)(code-8388608)/65536.f,actual=result[i*3+a];
            float error=fabsf(actual-expected);
            if(!isfinite(actual)||error!=0) {errors++;if(error>maxError) maxError=error;}
        }
    }
    printf("50331648 coordinate decodes, errors=%llu, maxError=%.9g\n",(unsigned long long)errors,maxError);
    free(bytes);free(result);glDeleteProgram(prog);glDeleteShader(shader);
    glDeleteBuffers(1,&tf);glDeleteTextures(1,&tex);glDeleteVertexArrays(1,&vao);
    eglMakeCurrent(d,EGL_NO_SURFACE,EGL_NO_SURFACE,EGL_NO_CONTEXT);eglDestroySurface(d,surf);eglDestroyContext(d,ctx);eglTerminate(d);
    return errors ? 4 : 0;
}
