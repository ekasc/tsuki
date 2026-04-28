import { Link, useRouterState } from '@tanstack/react-router'
import { useTheme } from 'next-themes'

import { BookOpenText, Coffee, Palette } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useDeviceProfile } from '#/hooks/use-device-profile'
import {
  LEGACY_THEME_STORAGE_KEY,
  isThemeMode,
  type ThemeDisplayMode,
  type ThemeMode,
  type ThemePaletteMode,
  THEME_COLOR_BY_MODE,
  THEME_STORAGE_KEY,
} from '#/lib/theme'

const DISPLAY_MODE_OPTIONS: Array<{ value: ThemeDisplayMode; label: string }> =
  [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]
const THEME_OPTIONS: Array<{
  value: ThemePaletteMode
  label: string
  swatchLight: string
  swatchDark: string
}> = [
  {
    value: 'classic',
    label: 'Classic',
    swatchLight: '#efe6d3',
    swatchDark: '#141218',
  },
  {
    value: 'paper',
    label: 'Paper',
    swatchLight: '#f1eee6',
    swatchDark: '#121110',
  },
  {
    value: 'sakura',
    label: 'Sakura',
    swatchLight: '#f4e7ec',
    swatchDark: '#170f14',
  },
  {
    value: 'ocean',
    label: 'Ocean',
    swatchLight: '#dce8f2',
    swatchDark: '#0b1721',
  },
  {
    value: 'matcha',
    label: 'Matcha',
    swatchLight: '#e8ecd9',
    swatchDark: '#10180f',
  },
]

function formatThemeModeLabel(
  palette: ThemePaletteMode,
  displayMode: ThemeDisplayMode,
): string {
  const paletteLabel =
    THEME_OPTIONS.find((option) => option.value === palette)?.label ?? 'Classic'
  return `${paletteLabel} · ${displayMode === 'dark' ? 'Dark' : 'Light'}`
}

function resolveThemeMode(
  palette: ThemePaletteMode,
  displayMode: ThemeDisplayMode,
): ThemeMode {
  if (palette === 'classic') {
    return displayMode === 'dark' ? 'dark' : 'light'
  }

  return displayMode === 'dark'
    ? (`${palette}-dark` as ThemeMode)
    : (palette as ThemeMode)
}

function themePaletteFromMode(themeMode: ThemeMode): ThemePaletteMode {
  if (themeMode === 'paper' || themeMode === 'paper-dark') {
    return 'paper'
  }
  if (themeMode === 'sakura' || themeMode === 'sakura-dark') {
    return 'sakura'
  }
  if (themeMode === 'ocean' || themeMode === 'ocean-dark') {
    return 'ocean'
  }
  if (themeMode === 'matcha' || themeMode === 'matcha-dark') {
    return 'matcha'
  }
  return 'classic'
}

function themeDisplayModeFromTheme(themeMode: ThemeMode): ThemeDisplayMode {
  return themeMode === 'dark' || themeMode.endsWith('-dark') ? 'dark' : 'light'
}

function mapPaletteToLegacyLightTheme(
  value: ThemePaletteMode,
): 'light' | 'paper' | 'sakura' | 'ocean' | 'matcha' {
  return value === 'classic' ? 'light' : value
}

