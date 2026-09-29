import java.nio.*;
import java.nio.file.*;
import java.util.*;
import org.lwjgl.BufferUtils;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL;
import static org.lwjgl.opengl.GL33C.*;
import static org.lwjgl.util.shaderc.Shaderc.*;

// Tests texture/frame pixels against independently generated static images.
public class TextureAnimationCheck extends ColorBehaviorCheck {
 static void setup(int p,float time,boolean gui){bind(p,time);if(gui){float[] proj=ident();proj[0]=.006f;proj[5]=.006f;proj[10]=-.001f;block(p,"Projection",1,proj);float[] dyn=new float[40];System.arraycopy(ident(),0,dyn,0,16);System.arraycopy(ident(),0,dyn,16,16);Arrays.fill(dyn,32,36,1);block(p,"DynamicTransforms",0,dyn);}}
 static int[] mesh(Path file,int count,boolean equipment,boolean gui)throws Exception{if(!gui)return geometry(file,count,0,equipment?8:5);byte[] raw=Files.readAllBytes(file);ByteBuffer b=ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);for(int i=0;i<raw.length;i+=20)for(int k=0;k<3;k++)b.putFloat(i+k*4,b.getFloat(i+k*4)*100);Path enlarged=Path.of(file+".gui.f32");Files.write(enlarged,raw);return geometry(enlarged,count,0,5);}
 public static void main(String[] args)throws Exception{
  Path root=Path.of(args[0]);if(!GLFW.glfwInit())throw new Exception("GLFW init");GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE,GLFW.GLFW_FALSE);GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MAJOR,3);GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MINOR,3);GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_PROFILE,GLFW.GLFW_OPENGL_CORE_PROFILE);long win=GLFW.glfwCreateWindow(S,S,"obj3 texture animation test",0,0);if(win==0)throw new Exception("GLFW window");GLFW.glfwMakeContextCurrent(win);GL.createCapabilities();String gpu=glGetString(GL_RENDERER)+" | "+glGetString(GL_VERSION);System.out.println(gpu);
  Map<String,Integer> programs=new HashMap<>();for(String name:new String[]{"item","entity"})programs.put(name,program(translated(root.resolve(name+".vert"),shaderc_vertex_shader),translated(root.resolve(name+".frag"),shaderc_fragment_shader)));
  int fbo=glGenFramebuffers();glBindFramebuffer(GL_FRAMEBUFFER,fbo);int color=glGenTextures();glBindTexture(GL_TEXTURE_2D,color);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,S,S,0,GL_RGBA,GL_UNSIGNED_BYTE,(ByteBuffer)null);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,color,0);int depth=glGenRenderbuffers();glBindRenderbuffer(GL_RENDERBUFFER,depth);glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH_COMPONENT24,S,S);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_RENDERBUFFER,depth);if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE)throw new Exception("FBO incomplete");glViewport(0,0,S,S);glEnable(GL_DEPTH_TEST);glDisable(GL_CULL_FACE);glDisable(GL_BLEND);glDisable(GL_DITHER);
  List<String> reports=new ArrayList<>();reports.add("id\tpassed\tactualPixels\texpectedPixels\tmissing\textra\trgbMismatch\tmeanRGBError\tactualSHA256\texpectedSHA256");int failures=0,n=0;
  for(String line:Files.readAllLines(root.resolve("cases.tsv"))){String[] a=line.split("\t");String id=a[0],context=a[1];boolean gui=context.equals("gui");armor=context.equals("armor");glDepthFunc(armor?GL_GREATER:GL_LESS);int p=programs.get(armor||context.equals("entity")?"entity":"item");int[] rgb=Arrays.stream(a[3].split(",")).mapToInt(Integer::parseInt).toArray();byte[][] pixels=new byte[2][];int[] ts=new int[2];int[][] ms=new int[2][];
   for(int j=0;j<2;j++){int offset=4+j*5;ts[j]=texture(Path.of(a[offset]),Integer.parseInt(a[offset+2]),Integer.parseInt(a[offset+3]));ms[j]=mesh(Path.of(a[offset+1]),Integer.parseInt(a[offset+4]),armor,gui);setup(p,Float.parseFloat(a[2]),gui);pixels[j]=render(p,ts[j],ms[j],rgb);}
   int actual=0,expected=0,missing=0,extra=0,mismatch=0,common=0;long error=0;for(int i=0;i<pixels[0].length;i+=4){boolean aa=(pixels[0][i+3]&255)>0,bb=(pixels[1][i+3]&255)>0;if(aa)actual++;if(bb)expected++;if(bb&&!aa)missing++;if(aa&&!bb)extra++;if(aa&&bb){common++;int max=0;for(int k=0;k<3;k++){int d=Math.abs((pixels[0][i+k]&255)-(pixels[1][i+k]&255));error+=d;max=Math.max(max,d);}if(max>2)mismatch++;}}
   boolean pass=expected>50&&missing+extra<=2&&mismatch<=Math.max(4,common*.005);if(!pass)failures++;
   reports.add(String.format(Locale.ROOT,"%s\t%s\t%d\t%d\t%d\t%d\t%d\t%.6f\t%s\t%s",id,pass,actual,expected,missing,extra,mismatch,error/(double)Math.max(1,common*3),hash(pixels[0]),hash(pixels[1])));
   if(!pass||id.contains("-t0-")||id.contains("-t4-")){save(Path.of(a[14],"actual-render.png"),pixels[0]);save(Path.of(a[14],"expected-render.png"),pixels[1]);}
   for(int j=0;j<2;j++){glDeleteTextures(ts[j]);glDeleteVertexArrays(ms[j][0]);glDeleteBuffers(ms[j][1]);glDeleteBuffers(ms[j][2]);}for(int u:ubos)glDeleteBuffers(u);ubos.clear();n++;
  }
  Files.write(root.resolve("results.tsv"),reports);Files.writeString(root.resolve("runtime.txt"),"UTC "+java.time.Instant.now()+"\n"+gpu+"\nCases="+n+" failed="+failures+"\nStatic source-RGBA frame oracle; hidden GL only, not Minecraft gameplay.\n");System.out.println("Cases="+n+" failed="+failures);GLFW.glfwDestroyWindow(win);GLFW.glfwTerminate();if(failures>0)System.exit(1);
 }
}
