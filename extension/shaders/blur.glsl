uniform float lw_step_x;
uniform float lw_step_y;
uniform float lw_sigma;

// Separable Gaussian in input texels. Widening the blur adds samples instead
// of leaving holes. Read every tap: the downsampled output can lie between
// input texel centers, where paired-tap offsets would no longer be exact.
vec4 lw_blur(sampler2D source, vec2 uv) {
    vec2 stepSize = vec2(lw_step_x, lw_step_y);
    float radius = ceil(3.0 * lw_sigma);
    vec4 color = texture2D(source, uv);
    float total = 1.0;
    for (float tap = 1.0; tap <= radius; tap += 1.0) {
        float weight = exp(-0.5 * pow(tap / lw_sigma, 2.0));
        vec2 offset = stepSize * tap;
        color += (texture2D(source, uv + offset) + texture2D(source, uv - offset)) * weight;
        total += 2.0 * weight;
    }
    return color / total;
}
