import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const config = defineConfig({
  server: {
    watch: {
      ignored: [
        '**/data/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/.playwright-artifacts/**',
      ],
    },
  },
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort: false }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
