/*
 *
 *  PIPELINE OVERVIEW (12 stages, in execution order)
 *  -------------------------------------------------
 *   1. Lanczos-3 downscale  ->  ~307200 px working canvas
 *   2. Tone curve + RGB->YIQ (BT.470/NTSC)
 *   3. Per-plane Butterworth low-pass (cutoff_y / cutoff_i / cutoff_q)
 *   4. Vertical chroma crosstalk bleed
 *   5. Horizontal chroma shift
 *   6. Unsharp mask on Y (strong-ringing)
 *   7. Per-row displacement (jitter + head-switch), then dropout paint
 *   8. Per-pixel Y/C noise
 *   9. Scanlines on odd rows
 *  10. YIQ->RGB + per-channel color cast
 *  11. JPEG encode/decode round-trip (native Canvas codec)
 *  12. Lanczos-3 upscale back to original size, RGBA out
 *
 *  KNOWN QUIRKS / GOTCHAS
 *  ------------------------------------------------------------------
 *  - YIQ: BOTH forward and inverse are standard BT.470 (verified against
 *      the binary after an initial misread that suggested R/B swap).
 *  - Chroma crosstalk bleeds TOP-DOWN (row y blends into y+1), not the
 *      reverse.
 *  - Chroma shift is gated on `> 0` (negative ignored; UI min is 0).
 */

export interface FilterParams {
    apply_jpeg: boolean
    jpeg_quality: number
    apply_sharpening: boolean
    sharpen_amount: number
    sharpen_radius: number
    tone_low: number
    tone_high: number
    cutoff_y: number
    cutoff_i: number
    cutoff_q: number
    chroma_crosstalk: number
    chroma_shift_x: number
    noise_intensity_y: number
    noise_intensity_c: number
    jitter_freq: number
    jitter_amp: number
    jitter_classic: boolean
    jitter_roughness: number
    head_switch_rows: number
    head_switch_pull: number
    head_switch_noise: number
    dropout_count: number
    dropout_max_len: number
    apply_color_cast: boolean
    cast_r: number
    cast_g: number
    cast_b: number
    apply_scanlines: boolean
    scanline_weight: number
}

/* ------------------------------------------------------------------ *
 *  Deterministic PRNG (mulberry32) + Box-Muller normal sampler
 * ------------------------------------------------------------------ */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeNormal(rand: () => number): () => number {
    let spare: number | null = null;
    return function () {
        if (spare !== null) { const v = spare; spare = null; return v; }
        let u = 0, v = 0;
        do { u = rand(); } while (u <= 1e-12);
        v = rand();
        const mag = Math.sqrt(-2.0 * Math.log(u));
        spare = mag * Math.sin(2.0 * Math.PI * v);
        return mag * Math.cos(2.0 * Math.PI * v);
    };
}

/* ------------------------------------------------------------------ *
 *  Lanczos-3 resampling (separable, normalized weights).
 *  support radius 3.0,kernel = sinc(x) * sinc(x/3).
 * ------------------------------------------------------------------ */
function lanczos3(x: number): number {
    if (x === 0) return 1;
    const ax = Math.abs(x);
    if (ax >= 3) return 0;
    const px = Math.PI * x;
    return (Math.sin(px) / px) * (Math.sin(px / 3) / (px / 3));
}

/* Resize a 3-channel float32 (RGB, 0..255) image.
 * ga = src/dst ; ia = max(ga,1) ; ha = 3*ia (Lanczos3 support in src px).
 * Per dst coord n: center ca = ga*(n+0.5) - 0.5; tap src b gets weight
 * lanczos3((b - ca)/ia), window [floor(ba-ha), ceil(ba+ha)] clamped, then
 * weights normalized by their sum. Two separable passes (H then V).
 * Kept as the reference implementation: the pipeline now calls the
 * bit-identical but much faster resizeLanczosFast below. */
