<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

const props = withDefaults(defineProps<{ show?: boolean }>(), { show: false })

const buildDate = __BUILD_DATE__

const emit = defineEmits<{
  'update:show': [show: boolean]
}>()

function close() {
  emit('update:show', false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-show="props.show" class="modal-backdrop in" @click="close"></div>
  <div v-show="props.show" class="modal about-modal in" role="dialog" @click.stop>
    <div class="modal-header">
      <button class="close" aria-label="Close" @click="close">&times;</button>
      <h3><i class="bi bi-info-circle"></i> About VHS Filter</h3>
    </div>
    <div class="modal-body">
      <p>
        Images are processed by a local algorithm and data will not be uploaded. No server is needed.
      </p>
      <p>
        Source code: <a href="https://github.com/krrr/toys" target="_blank">https://github.com/krrr/toys</a>
      </p>

      <p>
        <span class="muted version-note">Built {{ buildDate }}</span>
      </p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" @click="close">Close</button>
    </div>
  </div>
</template>
