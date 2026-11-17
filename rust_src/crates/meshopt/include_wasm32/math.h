#pragma once

#define sqrtf(f) __builtin_sqrtf(f)
#define fabsf(f) __builtin_fabsf(f)

/* wasm32 freestanding additions for meshoptimizer v1.1 sources
   (quantization.cpp / opacitymap.cpp). floor/ceil lower to native wasm
   instructions; frexpf/ldexpf are tiny bit-twiddling implementations. */
#define floorf(f) __builtin_floorf(f)
#define ceilf(f) __builtin_ceilf(f)

static inline float ldexpf(float x, int e) {
    /* scale by 2^e via exponent bits, in two steps so |e| up to ~254 works */
    union { unsigned u; float f; } s1, s2;
    int h = e / 2;
    s1.u = (unsigned)(127 + h) << 23;
    s2.u = (unsigned)(127 + (e - h)) << 23;
    return x * s1.f * s2.f;
}

static inline float frexpf(float x, int* e) {
    union { unsigned u; float f; } v;
    v.f = x;
    int exp = (int)((v.u >> 23) & 0xff);
    if (exp == 0) { /* zero or subnormal: normalize via 2^24 */
        if (v.f == 0.f) { *e = 0; return x; }
        v.f = x * 16777216.f; /* 2^24 */
        exp = (int)((v.u >> 23) & 0xff) - 24;
    }
    *e = exp - 126;
    v.u = (v.u & 0x807fffffu) | (126u << 23);
    return v.f;
}

static inline float log2f(float x) {
    /* exponent + minimax-ish quadratic on the mantissa; only used by the
       opacity-map mip selection, so ~1e-3 accuracy is plenty */
    int e;
    float m = frexpf(x, &e); /* m in [0.5, 1) */
    float t = m * 2.f - 1.f; /* [0,1) */
    float l = t * (1.4426950f + t * (-0.7181451f + t * 0.4254006f));
    return (float)(e - 1) + l;
}