export function resizeLanczos(src: Float32Array, sw: number, sh: number, dw: number, dh: number, report?: (t: number) => void): Float32Array {
    let lastQ = -1;
    const tick = (t: number) => {  // quantized to 1/20 steps so per-row calls stay cheap
        if (!report) return;
        const q = Math.floor(t * 20);
        if (q !== lastQ) { lastQ = q; report(q / 20); }
    };
    const tmp = new Float32Array(dw * sh * 3);

    // ---- horizontal pass ----
    const gaX = sw / dw;
    const iaX = Math.max(gaX, 1.0);
    const haX = 3.0 * iaX;
    for (let y = 0; y < sh; y++) {
        const srcRow = y * sw * 3;
        const tmpRow = y * dw * 3;
        for (let x = 0; x < dw; x++) {
            const ba = gaX * (x + 0.5);
            const ca = ba - 0.5;
            const start = Math.max(0, Math.floor(ba - haX));
            const end = Math.min(sw - 1, Math.ceil(ba + haX));
            let r = 0, g = 0, b = 0, wsum = 0;
            for (let sx = start; sx <= end; sx++) {
                const w = lanczos3((sx - ca) / iaX);
                if (w === 0) continue;
                const o = srcRow + sx * 3;
                r += src[o] * w; g += src[o + 1] * w; b += src[o + 2] * w;
                wsum += w;
            }
            if (wsum === 0) wsum = 1;
            const o = tmpRow + x * 3;
            tmp[o] = r / wsum; tmp[o + 1] = g / wsum; tmp[o + 2] = b / wsum;
        }
        tick((y + 1) / sh * 0.6);
    }

    // ---- vertical pass ----
    const gaY = sh / dh;
    const iaY = Math.max(gaY, 1.0);
    const haY = 3.0 * iaY;
    const dst = new Float32Array(dw * dh * 3);
    for (let y = 0; y < dh; y++) {
        const ba = gaY * (y + 0.5);
        const ca = ba - 0.5;
        const start = Math.max(0, Math.floor(ba - haY));
        const end = Math.min(sh - 1, Math.ceil(ba + haY));
        const dstRow = y * dw * 3;
        for (let x = 0; x < dw; x++) {
            let r = 0, g = 0, b = 0, wsum = 0;
            for (let sy = start; sy <= end; sy++) {
                const w = lanczos3((sy - ca) / iaY);
                if (w === 0) continue;
                const o = sy * dw * 3 + x * 3;
                r += tmp[o] * w; g += tmp[o + 1] * w; b += tmp[o + 2] * w;
                wsum += w;
            }
            if (wsum === 0) wsum = 1;
            const o = dstRow + x * 3;
            dst[o] = r / wsum; dst[o + 1] = g / wsum; dst[o + 2] = b / wsum;
        }
        tick(0.6 + (y + 1) / dh * 0.4);
    }
    return dst;
}

/* Per-line Lanczos-3 tap tables for one dimension. For each dst coord n:
 * start[n] = first source tap, count[n] = tap count, weights laid out
 * consecutively at offset[n] in ascending tap order. Exact-zero taps
 * (|t-ca|/ia >= 3) can only sit at the window edges, so trimming them
 * keeps the remaining taps contiguous — required by the tap-outer
 * vertical pass. Weights stay unnormalized f64 and wsum[n] is their sum
 * (1 when the sum is exactly 0, mirroring the per-pixel guard), so the
 * accumulate-then-divide result matches resizeLanczos bit-for-bit. */
interface LanczosLineTable {
    start: Int32Array;
    count: Int32Array;
    offset: Int32Array;
    weights: number[];
    wsum: Float64Array;
}

