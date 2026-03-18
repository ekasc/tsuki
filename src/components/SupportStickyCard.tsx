import { Coffee } from 'lucide-react'

const DEFAULT_SUPPORT_URL = 'https://www.buymeacoffee.com/'

function resolveSupportUrl(): string {
  const configured = import.meta.env.VITE_SUPPORT_URL?.trim()
  if (configured && configured.length > 0) {
    return configured
  }

  return DEFAULT_SUPPORT_URL
}

export function SupportStickyCard() {
  const supportUrl = resolveSupportUrl()

  return (
    <aside className="ui-support-sticky border border-border/70 bg-surface-soft/92 p-2.5">
      <p className="text-xs font-medium text-foreground">Enjoying Tsuki?</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Keep the pages turning.
      </p>
      <a
        href={supportUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="delight-support-link mt-2 inline-flex h-11 w-full items-center justify-center gap-1.5 border border-border bg-surface px-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Support Tsuki on Buy Me a Coffee"
      >
        <Coffee className="support-coffee-icon size-4" aria-hidden />
        Support
      </a>
    </aside>
  )
}
