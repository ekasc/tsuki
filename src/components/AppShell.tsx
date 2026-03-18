import { Link, useRouterState } from '@tanstack/react-router'
import { useTheme } from 'next-themes'

import { BookOpenText } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '#/components/ui/button'
import { useDeviceProfile } from '#/hooks/use-device-profile'

type ThemeMode = 'light' | 'dark' | 'paper'

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'paper', label: 'Paper' },
]
const THEME_COLOR_BY_MODE: Record<ThemeMode, string> = {
  light: '#1d140d',
  dark: '#1c1823',
  paper: '#181715',
}

function isThemeMode(value: string | undefined): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'paper'
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const currentYear = new Date().getFullYear()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const { platform, formFactor, isStandalonePwa } = useDeviceProfile()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  useEffect(() => {
    document.documentElement.dataset.platform = platform
    document.documentElement.dataset.formFactor = formFactor
    document.documentElement.dataset.standalone = isStandalonePwa
      ? 'true'
      : 'false'
  }, [formFactor, isStandalonePwa, platform])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const nextTheme = window.localStorage.getItem('tsuki-theme-mode.v1')
      if (!nextTheme) {
        const legacyTheme = window.localStorage.getItem('suki-theme-mode.v1')
        if (legacyTheme) {
          window.localStorage.setItem('tsuki-theme-mode.v1', legacyTheme)
        }
      }
    }

    setMounted(true)
  }, [])

  const selectedTheme = mounted && isThemeMode(theme) ? theme : 'light'
  const isReaderRoute =
    pathname.startsWith('/reader/') || pathname.startsWith('/weebcentral/')

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const metaThemeColor = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )
    if (!metaThemeColor) {
      return
    }

    metaThemeColor.setAttribute(
      'content',
      THEME_COLOR_BY_MODE[selectedTheme] ?? THEME_COLOR_BY_MODE.light,
    )
  }, [selectedTheme])

  if (isReaderRoute) {
    return <>{children}</>
  }

  return (
    <div className="app-canvas min-h-screen bg-background pb-24 text-foreground md:pb-10">
      <header className="ui-shell-top-safe mx-auto max-w-7xl px-4 md:px-8">
        <div className="exp-toolbar animate-enter flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            to="/"
            className="group flex items-center gap-2 self-start rounded px-1 py-1 sm:self-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="inline-flex size-8 items-center justify-center border border-border bg-surface-soft text-primary">
              <BookOpenText className="size-4" />
            </span>
            <span className="manga-title text-sm font-semibold tracking-tight">
              Tsuki Reader
            </span>
          </Link>

          <div
            role="radiogroup"
            aria-label="Theme mode"
            className="grid w-auto max-w-full grid-cols-3 gap-1 border border-border bg-surface-soft p-1 sm:grid-cols-none sm:auto-cols-fr sm:grid-flow-col"
          >
            {THEME_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={selectedTheme === option.value ? 'default' : 'ghost'}
                className="h-11 w-full px-2 sm:min-w-20"
                disabled={!mounted}
                onClick={() => setTheme(option.value)}
                role="radio"
                aria-checked={selectedTheme === option.value}
                aria-label={`Switch theme to ${option.label}`}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="ui-shell-bottom-safe mx-auto mt-4 max-w-7xl px-4 md:px-8"
      >
        {children}
      </main>

      <footer className="ui-shell-bottom-safe mx-auto mt-6 max-w-7xl px-4 pb-6 text-xs text-muted-foreground md:px-8">
        <div className="border-t border-border/60 pt-3">
          <p>
            Tsuki is an image proxy/reader UI. This website does not host manga
            files.
          </p>
          <p className="mt-1">
            Credits:{' '}
            <a
              href="https://weebcentral.com"
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Weeb Central
            </a>{' '}
            and{' '}
            <a
              href="https://cubari.moe"
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Cubari.moe
            </a>
            .
          </p>
          <p className="mt-1">© {currentYear} Tsuki Reader. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
