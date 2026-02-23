import { Link, useRouterState } from '@tanstack/react-router'
import { useTheme } from 'next-themes'

import { BookOpenText } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '#/components/ui/button'

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
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

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
      <header className="mx-auto max-w-7xl px-4 pt-4 md:px-8">
        <div className="exp-toolbar animate-enter flex items-center justify-between gap-3">
          <Link to="/" className="group flex items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center border border-border bg-surface-soft text-primary">
              <BookOpenText className="size-4" />
            </span>
            <span className="manga-title text-sm font-semibold tracking-tight">
              Tsuki Reader
            </span>
          </Link>

          <div className="flex items-center gap-1 border border-border bg-surface-soft p-1">
            {THEME_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={selectedTheme === option.value ? 'default' : 'ghost'}
                className="h-8 min-w-16 px-2"
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

      <main className="mx-auto mt-4 max-w-7xl px-4 md:px-8">{children}</main>
    </div>
  )
}
