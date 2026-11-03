uniform float lw_width;
uniform float lw_height;
uniform float lw_padding;
uniform float lw_strength;
uniform float lw_opacity;

vec4 lw_glass(sampler2D background, vec2 uv) {
    vec2 size = vec2(lw_width, lw_height);
    vec2 halfCard = size * 0.5 - vec2(lw_padding);
    vec2 p = uv * size - size * 0.5;
    float radius = min(28.0, min(halfCard.x, halfCard.y));
    vec2 q = abs(p) - halfCard + vec2(radius);
    float distance = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - radius;
    float coverage = 1.0 - smoothstep(-0.65, 0.65, distance);
    vec2 normal = normalize(max(q, vec2(0.0)) + vec2(0.0001)) * sign(p);
    float lens = pow(clamp(1.0 + distance / 26.0, 0.0, 1.0), 2.0);
    vec2 refracted = uv + normal * lw_strength * lens / size;
    vec2 blur = vec2(1.5) / size;
    vec3 color = texture2D(background, refracted).rgb * 0.4;
    color += texture2D(background, refracted + vec2(blur.x, blur.y)).rgb * 0.15;
    color += texture2D(background, refracted + vec2(-blur.x, blur.y)).rgb * 0.15;
    color += texture2D(background, refracted + vec2(blur.x, -blur.y)).rgb * 0.15;
    color += texture2D(background, refracted - blur).rgb * 0.15;
    color = mix(color, vec3(0.92, 0.96, 1.0), 0.10);
    float rim = (1.0 - smoothstep(0.3, 1.9, abs(distance))) *
                (0.12 + 0.36 * max(dot(normal, normalize(vec2(-0.5, -1.0))), 0.0));
    color += vec3(rim);
    float alpha = coverage * lw_opacity;
    return vec4(color * alpha, alpha);
}
