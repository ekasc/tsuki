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

function isThemeMode(value: string | undefined): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'paper'
}

export function AppShell({ children }: { children: React.ReactNode }) {
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

  if (isReaderRoute) {
    return <>{children}</>
  }

  return (
    <div className="app-canvas min-h-screen bg-background pb-10 text-foreground">
      <header className="ui-shell-top-safe mx-auto max-w-7xl px-4 md:px-8">
        <div className="exp-toolbar animate-enter flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            to="/"
            className="group flex items-center gap-2 self-start sm:self-auto"
          >
            <span className="inline-flex size-8 items-center justify-center border border-border bg-surface-soft text-primary">
              <BookOpenText className="size-4" />
            </span>
            <span className="manga-title text-sm font-semibold tracking-tight">
              Tsuki Reader
            </span>
          </Link>

          <div className="grid w-full grid-cols-3 gap-1 border border-border bg-surface-soft p-1 sm:w-auto sm:grid-cols-none sm:auto-cols-fr sm:grid-flow-col">
            {THEME_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={selectedTheme === option.value ? 'default' : 'ghost'}
                className="h-8 w-full px-2 sm:min-w-16"
                disabled={!mounted}
                onClick={() => setTheme(option.value)}
                aria-pressed={selectedTheme === option.value}
                aria-label={`Switch theme to ${option.label}`}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <main className="ui-shell-bottom-safe mx-auto mt-4 max-w-7xl px-4 md:px-8">
        {children}
      </main>
    </div>
  )
}
