uniform float lw_width;
uniform float lw_height;
uniform float lw_padding;
uniform float lw_strength;
uniform float lw_opacity;
uniform float lw_tint;
uniform float lw_dark;

vec3 lw_linear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 lw_srgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
               step(vec3(0.0031308), c));
}
vec3 lw_material(vec3 color) {
    float density = clamp((lw_tint - 0.05) / 0.75, 0.0, 1.0);
    // Retain wallpaper hue; lift dark backgrounds for dark text, and limit
    // bright backgrounds for light text. Blur alone cannot fix white-on-white.
    color = mix(color, vec3(lw_dark > 0.5 ? 0.16 : 0.96), 0.025 + density * 0.10);
    vec3 linear = lw_linear(clamp(color, 0.0, 1.0));
    float luma = dot(linear, vec3(0.2126, 0.7152, 0.0722));
    float low = lw_dark > 0.5 ? 0.018 : 0.50 + density * 0.12;
    float high = lw_dark > 0.5 ? 0.125 - density * 0.035 : 0.95;
    if (luma > high) linear *= high / max(luma, 0.0001);
    if (luma < low) linear = mix(linear, vec3(1.0), (low - luma) / max(1.0 - luma, 0.0001));
    return lw_srgb(linear);
}
vec4 lw_glass(sampler2D background, vec2 uv) {
    vec2 size = vec2(lw_width, lw_height);
    vec2 halfCard = size * 0.5 - vec2(lw_padding);
    vec2 p = uv * size - size * 0.5;
    float radius = min(28.0, min(halfCard.x, halfCard.y));
    vec2 q = abs(p) - halfCard + vec2(radius);
    float distance = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - radius;
    float coverage = 1.0 - smoothstep(-0.65, 0.65, distance);
    vec2 outward = q.x > q.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
    if (q.x > 0.0 && q.y > 0.0) outward = normalize(q) * sign(p);

    // A flat center with a rounded 20px bevel. The bounded slope keeps the
    // grazing edge finite; this is a single-boundary screen-space lens.
    float t = clamp(-distance / 20.0, 0.0, 1.0);
    float slope = 0.65 * (1.0 - t) / sqrt(max(0.01, 1.0 - (1.0 - t) * (1.0 - t)));
    vec3 normal = normalize(vec3(outward * slope, 1.0));
    vec3 ray = refract(vec3(0.0, 0.0, -1.0), normal, 1.0 / 1.45);
    vec2 offset = ray.xy / max(-ray.z, 0.2) * lw_strength;
    offset *= min(1.0, 20.0 / max(length(offset), 0.0001));
    vec2 refracted = uv + offset / size;
    vec3 color = texture2D(cogl_sampler1, refracted).rgb;
    // A trace of the original at the rim makes the lens readable without
    // bringing fine wallpaper detail back into the content area.
    float edge = 1.0 - smoothstep(0.0, 5.0, -distance);
    color = mix(color, texture2D(background, refracted).rgb, edge * 0.08);
    color = lw_material(color);

    float facing = dot(outward, normalize(vec2(-0.65, -1.0)));
    float rim = 1.0 - smoothstep(0.25, 1.35, abs(distance));
    float fresnel = pow(1.0 - normal.z, 3.0);
    float highlight = rim * (0.075 + 0.27 * max(facing, 0.0) + 0.10 * max(-facing, 0.0)) + fresnel * edge * 0.035;
    color = mix(color, vec3(1.0), highlight);
    color *= 1.0 - (1.0 - smoothstep(0.0, 3.0, -distance)) * max(-facing, 0.0) * 0.07;

    float shadow = exp(-pow(max(distance, 0.0) / 3.5, 2.0)) * 0.10 * (1.0 - coverage);
    float alpha = (coverage + shadow) * lw_opacity;
    return vec4(color * coverage * lw_opacity, alpha);
}
