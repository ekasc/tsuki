import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

import { Button } from '#/components/ui/button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught:', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback) {
      return this.props.fallback
    }

    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="exp-surface max-w-md space-y-3 p-6">
          <h2 className="manga-title text-lg font-semibold text-foreground">
            Something went wrong
          </h2>
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred. You can try again or go back to the
            home page.
          </p>
          {this.state.error?.message ? (
            <p className="break-words text-xs text-destructive">
              {this.state.error.message}
            </p>
          ) : null}
          <div className="flex justify-center gap-2 pt-2">
            <Button variant="default" onClick={this.handleReset}>
              Try again
            </Button>
            <Button
              variant="soft"
              onClick={() => {
                window.location.href = '/'
              }}
            >
              Go home
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
