import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

function buildDate() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default defineConfig({
  // Relative base: the built app must work when served from any URL
  // subpath (e.g. https://host/some/dir/), not just the domain root.
  base: './',
  plugins: [vue()],
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate()),
  },
})
