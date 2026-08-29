<script setup lang="ts">
import { computed } from 'vue'
import type { ParamDef } from '../params'
import type { FilterParams } from '../engine/vhs_filter';

const props = defineProps<{
  def: ParamDef
  params: FilterParams
}>()

defineEmits<{
  'show-tip': [evt: MouseEvent, text: string]
  'hide-tip': []
}>()

type ParamValue = number | boolean

function setParam(v: ParamValue) {
  ;(props.params as Record<keyof FilterParams, ParamValue>)[props.def.key] = v
}

const checkModel = computed<boolean>({
  get: () => Boolean(props.params[props.def.key]),
  set: setParam,
})

const rangeModel = computed<number>({
  get: () => Number(props.params[props.def.key]),
  set: setParam,
})

const display = computed(() => {
  if (props.def.type === 'check') return checkModel.value ? 'ON' : 'OFF'
  const step = props.def.step ?? 1
  if (step >= 1) return String(Math.round(rangeModel.value))
  const decimals = (String(step).split('.')[1] || '').length
  return rangeModel.value.toFixed(decimals)
})

const enabled = computed(
  () => !props.def.enabledWhen || props.def.enabledWhen(props.params),
)
</script>

<template>
  <label
    v-if="def.type === 'check'"
    class="checkbox param-check"
    :class="{ 'param-disabled': !enabled }"
  >
    <input v-model="checkModel" type="checkbox" :disabled="!enabled" />
    {{ def.label }}
    <button
      v-if="def.info"
      class="info-btn"
      title=""
      @mouseenter="$emit('show-tip', $event, def.info)"
      @mouseleave="$emit('hide-tip')"
      @click.prevent.stop="$emit('show-tip', $event, def.info)"
    >
      ?
    </button>
  </label>

  <div v-else class="param-slider" :class="{ 'param-disabled': !enabled }">
    <div class="slider-header">
      <span class="param-label">{{ def.label }}</span>
      <button
        v-if="def.info"
        class="info-btn"
        title=""
        @mouseenter="$emit('show-tip', $event, def.info)"
        @mouseleave="$emit('hide-tip')"
        @click.prevent.stop="$emit('show-tip', $event, def.info)"
      >
        ?
      </button>
      <span class="badge badge-info val-display">{{ display }}</span>
    </div>
    <input
      v-model.number="rangeModel"
      type="range"
      class="retro-slider"
      :min="def.min"
      :max="def.max"
      :step="def.step ?? 1"
      :disabled="!enabled"
    />
  </div>
</template>
