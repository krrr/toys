/*
 * Filter parameter schema — drives the whole control panel UI.
 *
 * The keys, ranges, steps and defaults below are the exact contract of the
 * vhs_filter.ts processing engine (see the PARAMETER CONTRACT comment at the
 * top of that file). The original app exposed the same parameters; only
 * the grouping order has been changed here.
 */

import type { FilterParams } from './engine/vhs_filter'

/**
 * Enable/disable linkage: a control is grayed out while its `enabledWhen`
 * predicate fails (e.g. the tint sliders while Color Cast is unchecked).
 * Predicates mirror the engine's own gates in vhs_filter.ts, so a disabled
 * control is exactly one that currently has no effect on the output.
 */
export const isOn = (key: keyof FilterParams) => (p: FilterParams) => Boolean(p[key])
export const isNonZero = (key: keyof FilterParams) => (p: FilterParams) => Number(p[key]) > 0
/** True when every listed key is non-zero (for effects that scale off another slider). */
export const isNonZeroAll =
  (...keys: (keyof FilterParams)[]) => (p: FilterParams) => keys.every((k) => Number(p[k]) > 0)

interface ParamDefBase {
  key: keyof FilterParams
  label: string
  info: string
  enabledWhen?: (p: FilterParams) => boolean
}

export interface RangeParamDef extends ParamDefBase {
  type: 'range'
  min: number
  max: number
  step: number
  def: number
}

export interface CheckParamDef extends ParamDefBase {
  type: 'check'
  def: boolean
}

export type ParamDef = RangeParamDef | CheckParamDef

export interface ParamSection {
  id: string
  title: string
  icon: string
  params: ParamDef[]
}

