import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import shader from '../../shaders/glass.glsl';

// Cogl 50 hashes snippet identity (not source): sharing avoids new cached programs
// on each card, resize and extension enable. This snippet owns no actor/context.
let sharedSnippet: Cogl.Snippet | null = null;
function glassSnippet(): Cogl.Snippet {
    if (!sharedSnippet) {
        sharedSnippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, shader, null);
        sharedSnippet.set_replace('cogl_color_out = lw_glass(cogl_sampler0, cogl_tex_coord0_in.xy);');
    }
    return sharedSnippet;
}

interface Target {
    texture: Cogl.Texture2D;
    framebuffer: Cogl.Offscreen;
    pipeline: Cogl.Pipeline;
    pixelWidth: number;
    pixelHeight: number;
    width: number;
    height: number;
}
export const GlassEffect = GObject.registerClass({GTypeName:'LiquidWidgetsGlassEffect50',Signals:{failed:{}}}, class GlassEffect extends Clutter.Effect {
    failed = false;
    private target: Target | null = null;
    private dirty = true;
    private strength = 16;
    readonly padding = 24;
    inputPaints = 0;
    outputPaints = 0;
    setStrength(value: number): void {
        this.strength = Math.max(0, Math.min(20, Number.isFinite(value) ? value : 0));
        this.queue_repaint();
    }
    invalidate(): void { this.dirty = true; this.queue_repaint(); }
    release(): void { this.target = null; this.dirty = true; }
    get textureBytes(): number { return this.target ? this.target.pixelWidth * this.target.pixelHeight * 4 : 0; }
    private ensureTarget(context: Cogl.Context, width: number, height: number, scale: number): Target {
        const pixelWidth = Math.max(1, Math.ceil(width * scale));
        const pixelHeight = Math.max(1, Math.ceil(height * scale));
        if (this.target?.pixelWidth === pixelWidth && this.target.pixelHeight === pixelHeight && this.target.width === width && this.target.height === height) return this.target;
        const texture = Cogl.Texture2D.new_with_size(context, pixelWidth, pixelHeight);
        texture.set_components(Cogl.TextureComponents.RGBA);
        texture.allocate();
        const framebuffer = Cogl.Offscreen.new_with_texture(texture);
        framebuffer.allocate();
        framebuffer.set_viewport(0, 0, pixelWidth, pixelHeight);
        framebuffer.set_modelview_matrix(new Graphene.Matrix().init_identity());
        framebuffer.orthographic(0, 0, width, height, -1, 1);
        const pipeline = Cogl.Pipeline.new(context);
        pipeline.set_layer_texture(0, texture);
        pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
        pipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
        pipeline.add_snippet(glassSnippet());
        this.target = {texture,framebuffer,pipeline,pixelWidth,pixelHeight,width,height};
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
            const layer = Clutter.LayerNode.new_to_framebuffer(target.framebuffer,target.pipeline);
            layer.add_child(Clutter.ActorNode.new(actor,255));
            node.add_child(layer);
            this.inputPaints++;
            this.dirty = false;
        }
        for (const [name,value] of Object.entries({lw_width:actor.width,lw_height:actor.height,lw_padding:this.padding,lw_strength:this.strength,lw_opacity:actor.get_paint_opacity()/255})) {
            target.pipeline.set_uniform_1f(target.pipeline.get_uniform_location(name),value);
        }
        const output = Clutter.PipelineNode.new(target.pipeline);
        const box = new Clutter.ActorBox();
        box.init(0,0,actor.width,actor.height);
        output.add_rectangle(box);
        node.add_child(output);
        this.outputPaints++;
        } catch {
            this.failed = true; this.release(); this.emit('failed');
            console.warn('Liquid Widgets: refraction unavailable; using translucent cards');
        }
    }
});
