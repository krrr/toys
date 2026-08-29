<script setup lang="ts">
import { reactive, ref } from 'vue'
import AppNavbar from './components/AppNavbar.vue'
import PreviewArea from './components/PreviewArea.vue'
import ParamsPanel from './components/ParamsPanel.vue'
import InfoModal from './components/InfoModal.vue'
import { buildDefaultParams } from './params'

const params = reactive(buildDefaultParams())
const originalImage = ref<HTMLImageElement | null>(null)
const previewRef = ref<InstanceType<typeof PreviewArea> | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const showAbout = ref(false)


function pickFile() {
  const input = fileInput.value
  if (!input) return
  input.value = ''
  input.click()
}

function onFilePicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) loadFile(file)
}

function loadFile(file: File) {
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      originalImage.value = img
    }
    img.src = reader.result as string
  }
  reader.readAsDataURL(file)
}

function exportImage() {
  previewRef.value?.download()
}

</script>

<template>
  <div class="app-shell">
    <AppNavbar
      :has-image="!!originalImage"
      @pick-file="pickFile"
      @export="exportImage"
      @about="showAbout = true"
    />

    <div class="app-body">
      <PreviewArea
        ref="previewRef"
        :image="originalImage"
        :params="params"
        @file="loadFile"
        @pick-file="pickFile"
      />
      <ParamsPanel :params="params" />
    </div>

    <input ref="fileInput" type="file" accept="image/*" hidden @change="onFilePicked" />
    <InfoModal v-model:show="showAbout" />
  </div>
</template>
