import java.nio.*;
import java.nio.file.*;
import java.util.*;
import org.lwjgl.PointerBuffer;
import org.lwjgl.system.MemoryStack;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL;
import static org.lwjgl.opengl.GL33C.*;
import static org.lwjgl.util.shaderc.Shaderc.*;
import static org.lwjgl.util.spvc.Spvc.*;

// Exact Minecraft 26.3 ShaderC target/options and bundled SPIRV-Cross 3.4.3.
// Hidden GLFW context only; does not launch or interact with Minecraft.
public class CurrentShaderMatrix {
 static int compiled=0,translated=0,linked=0,failed=0;
 static List<String> failures=new ArrayList<>();
 static void check(long context,int code){if(code!=SPVC_SUCCESS)throw new IllegalStateException(code+": "+spvc_context_get_last_error_string(context));}
 static String translate(ByteBuffer spirv)throws Exception{
  long context=0;
  try(MemoryStack stack=MemoryStack.stackPush()){
   PointerBuffer ptr=stack.mallocPointer(1);check(context,spvc_context_create(ptr));context=ptr.get(0);
   check(context,spvc_context_parse_spirv(context,spirv.order(ByteOrder.LITTLE_ENDIAN).asIntBuffer(),spirv.remaining()/4,ptr));
   check(context,spvc_context_create_compiler(context,SPVC_BACKEND_GLSL,ptr.get(0),SPVC_CAPTURE_MODE_COPY,ptr));long compiler=ptr.get(0);
   check(context,spvc_compiler_create_compiler_options(compiler,ptr));long options=ptr.get(0);
   check(context,spvc_compiler_options_set_uint(options,SPVC_COMPILER_OPTION_GLSL_VERSION,330));
   check(context,spvc_compiler_options_set_bool(options,SPVC_COMPILER_OPTION_GLSL_ENABLE_420PACK_EXTENSION,false));
   check(context,spvc_compiler_options_set_bool(options,SPVC_COMPILER_OPTION_GLSL_EMIT_PUSH_CONSTANT_AS_UNIFORM_BUFFER,true));
   check(context,spvc_compiler_options_set_bool(options,SPVC_COMPILER_OPTION_GLSL_SUPPORT_NONZERO_BASE_INSTANCE,true));
   check(context,spvc_compiler_options_set_bool(options,SPVC_COMPILER_OPTION_FORCE_ZERO_INITIALIZED_VARIABLES,true));
   check(context,spvc_compiler_options_set_bool(options,SPVC_COMPILER_OPTION_FLATTEN_MULTIDIMENSIONAL_ARRAYS,true));
   check(context,spvc_compiler_install_compiler_options(compiler,options));check(context,spvc_compiler_compile(compiler,ptr));return ptr.getStringUTF8(0);
  }finally{if(context!=0)spvc_context_destroy(context);}
 }
 static int driverShader(int stage,String src)throws Exception{
  int shader=glCreateShader(stage);glShaderSource(shader,src);glCompileShader(shader);
  if(glGetShaderi(shader,GL_COMPILE_STATUS)==0){String error=glGetShaderInfoLog(shader);glDeleteShader(shader);throw new IllegalStateException(error);}return shader;
 }
 static void failure(String name,String stage,String reason){failed++;failures.add(name+" | "+stage+" | "+reason.replace('\n',' '));System.out.println("FAIL "+name+" "+stage+" "+reason);}
 public static void main(String[] args)throws Exception{
  if(!GLFW.glfwInit())throw new IllegalStateException("GLFW init failed");
  GLFW.glfwWindowHint(GLFW.GLFW_VISIBLE,GLFW.GLFW_FALSE);GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MAJOR,3);GLFW.glfwWindowHint(GLFW.GLFW_CONTEXT_VERSION_MINOR,3);GLFW.glfwWindowHint(GLFW.GLFW_OPENGL_PROFILE,GLFW.GLFW_OPENGL_CORE_PROFILE);
  long window=GLFW.glfwCreateWindow(32,32,"obj3 hidden shader validation",0,0);if(window==0)throw new IllegalStateException("GL context failed");
  GLFW.glfwMakeContextCurrent(window);GL.createCapabilities();
  System.out.println("GL renderer: "+glGetString(GL_RENDERER));System.out.println("GL version: "+glGetString(GL_VERSION));System.out.println("SPIRV-Cross: "+spvc_get_commit_revision_and_timestamp());
  long compiler=shaderc_compiler_initialize(),options=shaderc_compile_options_initialize();
  shaderc_compile_options_set_target_env(options,shaderc_target_env_vulkan,shaderc_env_version_vulkan_1_2);
  shaderc_compile_options_set_auto_bind_uniforms(options,true);shaderc_compile_options_set_preserve_bindings(options,false);
  shaderc_compile_options_set_generate_debug_info(options);shaderc_compile_options_set_optimization_level(options,shaderc_optimization_level_zero);
  shaderc_compile_options_add_macro_definition(options,"RENDERPEARL_INSTANCE_INDEX_INCLUDES_BASE_INSTANCE","");
  List<String> reports=new ArrayList<>();String lastVariant="";int vc=0,vt=0,vl=0,vf=0;
  for(String directory:Files.readAllLines(Path.of(args[0]))){
   Path p=Path.of(directory);String name=p.getParent().getFileName()+"/"+p.getFileName(),variant=p.getParent().getFileName().toString();
   if(!variant.equals(lastVariant)){if(!lastVariant.isEmpty()){String s="VARIANT "+lastVariant+" compiled="+(compiled-vc)+" translated="+(translated-vt)+" linked="+(linked-vl)+" failures="+(failed-vf);reports.add(s);System.out.println(s);}lastVariant=variant;vc=compiled;vt=translated;vl=linked;vf=failed;}
   String[] gl=new String[2];
   for(int stage=0;stage<2;stage++){
    String extension=stage==0?"vert":"frag",source=Files.readString(p.resolve("shader."+extension));
    long result=shaderc_compile_into_spv(compiler,source,stage==0?shaderc_vertex_shader:shaderc_fragment_shader,name+"."+extension,"main",options);
    try{
     if(shaderc_result_get_compilation_status(result)!=shaderc_compilation_status_success){failure(name,"shaderc-"+extension,shaderc_result_get_error_message(result));continue;}
     compiled++;ByteBuffer data=shaderc_result_get_bytes(result);byte[] bytes=new byte[data.remaining()];data.duplicate().get(bytes);Files.write(p.resolve("shader."+extension+".spv"),bytes);
     try{gl[stage]=translate(data);Files.writeString(p.resolve("shader."+extension+".glsl"),gl[stage]);translated++;}catch(Exception e){failure(name,"spvc-"+extension,e.toString());}
    }finally{shaderc_result_release(result);}
   }
   if(gl[0]!=null&&gl[1]!=null){int v=0,f=0,program=0;try{v=driverShader(GL_VERTEX_SHADER,gl[0]);f=driverShader(GL_FRAGMENT_SHADER,gl[1]);program=glCreateProgram();glAttachShader(program,v);glAttachShader(program,f);glLinkProgram(program);if(glGetProgrami(program,GL_LINK_STATUS)==0)throw new IllegalStateException(glGetProgramInfoLog(program));linked++;}catch(Exception e){failure(name,"driver-link",e.toString());}finally{if(program!=0)glDeleteProgram(program);if(v!=0)glDeleteShader(v);if(f!=0)glDeleteShader(f);}}
   if((linked+failed)%10==0)System.out.println("Progress "+name+" compiled="+compiled+" translated="+translated+" linked="+linked+" failures="+failed);
  }
  String s="VARIANT "+lastVariant+" compiled="+(compiled-vc)+" translated="+(translated-vt)+" linked="+(linked-vl)+" failures="+(failed-vf);reports.add(s);System.out.println(s);
  String summary="RESULT compiled="+compiled+" translated="+translated+" linked="+linked+" failures="+failed;reports.add(summary);System.out.println(summary);
  Files.write(Path.of(args[1]),reports);Files.write(Path.of(args[1]+".failures.txt"),failures);
  shaderc_compile_options_release(options);shaderc_compiler_release(compiler);GLFW.glfwDestroyWindow(window);GLFW.glfwTerminate();if(failed>0)System.exit(1);
 }
}
