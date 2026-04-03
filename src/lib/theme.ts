export type ThemePaletteMode = 'classic' | 'paper' | 'sakura' | 'ocean' | 'matcha'
export type ThemeDisplayMode = 'light' | 'dark'
export type ThemeMode =
  | 'light'
  | 'dark'
  | 'paper'
  | 'paper-dark'
  | 'sakura'
  | 'sakura-dark'
  | 'ocean'
  | 'ocean-dark'
  | 'matcha'
  | 'matcha-dark'

export const THEME_STORAGE_KEY = 'tsuki-theme-mode.v1'
export const LEGACY_THEME_STORAGE_KEY = 'suki-theme-mode.v1'

export const THEME_COLOR_BY_MODE: Record<ThemeMode, string> = {
  light: '#1d140d',
  dark: '#1c1823',
  paper: '#181715',
  'paper-dark': '#201c19',
  sakura: '#3d1f31',
  'sakura-dark': '#28131f',
  ocean: '#162331',
  'ocean-dark': '#102230',
  matcha: '#22301d',
  'matcha-dark': '#1a2616',
}

export function isThemeMode(value: string | undefined): value is ThemeMode {
  return value != null && value in THEME_COLOR_BY_MODE
}

export function getThemeBootstrapScript() {
  const serializedThemeColors = JSON.stringify(THEME_COLOR_BY_MODE)

  return `(() => {
    const storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
    const legacyStorageKey = ${JSON.stringify(LEGACY_THEME_STORAGE_KEY)};
    const themeColors = ${serializedThemeColors};
    const storedTheme = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey);

    if (!storedTheme || !(storedTheme in themeColors)) {
      return;
    }

    document.documentElement.setAttribute('data-theme', storedTheme);
    document.documentElement.style.colorScheme = storedTheme.endsWith('-dark') || storedTheme === 'dark' ? 'dark' : 'light';

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', themeColors[storedTheme]);
    }
  })();`
}
