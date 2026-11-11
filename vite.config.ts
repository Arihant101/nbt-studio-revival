/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Global env stays 'node' so the existing parser/store/edit .test.ts suites
  // are unaffected; component .test.tsx files opt into jsdom via a per-file
  // `// @vitest-environment jsdom` docblock.
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
