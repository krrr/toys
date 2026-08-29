# AGENTS.md

Client only web app that applies a VHS video-tape filter to images. Vue 3 + TypeScript + Vite, no backend — all processing runs locally in the browser. Styled with Bootstrap 2.3.2 (vendored) + bootstrap-icons for an intentionally dated "201x" retro look; do not modernize the UI styling.

## Commands (pnpm — no package-lock.json, use pnpm)

```sh
pnpm dev         # Vite dev server
pnpm typecheck   # vue-tsc --noEmit
pnpm build       # vue-tsc --noEmit && vite build → dist/
pnpm preview     # serve dist/
```

No test suite and no linter exist; `pnpm typecheck` is the only automated gate.

## Architecture

`components/*.vue` → `engine/vhs_filter_client.ts` (main-thread bridge) → Web Worker `engine/vhs_filter.worker.ts` → `engine/vhs_filter.ts` (pure pipeline). The filter runs off the main thread with transferable buffers; stage progress flows back for the preview progress bar.

## Conventions

- `tsconfig` is strict with `noUnusedLocals`/`noUnusedParameters` and `verbatimModuleSyntax` — type-only imports must use `import type`.
- Vue SFCs use `<script setup lang="ts">` with typed `defineProps`/`defineEmits`; camelCase + 2-space indent.
