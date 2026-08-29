<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { runFilterWorker } from '../engine/vhs_filter_client'
import type { FilterParams, FilterProgress } from '../engine/vhs_filter_client'

const props = defineProps<{
  image: HTMLImageElement | null
  params: FilterParams
}>()

const emit = defineEmits<{
  'file': [file: File]
  'pick-file': []
}>()

const MAX_DIMENSION = 1280

const viewportEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const hasImage = ref(false)
const isProcessing = ref(false)
const progress = ref<FilterProgress>({ fraction: 0, label: '' })
const progressPercent = computed(() => Math.round(progress.value.fraction * 100))
const progressLabel = computed(() => progress.value.label || 'Working')
const isPanning = ref(false)
const isDragOver = ref(false)

// --- Viewport transform (pan & zoom) ---
const transform = reactive({ scale: 1, x: 0, y: 0 })
const containerStyle = computed(
  () => `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
)
const zoomPercent = computed<number>({
  get: () => Math.round(transform.scale * 100),
  set: (v) => setZoom(v / 100),
})

function setZoom(newScale: number, originX?: number, originY?: number) {
  if (!viewportEl.value) return
  const ox = originX ?? viewportEl.value.clientWidth / 2
  const oy = originY ?? viewportEl.value.clientHeight / 2
  const oldScale = transform.scale
  const s = Math.min(Math.max(0.1, newScale), 5.0)
  transform.x = ox - (ox - transform.x) * (s / oldScale)
  transform.y = oy - (oy - transform.y) * (s / oldScale)
  transform.scale = s
}

function fitToViewport() {
  if (!viewportEl.value || !canvasEl.value) return
  const w = canvasEl.value.width
  const h = canvasEl.value.height
  const vW = viewportEl.value.clientWidth
  const vH = viewportEl.value.clientHeight
  transform.scale = Math.min(1.0, (vW - 40) / w, (vH - 40) / h)
  transform.x = (vW - w * transform.scale) / 2
  transform.y = (vH - h * transform.scale) / 2
}

// Mouse pan
let dragStartX = 0
let dragStartY = 0

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  isPanning.value = true
  dragStartX = e.clientX - transform.x
  dragStartY = e.clientY - transform.y
}

function onMouseMove(e: MouseEvent) {
  if (!isPanning.value) return
  transform.x = e.clientX - dragStartX
  transform.y = e.clientY - dragStartY
}

function onMouseUp() {
  isPanning.value = false
}

function onWheel(e: WheelEvent) {
  if (!hasImage.value || !viewportEl.value) return
  const rect = viewportEl.value.getBoundingClientRect()
  setZoom(transform.scale * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX - rect.left, e.clientY - rect.top)
}

// Touch pan + pinch zoom
let pinchDist: number | null = null

function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 1) {
    isPanning.value = true
    dragStartX = e.touches[0].clientX - transform.x
    dragStartY = e.touches[0].clientY - transform.y
  } else if (e.touches.length === 2) {
    isPanning.value = false
    pinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    )
  }
}

function onTouchMove(e: TouchEvent) {
  if (isPanning.value && e.touches.length === 1) {
    transform.x = e.touches[0].clientX - dragStartX
    transform.y = e.touches[0].clientY - dragStartY
  } else if (e.touches.length === 2 && pinchDist !== null && viewportEl.value) {
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    )
    const rect = viewportEl.value.getBoundingClientRect()
    setZoom(
      transform.scale * (dist / pinchDist),
      (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
      (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
    )
    pinchDist = dist
  }
}

function onTouchEnd() {
  isPanning.value = false
  pinchDist = null
}

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})

// --- Drop zone ---
function onDrop(e: DragEvent) {
  isDragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) emit('file', file)
}

// --- Image load & filter processing ---
let running = false
let rerunNeeded = false
let debounceTimer: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.image,
  async (img) => {
    if (!img) return
    hasImage.value = true
    await nextTick()

    const canvas = canvasEl.value
    if (!canvas) return

    let w = img.width
    let h = img.height
    if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
      const ratio = Math.min(MAX_DIMENSION / w, MAX_DIMENSION / h)
      w = Math.floor(w * ratio)
      h = Math.floor(h * ratio)
    }
    canvas.width = w
    canvas.height = h

    fitToViewport()
    scheduleProcess(0)
  },
)

watch(() => props.params, () => scheduleProcess(200), { deep: true })

function scheduleProcess(delay: number) {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(runProcess, delay)
}

async function runProcess() {
  if (!props.image) return
  if (running) {
    rerunNeeded = true
    return
  }
  running = true
  isProcessing.value = true
  progress.value = { fraction: 0, label: 'Preparing' }

  try {
    const canvas = canvasEl.value
    if (!canvas) return
    const temp = document.createElement('canvas')
    temp.width = canvas.width
    temp.height = canvas.height
    const tctx = temp.getContext('2d')
    if (!tctx) return
    tctx.drawImage(props.image, 0, 0, canvas.width, canvas.height)
    const imageData = tctx.getImageData(0, 0, canvas.width, canvas.height)

    const result = await runFilterWorker(
      new Uint8Array(imageData.data.buffer),
      canvas.width,
      canvas.height,
      props.params,
      (p) => { progress.value = p },
    )

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(result.buffer), canvas.width, canvas.height),
      0,
      0,
    )
  } catch (err) {
    console.error('Processing error:', err)
  } finally {
    running = false
    isProcessing.value = false
    if (rerunNeeded) {
      rerunNeeded = false
      scheduleProcess(50)
    }
  }
}

// --- Export helpers (called from App via template ref) ---
function getDataUrl(): string {
  return canvasEl.value?.toDataURL('image/png') ?? ''
}

function download() {
  if (!hasImage.value) return
  const link = document.createElement('a')
  link.download = 'vhs.png'
  link.href = getDataUrl()
  link.click()
}

defineExpose({ getDataUrl, download })
</script>

<template>
  <main class="preview-col">
    <div
      ref="viewportEl"
      class="preview-viewport"
      :class="{ panning: isPanning }"
      @mousedown="onMouseDown"
      @wheel.prevent="onWheel"
      @touchstart="onTouchStart"
      @touchmove.prevent="onTouchMove"
      @touchend="onTouchEnd"
      @dragover.prevent="isDragOver = true"
      @dragleave.prevent="isDragOver = false"
      @drop.prevent="onDrop"
    >
      <div class="canvas-container" :style="{ transform: containerStyle }">
        <canvas ref="canvasEl" class="main-canvas" :class="{ 'is-active': hasImage }"></canvas>
      </div>

      <div v-if="!hasImage" class="drop-zone" :class="{ 'drag-over': isDragOver }">
        <span class="label drop-step">Step 1 · Load Tape</span>
        <i class="bi bi-upload drop-icon"></i>
        <p class="drop-title">Drag &amp; Drop Image Here</p>
        <p class="drop-formats">PNG · JPEG · GIF — processed locally</p>
        <button class="btn btn-primary btn-large" @click.stop="$emit('pick-file')">
          Select File
        </button>
      </div>

      <div v-if="isProcessing" class="processing-overlay">
        <div class="progress progress-striped active processing-bar">
          <div class="bar" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <span class="processing-text">Processing... {{ progressPercent }}% · {{ progressLabel }}</span>
      </div>

      <div v-if="hasImage" class="zoom-bar" @mousedown.stop @touchstart.stop>
        <i class="bi bi-zoom-out"></i>
        <input
          v-model.number="zoomPercent"
          type="range"
          min="10"
          max="300"
          class="retro-slider zoom-slider"
        />
        <i class="bi bi-zoom-in"></i>
        <span class="val-display zoom-value">{{ zoomPercent }}%</span>
      </div>
    </div>
  </main>
</template>

<style lang="css" scoped>
/* Drop zone (.well inset panel + dropzone.js-style dashed frame) */
.drop-zone {
    position: absolute;
    inset: 24px;
    border: 2px dashed #bbb;
    outline: 1px solid #e0e0e0;
    outline-offset: -8px;
    border-radius: 5px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: #f7f7f7;
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.05);
    transition: border linear 0.2s, box-shadow linear 0.2s;
    z-index: 10;
}

.drop-title {
    font-size: 18px;
    font-weight: bold;
    color: #333;
    text-shadow: 0 1px 0 #fff;
    margin: 14px 0 2px;
}

.drop-formats {
    font-size: 11px;
    color: #999;
    text-shadow: 0 1px 0 #fff;
    margin: 0 0 14px;
}

.drop-step {
    position: absolute;
    top: 10px;
    left: 10px;
}

.drop-zone.drag-over {
    border-color: rgba(82, 168, 236, 0.8);
    box-shadow: 0 0 8px rgba(82, 168, 236, 0.6);
    background: #e8f4fb;
}

.drop-icon {
    font-size: 52px;
    line-height: 1;
    margin: 20px 0 4px;
    color: #bbb;
    text-shadow: 0 1px 0 #fff;
}

/* Floating zoom bar (BS2 .navbar-inner recipe) */
.zoom-bar {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background-color: #fafafa;
    background-image: linear-gradient(to bottom, #ffffff, #f2f2f2);
    border: 1px solid #b3b3b3;
    border-radius: 4px;
    box-shadow: inset 0 1px 0 #fff, 0 2px 6px rgba(0, 0, 0, 0.35);
    cursor: default;
    z-index: 20;
}

.zoom-bar > .bi {
    color: #555;
    text-shadow: 0 1px 0 #fff;
}

.zoom-slider {
    width: 160px !important;
    flex: none;
}

.zoom-value {
    min-width: 36px;
}
</style>