function buildLanczosLine(srcLen: number, dstLen: number): LanczosLineTable {
    const ga = srcLen / dstLen;
    const ia = Math.max(ga, 1.0);
    const ha = 3.0 * ia;
    const start = new Int32Array(dstLen);
    const count = new Int32Array(dstLen);
    const offset = new Int32Array(dstLen);
    const wsum = new Float64Array(dstLen);
    const weights: number[] = [];
    for (let n = 0; n < dstLen; n++) {
        const ba = ga * (n + 0.5);
        const ca = ba - 0.5;
        let s = Math.max(0, Math.floor(ba - ha));
        let e = Math.min(srcLen - 1, Math.ceil(ba + ha));
        while (s <= e && lanczos3((s - ca) / ia) === 0) s++;
        while (e >= s && lanczos3((e - ca) / ia) === 0) e--;
        offset[n] = weights.length;
        let sum = 0;
        for (let t = s; t <= e; t++) {
            const w = lanczos3((t - ca) / ia);
            weights.push(w);
            sum += w;
        }
        start[n] = s;
        count[n] = e - s + 1;
        wsum[n] = sum === 0 ? 1 : sum;
    }
    return { start, count, offset, weights, wsum };
}

/* Same math, tap set, tap order and progress reporting as resizeLanczos,
 * with two structural changes:
 *  1. each dimension's tap weights are built once per line instead of
 *     being recomputed per pixel (the old code re-evaluated lanczos3 —
 *     2 sin() calls each — for every output pixel),
 *  2. the vertical pass accumulates whole contiguous rows per tap
 *     instead of striding sy*dw*3 per pixel.
 * Output is bit-identical to resizeLanczos. */
export function resizeLanczosFast(src: Float32Array, sw: number, sh: number, dw: number, dh: number, report?: (t: number) => void): Float32Array {
    let lastQ = -1;
    const tick = (t: number) => {  // quantized to 1/20 steps so per-row calls stay cheap
        if (!report) return;
        const q = Math.floor(t * 20);
        if (q !== lastQ) { lastQ = q; report(q / 20); }
    };
    const tmp = new Float32Array(dw * sh * 3);
    const rowLen = dw * 3;

    // ---- horizontal pass ----
    const wx = buildLanczosLine(sw, dw);
    const wxS = wx.start, wxC = wx.count, wxO = wx.offset, wxW = wx.weights, wxSum = wx.wsum;
    for (let y = 0; y < sh; y++) {
        const srcRow = y * sw * 3;
        const tmpRow = y * rowLen;
        for (let x = 0; x < dw; x++) {
            const c = wxC[x], s = wxS[x];
            let wo = wxO[x];
            let o = srcRow + s * 3;
            let r = 0, g = 0, b = 0;
            for (let t = 0; t < c; t++, o += 3, wo++) {
                const w = wxW[wo];
                r += src[o] * w; g += src[o + 1] * w; b += src[o + 2] * w;
            }
            const ws = wxSum[x];
            const d = tmpRow + x * 3;
            tmp[d] = r / ws; tmp[d + 1] = g / ws; tmp[d + 2] = b / ws;
        }
        tick((y + 1) / sh * 0.6);
    }

    // ---- vertical pass (tap-outer: each source row is read and the dst
    // row accumulated in contiguous memory). acc must be f64: the old
    // per-pixel formulation sums all taps in f64 and rounds once on the
    // f32 store, so accumulating straight into the f32 dst would round
    // per tap and change the bits. ----
    const wy = buildLanczosLine(sh, dh);
    const wyS = wy.start, wyC = wy.count, wyO = wy.offset, wyW = wy.weights, wySum = wy.wsum;
    const dst = new Float32Array(dw * dh * 3);
    const acc = new Float64Array(rowLen);
    for (let y = 0; y < dh; y++) {
        const dstRow = y * rowLen;
        const c = wyC[y], s = wyS[y], wo = wyO[y];
        acc.fill(0);
        for (let t = 0; t < c; t++) {
            const w = wyW[wo + t];
            const srcRow = (s + t) * rowLen;
            for (let x = 0; x < rowLen; x++) {
                acc[x] += tmp[srcRow + x] * w;
            }
        }
        const ws = wySum[y];
        for (let x = 0; x < rowLen; x++) {
            dst[dstRow + x] = acc[x] / ws;
        }
        tick(0.6 + (y + 1) / dh * 0.4);
    }
    return dst;
}

