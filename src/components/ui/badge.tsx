import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '#/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        default: 'border-primary/45 bg-primary/10 text-primary',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border-strong bg-background text-foreground',
        accent: 'border-accent/40 bg-accent-soft text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}
