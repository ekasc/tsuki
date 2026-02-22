import type * as React from 'react'

import { cn } from '#/lib/utils'

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {}

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
        'w-full rounded-xl border border-border bg-surface-soft px-3 py-2 text-sm text-foreground outline-none transition-colors duration-200 focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
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