/* ------------------------------------------------------------------ *
 *  Butterworth low-pass — zero-phase 2nd-order IIR applied per 
 *  horizontal row (filtfilt).
 *  w = cutoff·π/2 ; D = 1 + √2·w + w² ; z = w²/D ;
 *  ca = 2(w²−1)/D ; ba = (1 − √2·w + w²)/D
 *  y[n] = z·x[n] + 2z·x[n−1] + z·x[n−2] − ca·y[n−1] − ba·y[n−2]
 * ------------------------------------------------------------------ */
function butterLowPassRow(src: Float32Array, w: number, h: number, cutoff: number): void {
    if (cutoff <= 0 || cutoff >= 1) return;
    const wc = cutoff * Math.PI / 2;
    const D = 1 + Math.SQRT2 * wc + wc * wc;
    const z = wc * wc / D;
    const ca = 2 * (wc * wc - 1) / D;
    const ba = (1 - Math.SQRT2 * wc + wc * wc) / D;
    const b1 = 2 * z;
    const dcGain = (z + b1 + z) / (1 + ca + ba); // == 1.0 for Butterworth

    const out = new Float32Array(src.length);
    const fwd = new Float32Array(w);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        // forward pass
        let x1 = src[row], x2 = src[row], y1 = src[row], y2 = src[row];
        // steady-state initial condition: y[0] = dcGain * x[0]
        fwd[0] = dcGain * src[row];
        for (let x = 1; x < w; x++) {
            const xn = src[row + x];
            const yn = z * xn + b1 * x1 + z * x2 - ca * y1 - ba * y2;
            x2 = x1; x1 = xn; y2 = y1; y1 = yn;
            fwd[x] = yn;
        }
        // reverse pass (filtfilt)
        x1 = fwd[w - 1]; x2 = fwd[w - 1]; y1 = fwd[w - 1]; y2 = fwd[w - 1];
        out[row + w - 1] = dcGain * fwd[w - 1];
        for (let x = w - 2; x >= 0; x--) {
            const xn = fwd[x];
            const yn = z * xn + b1 * x1 + z * x2 - ca * y1 - ba * y2;
            x2 = x1; x1 = xn; y2 = y1; y1 = yn;
            out[row + x] = yn;
        }
    }
    src.set(out);
}

/* 2D box blur over one channel — used by the sharpen (unsharp mask)
 * step, square-window running average. */
function boxBlurPlane(src: Float32Array, w: number, h: number, radius: number): void {
    if (radius < 1) return;
    const out = new Float32Array(src);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0, cnt = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                const row = yy * w;
                for (let dx = -radius; dx <= radius; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    sum += src[row + xx];
                    cnt++;
                }
            }
            out[y * w + x] = sum / cnt;
        }
    }
    src.set(out);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/* ------------------------------------------------------------------ *
 *  Main entry. Pure TS + OffscreenCanvas only (stage 11), so the whole
 *  pipeline is safe inside a Web Worker. `p` is the plain FilterParams
 *  object (no JSON string). `onProgress` reports coarse stage progress
 *  as (0..1 fraction, label) at stage boundaries; the two Lanczos
 *  resizes dominate runtime and emit ~20 quantized ticks each.
 * ------------------------------------------------------------------ */
