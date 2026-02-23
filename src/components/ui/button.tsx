import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '#/lib/utils'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center whitespace-nowrap border text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary text-primary-foreground hover:bg-primary/92',
        secondary:
          'border-border bg-secondary text-secondary-foreground hover:bg-secondary/80',
        soft: 'border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-soft',
        outline:
          'border-border-strong bg-background text-foreground hover:bg-surface-soft',
        ghost:
          'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-surface-soft hover:text-foreground',
        destructive:
          'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/16',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6',
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
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
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
