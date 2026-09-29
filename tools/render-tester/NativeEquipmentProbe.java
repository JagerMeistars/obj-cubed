import java.nio.file.*;
import java.util.*;
import java.lang.reflect.*;
import com.google.gson.*;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.client.model.geom.*;
import net.minecraft.client.model.geom.builders.*;
import org.joml.Matrix4fc;
import org.joml.Vector3f;

/** Installed vanilla 26.3 model registry. CPU only, no world/render thread/UI. */
public class NativeEquipmentProbe {
 static Field field(Class<?> c,String name)throws Exception{Field f=c.getDeclaredField(name);f.setAccessible(true);return f;}
 static final Field CUBES,CHILDREN,MATERIAL,TEXW,TEXH;
 static{try{CUBES=field(ModelPart.class,"cubes");CHILDREN=field(ModelPart.class,"children");MATERIAL=field(LayerDefinition.class,"material");Class<?> m=Class.forName("net.minecraft.client.model.geom.builders.MaterialDefinition");TEXW=field(m,"xTexSize");TEXH=field(m,"yTexSize");}catch(Exception e){throw new RuntimeException(e);}}
 static JsonArray array(float... values){var a=new JsonArray();for(float f:values)a.add(f);return a;}
 static JsonArray matrix(Matrix4fc matrix){float[] values=new float[16];matrix.get(values);return array(values);}
 static void collect(JsonArray parts,String path,ModelPart part,PoseStack stack,int width,int height,boolean parentVisible)throws Exception{
  stack.pushPose();part.translateAndRotate(stack);var item=new JsonObject();item.addProperty("path",path);item.addProperty("visible",part.visible);item.addProperty("skipDraw",part.skipDraw);item.addProperty("effectivelyVisible",parentVisible&&part.visible&&!part.skipDraw);item.add("position",array(part.x,part.y,part.z));item.add("rotationXYZ",array(part.xRot,part.yRot,part.zRot));item.add("scale",array(part.xScale,part.yScale,part.zScale));item.add("modelMatrixColumnMajor",matrix(stack.last().pose()));PoseStack local=new PoseStack();part.translateAndRotate(local);item.add("localMatrixColumnMajor",matrix(local.last().pose()));var cubes=new JsonArray();
  for(var cube:(List<ModelPart.Cube>)CUBES.get(part)){var c=new JsonObject();c.add("bounds",array(cube.minX,cube.minY,cube.minZ,cube.maxX,cube.maxY,cube.maxZ));var faces=new JsonArray();
   for(var face:cube.polygons){var p=new JsonObject();p.add("normalLocal",array(face.normal().x(),face.normal().y(),face.normal().z()));Vector3f normal=stack.last().transformNormal(face.normal(),new Vector3f()).normalize();p.add("normalModel",array(normal.x,normal.y,normal.z));var vertices=new JsonArray();var posed=new JsonArray();float u0=Float.POSITIVE_INFINITY,v0=u0,u1=Float.NEGATIVE_INFINITY,v1=u1;
    for(var v:face.vertices()){float u=v.u()*width,t=v.v()*height;vertices.add(array(v.x(),v.y(),v.z(),u,t));Vector3f pos=stack.last().pose().transformPosition(v.x()/16,v.y()/16,v.z()/16,new Vector3f());posed.add(array(pos.x,pos.y,pos.z,v.u(),v.v()));u0=Math.min(u0,u);v0=Math.min(v0,t);u1=Math.max(u1,u);v1=Math.max(v1,t);}
    p.add("uvRectPixels",array(u0,v0,u1,v1));p.add("verticesLocalPixelsUVPixels",vertices);p.add("verticesModelBlocksUVNormalized",posed);faces.add(p);
   }c.add("faces",faces);cubes.add(c);
  }item.add("cubes",cubes);parts.add(item);for(var child:((Map<String,ModelPart>)CHILDREN.get(part)).entrySet())collect(parts,path+"/"+child.getKey(),child.getValue(),stack,width,height,parentVisible&&part.visible);stack.popPose();
 }
 static void set(Object state,JsonObject assigned,String name,Object value)throws Exception{try{Field f=state.getClass().getField(name);if(value instanceof Boolean b)f.setBoolean(state,b);else f.setFloat(state,((Number)value).floatValue());if(value instanceof Boolean b)assigned.addProperty(name,b);else assigned.addProperty(name,((Number)value).floatValue());}catch(NoSuchFieldException ignored){}}
 public static void main(String[] args)throws Exception{
  SharedConstants.tryDetectVersion();Bootstrap.bootStrap();var registry=LayerDefinitions.createRoots();
  String[][] specs={
   {"HORSE_ARMOR","animal.equine.HorseModel","EquineRenderState"},{"HORSE_SADDLE","animal.equine.EquineSaddleModel","EquineRenderState"},
   {"UNDEAD_HORSE_ARMOR","animal.equine.HorseModel","EquineRenderState"},{"SKELETON_HORSE_SADDLE","animal.equine.EquineSaddleModel","EquineRenderState"},{"ZOMBIE_HORSE_SADDLE","animal.equine.EquineSaddleModel","EquineRenderState"},
   {"DONKEY_SADDLE","animal.equine.EquineSaddleModel","DonkeyRenderState"},{"MULE_SADDLE","animal.equine.EquineSaddleModel","DonkeyRenderState"},
   {"WOLF_ARMOR","animal.wolf.AdultWolfModel","WolfRenderState"},
   {"LLAMA_DECOR","animal.llama.LlamaModel","LlamaRenderState"},{"LLAMA_BABY_DECOR","animal.llama.BabyLlamaModel","LlamaRenderState"},
   {"HAPPY_GHAST_HARNESS","animal.ghast.HappyGhastHarnessModel","HappyGhastRenderState"},{"HAPPY_GHAST_BABY_HARNESS","animal.ghast.HappyGhastHarnessModel","HappyGhastRenderState"},
   {"ELYTRA","object.equipment.ElytraModel","HumanoidRenderState"},{"ELYTRA_BABY","object.equipment.ElytraModel","HumanoidRenderState"},
   {"CAMEL_SADDLE","animal.camel.CamelSaddleModel","CamelRenderState"},{"CAMEL_HUSK_SADDLE","animal.camel.CamelSaddleModel","CamelRenderState"},
   {"PIG_SADDLE","animal.pig.PigModel","LivingEntityRenderState"},{"STRIDER_SADDLE","monster.strider.AdultStriderModel","StriderRenderState"},
   {"NAUTILUS_ARMOR","animal.nautilus.NautilusArmorModel","NautilusRenderState"},{"NAUTILUS_SADDLE","animal.nautilus.NautilusSaddleModel","NautilusRenderState"}
  };
  var models=new JsonArray();
  for(var spec:specs){ModelLayerLocation key=(ModelLayerLocation)ModelLayers.class.getField(spec[0]).get(null);LayerDefinition layer=registry.get(key);Object material=MATERIAL.get(layer);int width=TEXW.getInt(material),height=TEXH.getInt(material);var model=new JsonObject();model.addProperty("modelLayerConstant",spec[0]);model.addProperty("modelLayer",key.toString());model.addProperty("modelClass","net.minecraft.client.model."+spec[1]);model.addProperty("stateClass","net.minecraft.client.renderer.entity.state."+spec[2]);model.add("textureSize",array(width,height));var states=new JsonArray();
   for(String name:List.of("baked","rest","moving","action1","action2")){ModelPart root=layer.bakeRoot();var pose=new JsonObject();pose.addProperty("name",name);var assigned=new JsonObject();
    if(!name.equals("baked")){Class<?> stateType=Class.forName("net.minecraft.client.renderer.entity.state."+spec[2]);Object state=stateType.getConstructor().newInstance();set(state,assigned,"scale",1);set(state,assigned,"ageScale",1);set(state,assigned,"ageInTicks",17.25f);set(state,assigned,"elytraRotX",.2617994f);set(state,assigned,"elytraRotZ",-.2617994f);set(state,assigned,"wetShade",1);set(state,assigned,"tailAngle",.25f);
     if(!name.equals("rest")){set(state,assigned,"walkAnimationPos",1.4f);set(state,assigned,"walkAnimationSpeed",.8f);set(state,assigned,"xRot",-11);set(state,assigned,"yRot",22);set(state,assigned,"isRidden",true);set(state,assigned,"animateTail",true);}
     if(name.equals("action1")){set(state,assigned,"eatAnimation",.85f);set(state,assigned,"isSitting",true);set(state,assigned,"hasChest",true);set(state,assigned,"isCrouching",true);set(state,assigned,"elytraRotX",.6981317f);set(state,assigned,"elytraRotZ",-.7853982f);}
     if(name.equals("action2")){set(state,assigned,"standAnimation",.9f);set(state,assigned,"feedingAnimation",.5f);set(state,assigned,"shakeAnim",.6f);set(state,assigned,"headRollAngle",.2f);set(state,assigned,"isLeashHolder",true);set(state,assigned,"isFallFlying",true);set(state,assigned,"elytraRotX",.35f);set(state,assigned,"elytraRotY",.2f);set(state,assigned,"elytraRotZ",-1.1f);}
     Object instance=Class.forName("net.minecraft.client.model."+spec[1]).getConstructor(ModelPart.class).newInstance(root);
     Method setup=Arrays.stream(instance.getClass().getMethods()).filter(m->m.getName().equals("setupAnim")&&m.getParameterCount()==1&&m.getParameterTypes()[0]!=Object.class&&m.getParameterTypes()[0].isAssignableFrom(stateType)).findFirst().orElseThrow();setup.invoke(instance,state);
    }pose.add("assignedState",assigned);var parts=new JsonArray();collect(parts,"root",root,new PoseStack(),width,height,true);pose.add("parts",parts);states.add(pose);
   }model.add("states",states);models.add(model);System.out.println("Captured "+spec[0]);
  }
  var report=new JsonObject();report.addProperty("createdAt",java.time.Instant.now().toString());report.addProperty("method","Actual Minecraft26.3 LayerDefinitions.createRoots registry, baked model parts and setupAnim with explicit synthetic state fields; CPU only, no world/GPU/UI. Matrices are model-local, excluding renderer external root transforms.");report.add("models",models);Files.writeString(Path.of(args[0]),new GsonBuilder().setPrettyPrinting().create().toJson(report));
 }
}
