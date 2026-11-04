uniform float lw_step_x;
uniform float lw_step_y;

// Separable Gaussian, adjacent taps paired by linear texture sampling.
// The step is in logical pixels so fractional display scaling keeps the look.
vec4 lw_blur(sampler2D source, vec2 uv) {
    vec2 stepSize = vec2(lw_step_x, lw_step_y);
    vec4 color = texture2D(source, uv) * 0.2270270270;
    color += texture2D(source, uv + stepSize * 1.3846153846) * 0.3162162162;
    color += texture2D(source, uv - stepSize * 1.3846153846) * 0.3162162162;
    color += texture2D(source, uv + stepSize * 3.2307692308) * 0.0702702703;
    color += texture2D(source, uv - stepSize * 3.2307692308) * 0.0702702703;
    return color;
}
