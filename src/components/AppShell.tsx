import { Link, useRouterState } from '@tanstack/react-router'
import { useTheme } from 'next-themes'

import { BookOpenText } from 'lucide-react'
import { useEffect, useState } from 'react'

import { SelectField } from '#/components/ui/select'

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
    setMounted(true)
  }, [])

  const selectedTheme = mounted && isThemeMode(theme) ? theme : 'light'
  const isReaderRoute =
    pathname.startsWith('/reader/') || pathname.startsWith('/weebcentral/')

  if (isReaderRoute) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-background pb-8 text-foreground">
      <header className="mx-auto max-w-7xl px-4 pt-4 md:px-8">
        <div className="animate-enter ui-panel flex items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="group flex items-center gap-3">
            <span className="inline-flex size-8 items-center justify-center border border-border bg-surface-soft text-muted-foreground transition-colors group-hover:text-foreground">
              <BookOpenText className="size-4" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold tracking-[0.16em]">
                SUKI
              </span>
              <span className="text-xs text-muted-foreground transition group-hover:text-foreground">
                Manga reader
              </span>
            </span>
          </Link>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <label
              htmlFor="theme-select"
              className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
            >
              Theme
            </label>
            <SelectField
              id="theme-select"
              value={selectedTheme}
              onChange={(event) => setTheme(event.target.value)}
              disabled={!mounted}
              className="h-8 w-auto min-w-24 px-2 text-xs"
              options={THEME_OPTIONS}
            ></SelectField>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-4 max-w-7xl px-4 md:px-8">{children}</main>
    </div>
  )
}
