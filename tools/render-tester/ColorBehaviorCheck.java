import java.nio.*;
import java.nio.file.*;
import java.util.*;
import java.security.MessageDigest;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import org.lwjgl.BufferUtils;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL;
import static org.lwjgl.opengl.GL33C.*;
import static org.lwjgl.util.shaderc.Shaderc.*;

// Hidden-context behavioral observations. Baseline parity is not a correctness oracle.
// Compile alongside CurrentShaderMatrix.java and WindowsRasterCheck.java.
public class ColorBehaviorCheck extends WindowsRasterCheck {
 static final int S=128;
 static byte[] render(int p,int tex,int[] mesh,int[] rgb){glUseProgram(p);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,tex);glBindVertexArray(mesh[0]);glVertexAttrib4f(1,rgb[0]/255f,rgb[1]/255f,rgb[2]/255f,1);glClearColor(0,0,0,0);glClearDepth(armor?0:1);glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);glDrawElements(GL_TRIANGLES,mesh[3],GL_UNSIGNED_INT,0L);ByteBuffer b=BufferUtils.createByteBuffer(S*S*4);glReadPixels(0,0,S,S,GL_RGBA,GL_UNSIGNED_BYTE,b);byte[] bytes=new byte[b.remaining()];b.get(bytes);if(glGetError()!=0)throw new IllegalStateException("GL draw error");return bytes;}
 static String hash(byte[] data)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));}
 static String stats(byte[] image){long[] sums=new long[3];int n=0;long sx=0,sy=0;int minx=S,miny=S,maxx=-1,maxy=-1;for(int y=0;y<S;y++)for(int x=0;x<S;x++){int i=(y*S+x)*4;if((image[i+3]&255)==0)continue;n++;sx+=x;sy+=y;minx=Math.min(minx,x);miny=Math.min(miny,y);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y);for(int k=0;k<3;k++)sums[k]+=image[i+k]&255;}return String.format(Locale.ROOT,"%d\t%.5f,%.5f,%.5f\t%.5f,%.5f\t%d,%d,%d,%d",n,sums[0]/(double)Math.max(1,n),sums[1]/(double)Math.max(1,n),sums[2]/(double)Math.max(1,n),sx/(double)Math.max(1,n),sy/(double)Math.max(1,n),minx,miny,maxx,maxy);}
 static void save(Path file,byte[] rgba)throws Exception{BufferedImage im=new BufferedImage(S,S,BufferedImage.TYPE_INT_ARGB);for(int y=0;y<S;y++)for(int x=0;x<S;x++){int i=(y*S+x)*4;im.setRGB(x,S-1-y,((rgba[i+3]&255)<<24)|((rgba[i]&255)<<16)|((rgba[i+1]&255)<<8)|(rgba[i+2]&255));}ImageIO.write(im,"png",file.toFile());}
 static void bind(int p,float time){uniforms(p,time);block(p,"Lighting",2,new float[]{0,0,1,0,0,0,1,0});float[] terrain=new float[20];float[] mv=ident();mv[14]=-3;System.arraycopy(mv,0,terrain,0,16);block(p,"TerrainUniform",5,terrain);block(p,"ChunkSection",6,new float[]{0,0,0,1});}
 public static void main(String[] args)throws Exception{
  Path root=Path.of(args[0]);if(!GLFW.glfwInit())throw new Exception("GLFW init");GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE,GLFW.GLFW_FALSE);GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MAJOR,4);GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MINOR,6);GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_PROFILE,GLFW.GLFW_OPENGL_CORE_PROFILE);long win=GLFW.glfwCreateWindow(S,S,"obj3 color behavior test",0,0);if(win==0)throw new Exception("GLFW window");GLFW.glfwMakeContextCurrent(win);GL.createCapabilities();String gpu=glGetString(GL_RENDERER)+" | "+glGetString(GL_VERSION);System.out.println(gpu);
  Map<String,int[]> programs=new HashMap<>();for(String pipeline:new String[]{"item","entity","block","terrain"}){Path dir=root.resolve(pipeline);int current=program(translated(dir.resolve("current.vert"),shaderc_vertex_shader),translated(dir.resolve("current.frag"),shaderc_fragment_shader));int baseline=program(Files.readString(dir.resolve("baseline.vert")),Files.readString(dir.resolve("baseline.frag")));programs.put(pipeline,new int[]{current,baseline});}
  int target=glGenFramebuffers();glBindFramebuffer(GL_FRAMEBUFFER,target);int color=glGenTextures();glBindTexture(GL_TEXTURE_2D,color);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,S,S,0,GL_RGBA,GL_UNSIGNED_BYTE,(ByteBuffer)null);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,color,0);int depth=glGenRenderbuffers();glBindRenderbuffer(GL_RENDERBUFFER,depth);glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH_COMPONENT24,S,S);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_RENDERBUFFER,depth);if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE)throw new Exception("FBO incomplete");glViewport(0,0,S,S);glEnable(GL_DEPTH_TEST);glDisable(GL_CULL_FACE);glDisable(GL_BLEND);glDisable(GL_DITHER);
  Path itemFile=root.resolve("item-carrier.f32"),armorFile=root.resolve("armor-carrier.f32");int[] itemMesh=geometry(itemFile,(int)Files.size(itemFile)/20,0,5),armorMesh=geometry(armorFile,(int)Files.size(armorFile)/32,0,8);
  List<String> lines=new ArrayList<>();lines.add("id\tcurrentPixels\tcurrentRGB\tcurrentCentroid\tcurrentBounds\tbaselinePixels\tbaselineRGB\tbaselineCentroid\tbaselineBounds\tdifferentPixels\tmaxChannelError\tcurrentSHA256\tbaselineSHA256");int n=0,changed=0;
  for(String line:Files.readAllLines(root.resolve("cases.tsv"))){String[] a=line.split("\t");String id=a[0],pipeline=a[1];armor=pipeline.equals("armor");glDepthFunc(armor?GL_GREATER:GL_LESS);int[] ps=programs.get(armor?"entity":pipeline),mesh=armor?armorMesh:itemMesh;int tex=texture(root.resolve(a[2]),Integer.parseInt(a[3]),Integer.parseInt(a[4]));int[] rgb=Arrays.stream(a[5].split(",")).mapToInt(Integer::parseInt).toArray();float time=Float.parseFloat(a[7]);bind(ps[0],time);byte[] current=render(ps[0],tex,mesh,rgb);bind(ps[1],time);byte[] baseline=render(ps[1],tex,mesh,rgb);int diff=0,max=0;for(int i=0;i<current.length;i+=4){int d=0;for(int k=0;k<4;k++)d=Math.max(d,Math.abs((current[i+k]&255)-(baseline[i+k]&255)));if(d>0)diff++;max=Math.max(max,d);}if(diff>0)changed++;
   lines.add(id+'\t'+stats(current)+'\t'+stats(baseline)+'\t'+diff+'\t'+max+'\t'+hash(current)+'\t'+hash(baseline));if(id.matches(".*-(000|333|444|300|400)-(rgb|zero)-(lit|fullbright)")){Path pics=root.resolve("images");Files.createDirectories(pics);save(pics.resolve(id+"-current.png"),current);save(pics.resolve(id+"-baseline.png"),baseline);}glDeleteTextures(tex);for(int u:ubos)glDeleteBuffers(u);ubos.clear();n++;
  }
  Files.write(root.resolve("results.tsv"),lines);Files.writeString(root.resolve("runtime.txt"),"UTC "+java.time.Instant.now()+"\n"+gpu+"\nCases="+n+" baselineDifferences="+changed+"\nSynthetic color behavior observations; no Computer Use, gameplay, FPS or other-GPU guarantee.\n");System.out.println("Cases="+n+" baselineDifferences="+changed);GLFW.glfwDestroyWindow(win);GLFW.glfwTerminate();
 }
}
