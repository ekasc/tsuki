import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const config = defineConfig({
  define: {
    'process.env.TSUKI_LOCAL_LIBRARY_DRIVER': JSON.stringify(
      process.env.TSUKI_LOCAL_LIBRARY_DRIVER ?? '',
    ),
    'process.env.CLOUDFLARE_ENV': JSON.stringify(
      process.env.CLOUDFLARE_ENV ?? '',
    ),
  },
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
