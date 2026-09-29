import java.nio.*;
import java.nio.file.*;
import java.util.*;
import org.lwjgl.BufferUtils;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL;
import static org.lwjgl.opengl.GL33C.*;
import static org.lwjgl.util.shaderc.Shaderc.*;

/** Full native posed mesh, layered draws and independent source geometry oracle. */
public class HorseMatrixCheck extends WindowsRasterCheck {
 static byte[] drawMany(int p,String draws,int[] rgb)throws Exception{
  glUseProgram(p);glClearColor(0,0,0,0);glClearDepth(0);glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
  if(!draws.isEmpty())for(String d:draws.split("\\|")){String[] a=d.split(";");int tex=texture(Path.of(a[0]),Integer.parseInt(a[1]),Integer.parseInt(a[2]));int[] geo=geometry(Path.of(a[3]),Integer.parseInt(a[4]),Integer.parseInt(a[6]),8);glUseProgram(p);glVertexAttrib4f(1,rgb[0]/255f,rgb[1]/255f,rgb[2]/255f,1);int location=glGetUniformLocation(p,"ReferenceShade");if(location>=0)glUniform1f(location,Float.parseFloat(a[5]));glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,tex);glBindVertexArray(geo[0]);glDrawElements(GL_TRIANGLES,geo[3],GL_UNSIGNED_INT,0L);glDeleteTextures(tex);glDeleteVertexArrays(geo[0]);glDeleteBuffers(geo[1]);glDeleteBuffers(geo[2]);}
  ByteBuffer data=BufferUtils.createByteBuffer(W*H*4);glReadPixels(0,0,W,H,GL_RGBA,GL_UNSIGNED_BYTE,data);byte[] bytes=new byte[data.remaining()];data.get(bytes);if(glGetError()!=0)throw new IllegalStateException("GL error");return bytes;
 }
 public static void main(String[] args)throws Exception{
  Path root=Path.of(args[0]);armor=true;if(!GLFW.glfwInit())throw new Exception("GLFW init");GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE,GLFW.GLFW_FALSE);GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MAJOR,3);GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MINOR,3);GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_PROFILE,GLFW.GLFW_OPENGL_CORE_PROFILE);long win=GLFW.glfwCreateWindow(W,H,"obj3 horse matrix",0,0);if(win==0)throw new Exception("GLFW window");GLFW.glfwMakeContextCurrent(win);GL.createCapabilities();String gpu=glGetString(GL_RENDERER)+" | "+glGetString(GL_VERSION);System.out.println(gpu);
  int direct=program(translated(root.resolve("entity.vert"),shaderc_vertex_shader),translated(root.resolve("entity.frag"),shaderc_fragment_shader));
  int ref=program("#version 330\nlayout(location=0) in vec3 Position;layout(location=2) in vec2 UV0;layout(std140) uniform Projection{mat4 ProjMat;};layout(std140) uniform DynamicTransforms{mat4 ModelViewMat;mat4 TextureMat;vec4 ColorModulator;vec3 ModelOffset;};out vec2 uv;void main(){gl_Position=ProjMat*ModelViewMat*vec4(Position,1);uv=UV0;}","#version 330\nuniform sampler2D Sampler0;uniform float ReferenceShade;in vec2 uv;out vec4 color;void main(){color=texture(Sampler0,uv);color.rgb*=ReferenceShade;}");
  fbo=glGenFramebuffers();glBindFramebuffer(GL_FRAMEBUFFER,fbo);colorTarget=glGenTextures();glBindTexture(GL_TEXTURE_2D,colorTarget);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,W,H,0,GL_RGBA,GL_UNSIGNED_BYTE,(ByteBuffer)null);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,colorTarget,0);depthTarget=glGenRenderbuffers();glBindRenderbuffer(GL_RENDERBUFFER,depthTarget);glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH_COMPONENT24,W,H);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_RENDERBUFFER,depthTarget);if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE)throw new Exception("FBO incomplete");glViewport(0,0,W,H);glEnable(GL_DEPTH_TEST);glDepthFunc(GL_GREATER);glDisable(GL_CULL_FACE);glDisable(GL_BLEND);glDisable(GL_DITHER);
  List<String> report=new ArrayList<>();report.add("id\tpassed\texpectedPixels\tactualPixels\tmissing\textra\trgbMismatch\tmeanRGBError");int failures=0,cases=0;
  for(String line:Files.readAllLines(root.resolve("cases.matrix.tsv"))){String[] a=line.split("\t",-1);int[] rgb=Arrays.stream(a[2].split(",")).mapToInt(Integer::parseInt).toArray();uniforms(direct,Float.parseFloat(a[1]));block(direct,"Lighting",2,new float[]{0,-1,0,0,0,0,-1,0});byte[] current=drawMany(direct,a[4],rgb);uniforms(ref,Float.parseFloat(a[1]));byte[] expected=drawMany(ref,a[5],new int[]{255,255,255});int area=0,actual=0,missing=0,extra=0,mismatch=0,common=0;long error=0;for(int i=0;i<current.length;i+=4){boolean aa=(current[i+3]&255)>0,bb=(expected[i+3]&255)>0;if(aa)actual++;if(bb)area++;if(bb&&!aa)missing++;if(aa&&!bb)extra++;if(aa&&bb){common++;int max=0;for(int k=0;k<3;k++){int d=Math.abs((current[i+k]&255)-(expected[i+k]&255));error+=d;max=Math.max(max,d);}if(max>2)mismatch++;}}
   boolean pass=Boolean.parseBoolean(a[3])?area==0&&actual==0:area>50&&missing+extra<=Math.max(12,area*.002)&&mismatch<=Math.max(30,area*.005);if(!pass)failures++;String row=String.format(Locale.ROOT,"%s\t%s\t%d\t%d\t%d\t%d\t%d\t%.6f",a[0],pass,area,actual,missing,extra,mismatch,error/(double)Math.max(1,common*3));report.add(row);if(!pass||a[0].contains("rest")||a[0].contains("animation")||a[0].contains("-t0.5-")){png(Path.of(a[6],"actual-render.png"),current);png(Path.of(a[6],"expected-render.png"),expected);}if(!pass)System.out.println(row);for(int u:ubos)glDeleteBuffers(u);ubos.clear();cases++;
  }
  Files.write(root.resolve("results.tsv"),report);Files.writeString(root.resolve("runtime.txt"),"UTC "+java.time.Instant.now()+"\n"+gpu+"\nCases="+cases+" failed="+failures+"\nIndependent source OBJ / native posed model matrix oracle. Hidden GL only, not gameplay/FPS.\n");System.out.println("Cases="+cases+" failed="+failures);GLFW.glfwDestroyWindow(win);GLFW.glfwTerminate();if(failures>0)System.exit(1);
 }
}
