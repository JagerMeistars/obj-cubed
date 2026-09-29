import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.client.model.animal.equine.*;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.builders.*;
import net.minecraft.client.renderer.entity.state.EquineRenderState;
import org.joml.*;

/** CPU-only native model poses. Reference positions use the captured body matrix. */
public class HorseNativeFixtures {
 static JsonArray arr(float... a){var j=new JsonArray();for(float x:a)j.add(x);return j;}
 public static void main(String[] args)throws Exception{
  SharedConstants.tryDetectVersion();Bootstrap.bootStrap();var all=new JsonArray();
  for(String kind:List.of("horse_body","horse_saddle"))for(String pose:List.of("rest","walk","graze","rear","feeding","rotated","small","large","reflected")){
   var layer=kind.equals("horse_body")?LayerDefinition.create(AbstractEquineModel.createBodyMesh(new CubeDeformation(.1f)),64,64).apply(MeshTransformer.scaling(1.1f)):EquineSaddleModel.createSaddleLayer().apply(MeshTransformer.scaling(1.1f));
   ModelPart root=layer.bakeRoot();var state=new EquineRenderState();state.scale=1;state.ageScale=1;state.ageInTicks=17.25f;
   state.walkAnimationPos=pose.equals("walk")?1.4f:.0f;state.walkAnimationSpeed=pose.equals("walk")?.8f:0;
   state.eatAnimation=pose.equals("graze")?.85f:0;state.standAnimation=pose.equals("rear")?.9f:0;state.feedingAnimation=pose.equals("feeding")?.65f:0;state.isRidden=true;state.animateTail=true;state.yRot=17;state.xRot=-11;
   if(kind.equals("horse_body"))new HorseModel(root).setupAnim(state);else new EquineSaddleModel(root).setupAnim(state);
   PoseStack stack=new PoseStack();
   if(pose.equals("rotated")){stack.translate(.2f,-.2f,.1f);stack.mulPose(new Matrix4f().rotationXYZ(.23f,.41f,-.18f));}
   float scale=pose.equals("small")?.65f:pose.equals("large")?1.7f:1;if(pose.equals("reflected"))stack.scale(-1,1,1);else stack.scale(scale,scale,scale);
   var item=new JsonObject();item.addProperty("kind",kind);item.addProperty("pose",pose);var mesh=new JsonArray();var parts=new JsonArray();
   root.visit(stack,(entry,name,index,cube)->{
    if(name.equals("/body")&&index==0){float[] matrix=new float[16];entry.pose().get(matrix);item.add("bodyMatrix",arr(matrix));}
    var part=new JsonObject();part.addProperty("name",name);part.addProperty("cube",index);part.addProperty("firstVertex",mesh.size()/8);parts.add(part);
    for(var polygon:cube.polygons){Vector3f n=entry.transformNormal(polygon.normal(),new Vector3f()).normalize();for(var v:polygon.vertices()){
     Vector3f p=entry.pose().transformPosition(v.x()/16,v.y()/16,v.z()/16,new Vector3f());for(float value:new float[]{p.x,p.y,p.z,v.u(),v.v(),n.x,n.y,n.z})mesh.add(value);
    }}
   });
   if(!item.has("bodyMatrix"))throw new IllegalStateException("Missing body matrix");item.add("vertices",mesh);item.add("parts",parts);all.add(item);
  }
  var result=new JsonObject();result.addProperty("generatedAt",java.time.Instant.now().toString());result.addProperty("method","Actual 26.3 baked HorseModel / EquineSaddleModel setupAnim, ModelPart.visit, PoseStack matrices. Full native mesh includes non-body quads. No world, GPU, UI.");result.add("poses",all);Files.writeString(Path.of(args[0]),new GsonBuilder().setPrettyPrinting().create().toJson(result));System.out.println("Native poses="+all.size());
 }
}
