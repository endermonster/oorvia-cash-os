import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Mirrors tsconfig's "@/*" path so route handlers can be tested.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
