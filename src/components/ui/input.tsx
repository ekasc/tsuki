import type * as React from 'react'

import { cn } from '#/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'h-10 w-full border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground hover:bg-washi focus:border-koten/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten/40',
        className,
      )}
      {...props}
    />
  )
}
