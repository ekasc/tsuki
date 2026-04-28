import type * as React from 'react'

import { cn } from '#/lib/utils'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export interface SelectOption {
  value: string
  label: string
}

interface SelectFieldProps extends SelectProps {
  options: SelectOption[]
}

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        'h-10 w-full border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors duration-150 hover:bg-washi focus:border-koten/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten/40',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function SelectField({ options, ...props }: SelectFieldProps) {
  return (
    <Select {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  )
}