export async function applyFilter(
    input_image_data: Uint8Array,
    orig_w: number,
    orig_h: number,
    p: FilterParams,
    onProgress?: (fraction: number, label: string) => void,
): Promise<Uint8Array<ArrayBuffer>> {
    const report = (fraction: number, label: string) => { onProgress?.(fraction, label); };
    const W = orig_w, H = orig_h;

    /* ---- 1. Downscale (Lanczos-3, ~307200 px working canvas) ----
     * Reduces the image to ~307200 pixels before any filter
     * work (both a perf choice and part of the VHS look — the filters run
     * at low-res, then the final upscale reintroduces softness). For 4:3 this 
     * is 640x480 exactly (identity resize when input is already 640x480). */
    const aspect = W / H;
    let dh = Math.floor(Math.sqrt(307200 / aspect));
    let ds = Math.floor(aspect * dh);
    dh = Math.max(1, dh); ds = Math.max(1, ds);

    // RGBA -> float RGB (0..255). Alpha is ignored throughout.
    const srcRgb = new Float32Array(W * H * 3);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
        srcRgb[i * 3] = input_image_data[j];  // auto convert to float32
        srcRgb[i * 3 + 1] = input_image_data[j + 1];
        srcRgb[i * 3 + 2] = input_image_data[j + 2];
    }
    report(0.02, 'Downscaling');
    const rgb = resizeLanczosFast(srcRgb, W, H, ds, dh, (t) => report(0.02 + t * 0.21, 'Downscaling'));

    /* ---- 2. Tone curve + RGB->YIQ (planes normalized 0..1) ----
     * Per channel (this is the UI "Crush Blacks / Blow out Whites"):
     *   c' = clamp((clamp(c, tone_low, tone_high) - tone_low) * 255/(hi-lo))
     * then /255 to normalize to 0..1. Y/I/Q planes are kept in f32 0..1
     * throughout.
     * Forward YIQ = standard BT.470/NTSC:
     *   Y = 0.299R + 0.587G + 0.114B
     *   I = 0.596R - 0.274G - 0.322B
     *   Q = 0.211R - 0.523G + 0.312B                      */
    report(0.25, 'Color space');
    const lo = Math.max(Number(p.tone_low) || 0, 0);
    const hi = Math.min(Number(p.tone_high) || 255, 255);
    const gc = (hi - lo) > 0 ? 255.0 / (hi - lo) : 1;
    const npx = ds * dh;
    const Y = new Float32Array(npx);
    const I = new Float32Array(npx);
    const Q = new Float32Array(npx);

    for (let i = 0; i < npx; i++) {
        const r = Math.min(255, Math.max(0, (Math.min(hi, Math.max(lo, rgb[i * 3])) - lo) * gc)) / 255;
        const g = Math.min(255, Math.max(0, (Math.min(hi, Math.max(lo, rgb[i * 3 + 1])) - lo) * gc)) / 255;
        const b = Math.min(255, Math.max(0, (Math.min(hi, Math.max(lo, rgb[i * 3 + 2])) - lo) * gc)) / 255;
        // Forward coefficients (standard BT.470/NTSC)
        Y[i] = r * 0.299 + g * 0.587 + b * 0.114;
        I[i] = r * 0.596 + g * -0.274 + b * -0.322;
        Q[i] = r * 0.211 + g * -0.523 + b * 0.312;
    }

    /* ---- 3. Per-plane low-pass (Butterworth) ----
     * Each Y/I/Q plane is low-passed per row with a zero-phase 2nd-order
     * Butterworth IIR (forward + reverse = filtfilt). cutoff_y/i/q are
     * normalized frequencies 0..1 (UI "bandwidth" sliders). This is the
     * analog bandwidth limiting: Y blur kills fine luma detail, I/Q blur
     * kills chroma resolution. NOTE: it's NOT a box blur — it's an IIR.
     * Gated off when cutoff <= 0 or >= 1 (no-op). */
    report(0.30, 'Bandwidth');
    butterLowPassRow(Y, ds, dh, Number(p.cutoff_y) || 0);
    butterLowPassRow(I, ds, dh, Number(p.cutoff_i) || 0);
    butterLowPassRow(Q, ds, dh, Number(p.cutoff_q) || 0);

    /* ---- 4. Vertical chroma crosstalk ----
     * Bleeds each row's I/Q down into the NEXT row:
     *   I[y+1] = ct * I[y] + (1-ct) * I[y+1]   (top-down!)
     * Mimics NTSC vertical color smearing on a video head.
     * Top-down, not bottom-up. */
    report(0.36, 'Chroma bleed');
    const ct = clamp01(Number(p.chroma_crosstalk) || 0);
    if (ct > 0) {
        for (let y = 0; y < dh - 1; y++) {
            const cur = y * ds, nxt = (y + 1) * ds;
            for (let x = 0; x < ds; x++) {
                const ni = nxt + x;
                I[ni] = ct * I[cur + x] + (1 - ct) * I[ni];
                Q[ni] = ct * Q[cur + x] + (1 - ct) * Q[ni];
            }
        }
    }

    /* ---- 5. Horizontal chroma shift ----
     * Circularly shifts I/Q horizontally by chroma_shift_x pixels.
     * Mimics the color-subcarrier timing offset of composite video. */
    report(0.38, 'Chroma shift');
    const cshift = Math.round(Number(p.chroma_shift_x) || 0);
    if (cshift > 0) {
        const ni = new Float32Array(npx), nq = new Float32Array(npx);
        for (let y = 0; y < dh; y++) {
            const row = y * ds;
            for (let x = 0; x < ds; x++) {
                const sx = ((x - cshift) % ds + ds) % ds;
                ni[row + x] = I[row + sx];
                nq[row + x] = Q[row + sx];
            }
        }
        I.set(ni); Q.set(nq);
    }

    /* ---- 6. Unsharp mask on Y only (strong ringing) ----
     * UI "apply_sharpening". Blurs Y with a 2D square-
     * window box blur of radius sharpen_radius , then adds 
     * amt * (Y - blurred) back — classic unsharp mask. The low-res
     * pipeline + upscale makes this produce heavy halos/ringing. */
    report(0.41, 'Ringing');
    if (p.apply_sharpening) {
        const amt = Number(p.sharpen_amount) || 0;
        const radius = Math.max(1, Math.min(16, Math.round(Number(p.sharpen_radius) || 2)));
        const blurred = new Float32Array(Y);
        boxBlurPlane(blurred, ds, dh, radius);
        for (let i = 0; i < npx; i++) {
            Y[i] = clamp01(Y[i] + amt * (Y[i] - blurred[i]));
        }
    }

    /* ---- 7. Row displacement (jitter + head switch) + dropout streaks ----
     * Builds a per-row horizontal offset `rowOff` used later to resample
     * the image. Two mechanical artifacts mix into the offset; a third is
     * painted separately after resampling:
     *   - JITTER: sine at jitter_freq plus a low-passed random
     *     term (exp-based smoothing, decay 0.9 classic / 0.7 default)
     *     scaled by jitter_amp * jitter_roughness.
     *   - HEAD SWITCH: a band of `head_switch_rows` at the bottom gets a
     *     strong horizontal pull (head_switch_pull) — exp-shaped in the
     *     original; this port's pull is an approximation. head_switch_noise
     *     is the per-row probability of an extra random kick inside the
     *     band (not exposed in the UI, so effectively 0).
     *   - DROPOUT: NOT a displacement. `dropout_count` single-row horizontal runs,
     *     length uniform in [10, dropout_max_len] px at a uniform random
     *     row/start, painted ONTO THE RESAMPLED PLANES (output coords):
     *     each painted pixel becomes Y' = 0.7*rand01 + 0.3*Y with I/Q
     *     crushed to 20% — an opaque gray-white scratch. dropout_max_len
     *     is the max HORIZONTAL width. 
     * Here we use a deterministic
     * mulberry32 + Box-Muller (seed 0x5EED) so output is reproducible;
     * visual character is equivalent. */
    report(0.50, 'Jitter');
    const rand = mulberry32(0x5EED);
    const norm = makeNormal(rand);
    const jitterFreq = Number(p.jitter_freq) || 0;
    const jitterAmp = Number(p.jitter_amp) || 0;
    const roughness = Number(p.jitter_roughness) || 0;
    const headRows = Math.max(0, Math.round(Number(p.head_switch_rows) || 0));
    const headPull = Number(p.head_switch_pull) || 0;
    const headNoise = clamp01(Number(p.head_switch_noise) || 0);
    const dropCount = Math.max(0, Math.round(Number(p.dropout_count) || 0));
    const dropMaxLen = Math.round(Number(p.dropout_max_len) || 80);

    const rowOff = new Float32Array(dh);
    // smoothed-noise accumulators (two variants: classic vs default)
    let accA = 0, accB = 0;
    const headRow = Math.max(0, dh - headRows);
    for (let y = 0; y < dh; y++) {
        // jitter: sine + low-passed random
        const sine = Math.sin(y * jitterFreq * Math.PI * 2);
        let off;
        if (p.jitter_classic) {
            accA = accA * 0.9 + norm() * 0.1;
            off = jitterAmp * sine + roughness * jitterAmp * accA;
        } else {
            accB = accB * 0.7 + norm() * 0.3;
            off = jitterAmp * sine + roughness * jitterAmp * accB;
        }
        // head-switch band near bottom: strong pull, decaying upward
        if (headRows > 0 && y >= headRow) {
            const t = (y - headRow) / headRows;           // 0 at top of band, 1 at bottom
            off += headPull * t * (rand() * 2 - 1);        // increasing pull toward bottom
            if (rand() < headNoise) off += norm() * headPull * 0.5;
        }
        rowOff[y] = off;
    }

    /* ---- 7b. Dropout streaks (painted after the displacement resample) ----
     * Drawn once per frame:
     *   row   ~ uniform [0, dh)
     *   start ~ uniform [0, ds)
     *   len   ~ uniform [10, dropout_max_len] px (skipped entirely when
     *           dropout_max_len < 10), clipped at the row end.
     * The ranges live in OUTPUT coordinates — the original paints the
     * resampled planes — so the mask is indexed by (y, x) below, not by
     * the displaced sample position. Painting itself happens in the
     * output pass: Y' = 0.7*rand01 + 0.3*Y, I/Q *= 0.2 per pixel. */
    const dropMask = new Uint8Array(npx);
    if (dropCount > 0 && dropMaxLen >= 10) {
        for (let k = 0; k < dropCount; k++) {
            const sy = Math.floor(rand() * dh);
            const sx = Math.floor(rand() * ds);
            const len = Math.floor(rand() * (dropMaxLen - 9)) + 10;
            const end = Math.min(sx + len, ds);
            for (let x = sx; x < end; x++) dropMask[sy * ds + x] = 1;
        }
    }

    /* ---- 8-12. Sample + noise + scanlines + YIQ->RGB + cast + JPEG + upscale ----
     * Single output pass: for each output pixel, sample the planes at the
     * shifted x (rowOff rounded to int), add per-pixel normal noise to Y
     * (noise_intensity_y) and to I/Q (noise_intensity_c, normalized units),
     * dim odd rows if scanlines enabled (scanline_weight), then convert
     * YIQ->RGB with the standard BT.470 inverse and apply per-channel color
     * cast gains (cast_r/g/b). After this: JPEG round-trip (the 'digital'
     * compression layer, gated by apply_jpeg), then a final Lanczos-3
     * upscale back to the original size with RGBA output (alpha = 255). */
    const outRgb = new Float32Array(npx * 3);
    const ny = Number(p.noise_intensity_y) || 0;
    const nc = Number(p.noise_intensity_c) || 0;
    const scan = !!p.apply_scanlines;
    const scanW = clamp01(Number(p.scanline_weight) || 1);
    const cast = !!p.apply_color_cast;
    const cr = Number(p.cast_r) || 1;
    const cg = Number(p.cast_g) || 1;
    const cb = Number(p.cast_b) || 1;

    report(0.53, 'Synthesis');
    const progStep = Math.max(1, Math.floor(dh / 8));
    for (let y = 0; y < dh; y++) {
        if (y % progStep === 0) report(0.53 + (y / dh) * 0.20, 'Synthesis');
        const off = rowOff[y];
        const offInt = Math.round(off);
        const row = y * ds;
        for (let x = 0; x < ds; x++) {
            let sx = x + offInt;
            if (sx < 0) sx = 0; else if (sx >= ds) sx = ds - 1;
            const idx = row + sx;
            let yv = Y[idx];
            let iv = I[idx];
            let qv = Q[idx];

            // dropout scratch: fresh rand01 per painted pixel — bright noise, chroma crushed
            if (dropMask[row + x]) {
                yv = rand() * 0.7 + yv * 0.3;
                iv *= 0.2;
                qv *= 0.2;
            }

            // per-pixel noise (normalized units)
            yv += norm() * ny;
            const nrm = norm() * nc;
            iv += nrm;
            qv += nrm;
            yv = clamp01(yv);

            // scanlines: odd rows darken Y
            if (scan && (y & 1)) yv *= scanW;

            // YIQ -> RGB (standard inverse) with per-channel cast gains
            let r = (yv + 0.956 * iv + 0.621 * qv) * 255;
            let g = (yv - 0.272 * iv - 0.647 * qv) * 255;
            let b = (yv - 1.106 * iv + 1.703 * qv) * 255;
            if (cast) { r *= cr; g *= cg; b *= cb; }

            const o = (y * ds + x) * 3;
            outRgb[o] = Math.min(255, Math.max(0, r));
            outRgb[o + 1] = Math.min(255, Math.max(0, g));
            outRgb[o + 2] = Math.min(255, Math.max(0, b));
        }
    }

    /* ---- 11. JPEG round-trip (native codec) ---- */
    report(0.75, 'JPEG');
    let finalRgb: Float32Array = outRgb;
    if (p.apply_jpeg) {
        const quality = Math.min(100, Math.max(1, Math.round(Number(p.jpeg_quality) || 65)));
        finalRgb = await jpegRoundTripAsync(outRgb, ds, dh, quality);
    }

    /* ---- 12. Lanczos upscale + RGBA out ---- */
    report(0.80, 'Upscaling');
    const big = resizeLanczosFast(finalRgb, ds, dh, W, H, (t) => report(0.80 + t * 0.18, 'Upscaling'));
    const out = new Uint8Array(W * H * 4);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
        out[j] = Math.min(255, Math.max(0, Math.round(big[i * 3])));
        out[j + 1] = Math.min(255, Math.max(0, Math.round(big[i * 3 + 1])));
        out[j + 2] = Math.min(255, Math.max(0, Math.round(big[i * 3 + 2])));
        out[j + 3] = 255;
    }
    return out;
}

