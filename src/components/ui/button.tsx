import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '#/lib/utils'

const buttonVariants = cva(
  'inline-flex min-w-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-sm text-sm font-semibold transition-[opacity,color,background-color,border-color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        default:
          'border border-koten/20 bg-koten text-[var(--active-contrast)] hover:bg-koten/90',
        secondary:
          'border border-border bg-secondary text-secondary-foreground hover:bg-surface-soft',
        soft: 'border border-border bg-surface text-foreground hover:bg-washi',
        outline:
          'border border-border bg-background text-foreground hover:bg-washi',
        ghost:
          'border-transparent bg-transparent text-muted-foreground hover:bg-washi hover:text-foreground',
        destructive:
          'border border-destructive/30 bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-10 px-3 text-xs',
        lg: 'h-10 px-6',
        icon: 'size-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
