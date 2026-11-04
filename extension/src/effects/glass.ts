import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import shader from '../../shaders/glass.glsl';
import blurShader from '../../shaders/blur.glsl';

// Cogl hashes snippet identity. Share programs across cards and enable cycles,
// but give every queued pass its own pipeline/uniforms and texture bindings.
let sharedGlass: Cogl.Snippet | null = null;
let sharedBlur: Cogl.Snippet | null = null;
function snippet(blur: boolean): Cogl.Snippet {
    if (blur && sharedBlur) return sharedBlur;
    if (!blur && sharedGlass) return sharedGlass;
    const result = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, blur ? blurShader : shader, null);
    result.set_replace(blur
        ? 'cogl_color_out = lw_blur(cogl_sampler0, cogl_tex_coord0_in.xy);'
        : 'cogl_color_out = lw_glass(cogl_sampler0, cogl_tex_coord0_in.xy);');
    if (blur) sharedBlur = result; else sharedGlass = result;
    return result;
}
interface Buffer {
    texture: Cogl.Texture2D;
    framebuffer: Cogl.Offscreen;
    pixelWidth: number;
    pixelHeight: number;
}
interface Target {
    source: Buffer;
    horizontal: Buffer;
    blurred: Buffer;
    copy: Cogl.Pipeline;
    horizontalPass: Cogl.Pipeline;
    verticalPass: Cogl.Pipeline;
    composite: Cogl.Pipeline;
    width: number;
    height: number;
}
function buffer(context: Cogl.Context, pixelWidth: number, pixelHeight: number, width: number, height: number): Buffer {
    const texture = Cogl.Texture2D.new_with_size(context, pixelWidth, pixelHeight);
    texture.set_components(Cogl.TextureComponents.RGBA);
    texture.allocate();
    const framebuffer = Cogl.Offscreen.new_with_texture(texture);
    framebuffer.allocate();
    framebuffer.set_viewport(0, 0, pixelWidth, pixelHeight);
    framebuffer.set_modelview_matrix(new Graphene.Matrix().init_identity());
    framebuffer.orthographic(0, 0, width, height, -1, 1);
    return {texture, framebuffer, pixelWidth, pixelHeight};
}
function bind(pipeline: Cogl.Pipeline, layer: number, texture: Cogl.Texture2D): void {
    pipeline.set_layer_texture(layer, texture);
    pipeline.set_layer_filters(layer, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
    pipeline.set_layer_wrap_mode(layer, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
}
function uniforms(pipeline: Cogl.Pipeline, values: Record<string, number>): void {
    for (const [name, value] of Object.entries(values))
        pipeline.set_uniform_1f(pipeline.get_uniform_location(name), value);
}
function rectangle(pipeline: Cogl.Pipeline, width: number, height: number): Clutter.PaintNode {
    const node = Clutter.PipelineNode.new(pipeline);
    const box = new Clutter.ActorBox();
    box.init(0, 0, width, height);
    node.add_rectangle(box);
    return node;
}
export const GlassEffect = GObject.registerClass({GTypeName:'LiquidWidgetsGlassEffect50',Signals:{failed:{}}}, class GlassEffect extends Clutter.Effect {
    failed = false;
    private target: Target | null = null;
    private dirty = true;
    private strength = 16;
    private tint = .24;
    private dark = true;
    // Maximum 20px refraction + 13px blur support + filtering/AA headroom.
    readonly padding = 40;
    inputPaints = 0;
    blurPaints = 0;
    outputPaints = 0;
    setStrength(value: number): void {
        const strength = Math.max(0, Math.min(20, Number.isFinite(value) ? value : 0));
        if (strength === this.strength) return;
        this.strength = strength;
        this.queue_repaint();
    }
    setMaterial(opacity: number, dark: boolean): void {
        const tint = Math.max(.05, Math.min(.8, Number.isFinite(opacity) ? opacity : .24));
        if (tint === this.tint && dark === this.dark) return;
        this.tint = tint; this.dark = dark;
        this.queue_repaint();
    }
    invalidate(): void { this.dirty = true; this.queue_repaint(); }
    release(): void { this.target = null; this.dirty = true; }
    get textureBytes(): number {
        return this.target ? [this.target.source, this.target.horizontal, this.target.blurred]
            .reduce((sum, item) => sum + item.pixelWidth * item.pixelHeight * 4, 0) : 0;
    }
    private ensureTarget(context: Cogl.Context, width: number, height: number, scale: number): Target {
        const pixelWidth = Math.max(1, Math.ceil(width * scale));
        const pixelHeight = Math.max(1, Math.ceil(height * scale));
        if (this.target?.source.pixelWidth === pixelWidth && this.target.source.pixelHeight === pixelHeight && this.target.width === width && this.target.height === height) return this.target;
        // Publish only a complete target set; allocation failure leaves no partial cache.
        this.target = null;
        const source = buffer(context, pixelWidth, pixelHeight, width, height);
        const halfWidth = Math.max(1, Math.ceil(pixelWidth / 2));
        const halfHeight = Math.max(1, Math.ceil(pixelHeight / 2));
        const horizontal = buffer(context, halfWidth, halfHeight, width, height);
        const blurred = buffer(context, halfWidth, halfHeight, width, height);
        const copy = Cogl.Pipeline.new(context);
        const horizontalPass = Cogl.Pipeline.new(context);
        const verticalPass = Cogl.Pipeline.new(context);
        bind(horizontalPass, 0, source.texture);
        bind(verticalPass, 0, horizontal.texture);
        horizontalPass.add_snippet(snippet(true));
        verticalPass.add_snippet(snippet(true));
        uniforms(horizontalPass, {lw_step_x: 4 / width, lw_step_y: 0});
        uniforms(verticalPass, {lw_step_x: 0, lw_step_y: 4 / height});
        const composite = Cogl.Pipeline.new(context);
        bind(composite, 0, source.texture);
        bind(composite, 1, blurred.texture);
        composite.add_snippet(snippet(false));
        this.target = {source, horizontal, blurred, copy, horizontalPass, verticalPass, composite, width, height};
        this.dirty = true;
        return this.target;
    }
    vfunc_paint(node: Clutter.PaintNode, context: Clutter.PaintContext, flags: Clutter.EffectPaintFlags): void {
        if (this.failed) return;
        const actor = this.get_actor();
        if (!actor || actor.width <= 0 || actor.height <= 0) return;
        if (flags & Clutter.EffectPaintFlags.BYPASS_EFFECT) { node.add_child(Clutter.ActorNode.new(actor,-1)); return; }
        try {
            const target = this.ensureTarget(context.get_framebuffer().get_context(), actor.width, actor.height, actor.get_resource_scale());
            if (this.dirty) {
                // These sibling nodes execute in source -> horizontal -> vertical order.
                // Layer nodes have no rectangle, so only their children write to the FBO.
                const input = Clutter.LayerNode.new_to_framebuffer(target.source.framebuffer, target.copy);
                input.add_child(Clutter.ActorNode.new(actor, 255));
                node.add_child(input);
                const horizontal = Clutter.LayerNode.new_to_framebuffer(target.horizontal.framebuffer, target.copy);
                horizontal.add_child(rectangle(target.horizontalPass, actor.width, actor.height));
                node.add_child(horizontal);
                const vertical = Clutter.LayerNode.new_to_framebuffer(target.blurred.framebuffer, target.copy);
                vertical.add_child(rectangle(target.verticalPass, actor.width, actor.height));
                node.add_child(vertical);
                this.inputPaints++;
                this.blurPaints += 2;
                this.dirty = false;
            }
            uniforms(target.composite, {lw_width:actor.width, lw_height:actor.height, lw_padding:this.padding,
                lw_strength:this.strength, lw_opacity:actor.get_paint_opacity()/255, lw_tint:this.tint, lw_dark:this.dark ? 1 : 0});
            node.add_child(rectangle(target.composite, actor.width, actor.height));
            this.outputPaints++;
        } catch {
            this.failed = true; this.release(); this.emit('failed');
            console.warn('Liquid Widgets: refraction unavailable; using translucent cards');
        }
    }
});
