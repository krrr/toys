<script setup lang="ts">
import { reactive } from 'vue'
import { PARAM_SECTIONS, buildDefaultParams } from '../params'
import ParamControl from './ParamControl.vue'
import type { FilterParams } from '../engine/vhs_filter';

const props = defineProps<{
  params: FilterParams
}>()

function resetParams() {
  Object.assign(props.params, buildDefaultParams())
}

const tooltip = reactive({ visible: false, text: '', x: 0, y: 0 })

function showTip(evt: MouseEvent, text: string) {
  const target = evt.currentTarget
  if (!(target instanceof Element)) return
  const rect = target.getBoundingClientRect()
  tooltip.text = text
  tooltip.x = Math.min(rect.right + 10, window.innerWidth - 280)
  tooltip.y = Math.max(8, rect.top - 6)
  tooltip.visible = true
}

function hideTip() {
  tooltip.visible = false
}
</script>

<template>
  <aside class="params-col">
    <div class="params-header">
      <button
        class="btn btn-mini params-reset-btn"
        type="button"
        title="Reset all parameters to defaults"
        @click="resetParams"
      >
        <i class="bi bi-arrow-counterclockwise"></i>
      </button>
      <h5><i class="bi bi-wrench"></i> Filter Parameters</h5>
      <span class="muted params-subtitle">Changes apply instantly</span>
    </div>

    <div class="params-scroll">
      <section v-for="section in PARAM_SECTIONS" :key="section.id" class="param-section">
        <h6 class="param-section-title">
          <i :class="section.icon"></i> {{ section.title }}
        </h6>
        <ParamControl
          v-for="def in section.params"
          :key="def.key"
          :def="def"
          :params="params"
          @show-tip="showTip"
          @hide-tip="hideTip"
        />
      </section>
    </div>

    <div
      v-show="tooltip.visible"
      class="retro-tooltip"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >
      {{ tooltip.text }}
    </div>
  </aside>
</template>

<style lang="css" scoped>
.params-reset-btn {
    position: absolute;
    top: 10px;
    right: 12px;
    font-size: 14px;
    line-height: 18px;
    padding: 0px 2px;
}
</style>