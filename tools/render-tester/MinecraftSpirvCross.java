// Reproduce Minecraft 26.3's OpenGL translation with its exact LWJGL 3.4.3
// libraries. Put lwjgl, lwjgl-spvc and their platform natives JARs on the classpath.
// Usage: MinecraftSpirvCross input.spv output.glsl
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import org.lwjgl.PointerBuffer;
import org.lwjgl.system.MemoryStack;
import org.lwjgl.system.MemoryUtil;
import static org.lwjgl.util.spvc.Spvc.*;

public final class MinecraftSpirvCross {
    private static long context;

    private static void check(int code) {
        if (code != SPVC_SUCCESS) {
            throw new IllegalStateException(code + ": " + spvc_context_get_last_error_string(context));
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Expected input.spv output.glsl");
        ByteBuffer buffer = null;
        try (MemoryStack stack = MemoryStack.stackPush()) {
            System.out.println(spvc_get_commit_revision_and_timestamp());
            PointerBuffer pointer = stack.mallocPointer(1);
            check(spvc_context_create(pointer));
            context = pointer.get(0);
            byte[] bytes = Files.readAllBytes(Path.of(args[0]));
            if (bytes.length % 4 != 0) throw new IllegalArgumentException("SPIR-V size must be a multiple of four");
            buffer = MemoryUtil.memAlloc(bytes.length).order(ByteOrder.LITTLE_ENDIAN);
            buffer.put(bytes).flip();
            check(spvc_context_parse_spirv(context, buffer.asIntBuffer(), bytes.length / 4, pointer));
            check(spvc_context_create_compiler(context, SPVC_BACKEND_GLSL, pointer.get(0), SPVC_CAPTURE_MODE_COPY, pointer));
            long compiler = pointer.get(0);
            check(spvc_compiler_create_compiler_options(compiler, pointer));
            long options = pointer.get(0);
            check(spvc_compiler_options_set_uint(options, SPVC_COMPILER_OPTION_GLSL_VERSION, 330));
            check(spvc_compiler_options_set_bool(options, SPVC_COMPILER_OPTION_GLSL_ENABLE_420PACK_EXTENSION, false));
            check(spvc_compiler_options_set_bool(options, SPVC_COMPILER_OPTION_GLSL_EMIT_PUSH_CONSTANT_AS_UNIFORM_BUFFER, true));
            check(spvc_compiler_options_set_bool(options, SPVC_COMPILER_OPTION_GLSL_SUPPORT_NONZERO_BASE_INSTANCE, true));
            check(spvc_compiler_options_set_bool(options, SPVC_COMPILER_OPTION_FORCE_ZERO_INITIALIZED_VARIABLES, true));
            check(spvc_compiler_options_set_bool(options, SPVC_COMPILER_OPTION_FLATTEN_MULTIDIMENSIONAL_ARRAYS, true));
            check(spvc_compiler_install_compiler_options(compiler, options));
            check(spvc_compiler_compile(compiler, pointer));
            Files.writeString(Path.of(args[1]), pointer.getStringUTF8(0));
            System.out.println("Translated " + args[0]);
        } finally {
            if (buffer != null) MemoryUtil.memFree(buffer);
            if (context != 0) spvc_context_destroy(context);
        }
    }
}