export function AppShell({
  children,
  supportUrl,
}: {
  children: React.ReactNode
  supportUrl: string
}) {
  const currentYear = new Date().getFullYear()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [themeDockOpen, setThemeDockOpen] = useState(false)
  const themeDockRef = useRef<HTMLDivElement | null>(null)
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
      const nextTheme =
        window.localStorage.getItem(THEME_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY)
      const nextThemeValue = nextTheme ?? undefined

      if (!nextThemeValue) {
        const legacyTheme = window.localStorage.getItem(
          LEGACY_THEME_STORAGE_KEY,
        )
        if (legacyTheme) {
          window.localStorage.setItem(THEME_STORAGE_KEY, legacyTheme)
        }
      }
    }

    setMounted(true)
  }, [])

  useEffect(() => {
    if (!themeDockOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!themeDockRef.current) {
        return
      }

      const target = event.target
      if (target instanceof Node && !themeDockRef.current.contains(target)) {
        setThemeDockOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setThemeDockOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [themeDockOpen])

  const resolvedThemeMode = theme === 'system' ? resolvedTheme : theme
  const selectedTheme =
    mounted && isThemeMode(resolvedThemeMode) ? resolvedThemeMode : 'light'
  const selectedDisplayMode = themeDisplayModeFromTheme(selectedTheme)
  const selectedThemePalette = themePaletteFromMode(selectedTheme)
  const selectedThemeLabel = formatThemeModeLabel(
    selectedThemePalette,
    selectedDisplayMode,
  )
  const isReaderRoute =
    pathname.startsWith('/reader/') || pathname.startsWith('/weebcentral/')

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem('tsuki-theme-palette.v1', selectedThemePalette)
    window.localStorage.setItem(
      'tsuki-light-theme-mode.v1',
      mapPaletteToLegacyLightTheme(selectedThemePalette),
    )
  }, [selectedThemePalette])

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

    document.documentElement.style.colorScheme =
      selectedTheme.endsWith('-dark') || selectedTheme === 'dark'
        ? 'dark'
        : 'light'
  }, [selectedTheme])

  const switchDisplayMode = (mode: ThemeDisplayMode) => {
    setTheme(resolveThemeMode(selectedThemePalette, mode))
  }

  const switchThemePalette = (palette: ThemePaletteMode) => {
    setTheme(resolveThemeMode(palette, selectedDisplayMode))
    setThemeDockOpen(false)
  }

  if (isReaderRoute) {
    return <main id="main-content">{children}</main>
  }

  return (
    <div className="app-canvas min-h-screen bg-background pb-24 text-foreground md:pb-10">
      <header className="ui-shell-top-safe mx-auto max-w-3xl px-4 md:px-8">
        <div className="exp-toolbar flex items-center justify-between gap-3">
          <Link
            to="/"
            className="vt-logo group flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten"
          >
            <BookOpenText
              className="size-[18px] text-[var(--koten)]"
              aria-hidden
            />
            <span className="manga-title text-[15px] font-extrabold tracking-tight">
              Tsuki
            </span>
          </Link>

          <div className="top-toolbar-actions">
            <a
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="theme-support-trigger"
              aria-label="Support Tsuki on Buy Me a Coffee"
              title="Support Tsuki"
            >
              <Coffee className="size-4 support-coffee-icon" aria-hidden />
            </a>

            <div className="theme-dock" ref={themeDockRef}>
              {themeDockOpen ? (
                <div
                  id="theme-dock-panel"
                  className="theme-dock-panel animate-enter"
                >
                  <p className="theme-dock-heading">Mode</p>
                  <p className="theme-dock-subline">
                    Reading mood: {selectedThemeLabel}
                  </p>
                  <div
                    className="theme-dock-mode-row"
                    role="radiogroup"
                    aria-label="Display mode"
                  >
                    {DISPLAY_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="theme-dock-mode-button"
                        role="radio"
                        aria-checked={selectedDisplayMode === option.value}
                        data-active={selectedDisplayMode === option.value}
                        onClick={() => switchDisplayMode(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <p className="theme-dock-heading mt-3">Theme</p>
                  <ul
                    className="theme-dock-theme-list"
                    role="radiogroup"
                    aria-label="Theme palette"
                  >
                    {THEME_OPTIONS.map((option) => (
                      <li key={option.value}>
                        <button
                          type="button"
                          className="theme-dock-theme-button"
                          role="radio"
                          aria-checked={selectedThemePalette === option.value}
                          data-active={selectedThemePalette === option.value}
                          onClick={() => switchThemePalette(option.value)}
                        >
                          <span
                            className="theme-dock-swatch"
                            aria-hidden
                            style={{
                              background:
                                selectedDisplayMode === 'dark'
                                  ? option.swatchDark
                                  : option.swatchLight,
                            }}
                          />
                          {option.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <button
                type="button"
                className="theme-dock-trigger"
                aria-label={
                  themeDockOpen ? 'Close theme controls' : 'Open theme controls'
                }
                aria-expanded={themeDockOpen}
                aria-controls="theme-dock-panel"
                data-open={themeDockOpen}
                onClick={() => setThemeDockOpen((open) => !open)}
              >
                <Palette className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="ui-shell-bottom-safe mx-auto mt-4 max-w-3xl px-4 md:px-8"
      >
        {children}
      </main>

      <footer className="ui-shell-bottom-safe mx-auto mt-6 max-w-3xl px-4 pb-6 text-xs text-muted-foreground md:px-8">
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
          <p className="mt-1">
            © {currentYear} Tsuki Reader. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