export const PARAM_SECTIONS: ParamSection[] = [
  {
    id: 'tone',
    title: 'Tone & Color',
    icon: 'bi bi-circle-half',
    params: [
      {
        key: 'tone_low',
        label: 'Crush Blacks',
        type: 'range',
        min: 0, max: 50, step: 1, def: 0,
        info: 'Pushes dark tones toward pure black, like the crushed shadows of a low-quality encode.',
      },
      {
        key: 'tone_high',
        label: 'Blow out Whites',
        type: 'range',
        min: 200, max: 255, step: 1, def: 255,
        info: 'Pushes bright tones to pure white, like the clipped highlights of a cheap camera or capture card.',
      },
      {
        key: 'apply_color_cast',
        label: 'Color Cast',
        type: 'check',
        def: true,
        info: 'Tints the whole image, like a degraded tape or misaligned head.',
      },
      {
        key: 'cast_r',
        label: 'Red Tint (R)',
        type: 'range',
        min: 0.8, max: 1.2, step: 0.01, def: 0.95,
        info: 'Fine-tunes the overall red balance.',
        enabledWhen: isOn('apply_color_cast'),
      },
      {
        key: 'cast_g',
        label: 'Green Tint (G)',
        type: 'range',
        min: 0.8, max: 1.2, step: 0.01, def: 1.05,
        info: 'Fine-tunes the overall green balance.',
        enabledWhen: isOn('apply_color_cast'),
      },
      {
        key: 'cast_b',
        label: 'Blue Tint (B)',
        type: 'range',
        min: 0.8, max: 1.2, step: 0.01, def: 1.0,
        info: 'Fine-tunes the overall blue balance.',
        enabledWhen: isOn('apply_color_cast'),
      },
    ],
  },
  {
    id: 'analog',
    title: 'Analog Tape',
    icon: 'bi bi-film',
    params: [
      {
        key: 'cutoff_y',
        label: 'Luminance Bandwidth (Blur)',
        type: 'range',
        min: 0.01, max: 1.0, step: 0.01, def: 0.55,
        info: 'Limits luminance detail, blurring the picture like a worn tape.',
      },
      {
        key: 'cutoff_i',
        label: 'Chroma I Bandwidth',
        type: 'range',
        min: 0.001, max: 0.1, step: 0.001, def: 0.03,
        info: 'Caps the fine detail of blue and yellow hues.',
      },
      {
        key: 'cutoff_q',
        label: 'Chroma Q Bandwidth',
        type: 'range',
        min: 0.001, max: 0.1, step: 0.001, def: 0.03,
        info: 'The classic NTSC weakness — saturated colors bleed sideways, ignoring edges.',
      },
      {
        key: 'chroma_crosstalk',
        label: 'Chroma Crosstalk',
        type: 'range',
        min: 0.0, max: 0.95, step: 0.01, def: 0.4,
        info: 'Bleeds color vertically across scanlines for that heavy, smeared analog look.',
      },
      {
        key: 'chroma_shift_x',
        label: 'Chroma Shift X',
        type: 'range',
        min: 0, max: 15, step: 1, def: 2,
        info: 'Shifts color to the right, as if the chroma signal arrived late.',
      },
      {
        key: 'noise_intensity_y',
        label: 'Luma Noise',
        type: 'range',
        min: 0, max: 0.1, step: 0.001, def: 0.015,
        info: 'Grainy black-and-white noise, the hallmark of analog tape.',
      },
      {
        key: 'noise_intensity_c',
        label: 'Chroma Noise',
        type: 'range',
        min: 0, max: 0.1, step: 0.001, def: 0.01,
        info: 'Flickering colored speckle in the chroma signal.',
      },
    ],
  },
  {
    id: 'mechanical',
    title: 'Tracking & Wear',
    icon: 'bi bi-shuffle',
    params: [
      {
        key: 'jitter_freq',
        label: 'Jitter Frequency',
        type: 'range',
        min: 0.01, max: 0.2, step: 0.01, def: 0.05,
        info: 'How often the picture wobbles horizontally.',
        enabledWhen: isNonZero('jitter_amp'),
      },
      {
        key: 'jitter_amp',
        label: 'Jitter Amplitude',
        type: 'range',
        min: 0, max: 5.0, step: 0.1, def: 0.5,
        info: 'How far the picture wobbles, mimicking an unevenly spinning VCR motor. The whole frame ripples like water.',
      },
      {
        key: 'jitter_classic',
        label: 'Independent Jitter',
        type: 'check',
        def: false,
        info: 'Gives each scanline its own sharp, jagged offset instead of a smooth wave — the v1.0.0 look.',
      },
      {
        key: 'jitter_roughness',
        label: 'Jitter Roughness',
        type: 'range',
        min: 0.3, max: 10.0, step: 0.1, def: 0.3,
        info: 'How much the wobble varies from line to line. Higher values look more jagged.',
        enabledWhen: isNonZero('jitter_amp'),
      },
      {
        key: 'head_switch_rows',
        label: 'Head Switch Height',
        type: 'range',
        min: 0, max: 100, step: 1, def: 15,
        info: 'How many pixel rows at the bottom edge show head-switching noise.',
      },
      {
        key: 'head_switch_pull',
        label: 'Bottom Distortion',
        type: 'range',
        min: 0, max: 50, step: 0.1, def: 30.0,
        info: 'How far the bottom band tears sideways — each row shifts left or right at random, worsening toward the bottom edge.',
        enabledWhen: isNonZero('head_switch_rows'),
      },
      {
        key: 'head_switch_noise',
        label: 'Bottom Noise',
        type: 'range',
        min: 0, max: 1, step: 0.01, def: 0,
        info: 'Randomly yanks a few rows in the bottom band far out of line, fraying the head-switch tear like tracking briefly losing lock. Scales with Bottom Distortion.',
        enabledWhen: isNonZeroAll('head_switch_rows', 'head_switch_pull'),
      },
      {
        key: 'dropout_count',
        label: 'Dropout Count',
        type: 'range',
        min: 0, max: 50, step: 1, def: 2,
        info: "Number of dropouts — bright horizontal streaks where the tape's oxide coating has flaked off.",
      },
      {
        key: 'dropout_max_len',
        label: 'Dropout Length',
        type: 'range',
        min: 10, max: 200, step: 1, def: 80,
        info: 'Longest a dropout streak can run, in pixels.',
        enabledWhen: isNonZero('dropout_count'),
      },
    ],
  },
  {
    id: 'sharpen',
    title: 'Sharpening & Ringing',
    icon: 'bi bi-zoom-in',
    params: [
      {
        key: 'apply_sharpening',
        label: 'Heavy Ringing',
        type: 'check',
        def: true,
        info: 'Thick edge halos, like the over-eager sharpening circuits of vintage equipment.',
      },
      {
        key: 'sharpen_amount',
        label: 'Sharpen Intensity',
        type: 'range',
        min: 0, max: 10, step: 0.1, def: 3.0,
        info: "Strength of the edge enhancement. High values leave unnatural 'white ghosts' beside dark lines.",
        enabledWhen: isOn('apply_sharpening'),
      },
      {
        key: 'sharpen_radius',
        label: 'Sharpen Width',
        type: 'range',
        min: 1, max: 5, step: 1, def: 2,
        info: 'Width of the ringing halo. Higher values mimic cruder, cheaper circuits.',
        enabledWhen: isOn('apply_sharpening'),
      },
    ],
  },
  {
    id: 'digital',
    title: 'Compression & CRT',
    icon: 'bi bi-gear',
    params: [
      {
        key: 'apply_jpeg',
        label: 'JPEG Block Noise',
        type: 'check',
        def: false,
        info: 'Blocky compression artifacts, like a low-quality upload to an early video site.',
      },
      {
        key: 'jpeg_quality',
        label: 'JPEG Quality',
        type: 'range',
        min: 1, max: 100, step: 1, def: 65,
        info: 'Lower values mean coarser, more visible blocks.',
        enabledWhen: isOn('apply_jpeg'),
      },
      {
        key: 'apply_scanlines',
        label: 'Scanlines',
        type: 'check',
        def: false,
        info: 'Overlays the dark horizontal lines of a CRT monitor.',
      },
      {
        key: 'scanline_weight',
        label: 'Scanline Brightness',
        type: 'range',
        min: 0.5, max: 1.0, step: 0.01, def: 0.75,
        info: 'Brightness of the darkened rows. Lower values carve the scanlines in deeper.',
        enabledWhen: isOn('apply_scanlines'),
      },
    ],
  },
]

/** Flat map of every parameter key -> default value, exactly as the engine expects. */
export function buildDefaultParams(): FilterParams {
  const params = {} as Record<keyof FilterParams, number | boolean>
  for (const section of PARAM_SECTIONS) {
    for (const def of section.params) {
      params[def.key] = def.def
    }
  }
  return params as FilterParams
}