/* ------------------------------------------------------------------ *
 *  JPEG round-trip (async). Native JPEG codec via OffscreenCanvas
 *  (authentic block/ringing artifacts) — worker-safe. Environments
 *  without OffscreenCanvas degrade to a no-op so the rest of the
 *  pipeline still runs. Uses createImageBitmap for true async decode —
 *  the sync Image+drawImage shortcut drew an undecoded image and
 *  produced black output.
 * ------------------------------------------------------------------ */
export async function jpegRoundTripAsync(rgb: Float32Array, w: number, h: number, quality: number): Promise<Float32Array> {
    if (typeof OffscreenCanvas === 'undefined') return rgb;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return rgb;
    const img = ctx.createImageData(w, h);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
        img.data[j] = Math.min(255, Math.max(0, Math.round(rgb[i * 3])));
        img.data[j + 1] = Math.min(255, Math.max(0, Math.round(rgb[i * 3 + 1])));
        img.data[j + 2] = Math.min(255, Math.max(0, Math.round(rgb[i * 3 + 2])));
        img.data[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
    const bmp = await createImageBitmap(blob);
    const c2 = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx2 = c2.getContext('2d');
    if (!ctx2) return rgb;
    ctx2.drawImage(bmp, 0, 0);
    const data = ctx2.getImageData(0, 0, w, h).data;
    const out = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
        out[i * 3] = data[j]; out[i * 3 + 1] = data[j + 1]; out[i * 3 + 2] = data[j + 2];
    }
    return out;
}
