import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '#/lib/utils'

const buttonVariants = cva(
  'inline-flex min-w-0 cursor-pointer items-center justify-center whitespace-nowrap border-2 text-sm font-semibold transition-[transform,color,background-color,border-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-x-px active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary text-primary-foreground shadow-[2px_2px_0_var(--shadow)] hover:bg-primary/92',
        secondary:
          'border-border bg-secondary text-secondary-foreground shadow-[2px_2px_0_var(--shadow)] hover:bg-secondary/84',
        soft: 'border-border bg-surface text-foreground shadow-[2px_2px_0_var(--shadow)] hover:bg-surface-soft',
        outline:
          'border-border bg-background text-foreground hover:bg-surface-soft/75',
        ghost:
          'border-transparent bg-transparent text-foreground hover:bg-surface-soft',
        destructive:
          'border-destructive bg-destructive text-destructive-foreground shadow-[2px_2px_0_var(--shadow)] hover:bg-destructive/92',
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
