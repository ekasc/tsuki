import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
    cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort: false }),
    tailwindcss(),
    tanstackStart({
      router: {
        codeSplittingOptions: {
          defaultBehavior: [
            ['loader'],
            ['component'],
            ['pendingComponent'],
            ['errorComponent'],
            ['notFoundComponent'],
          ],
        },
      },
    }),
    viteReact(),
  ],
})

export default config
