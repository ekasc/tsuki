import { ChevronDown } from 'lucide-react'
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
    <div className="relative">
      <select
        className={cn(
          'h-10 w-full appearance-none border border-border bg-surface pl-3 pr-10 text-sm text-foreground outline-none transition-colors duration-150 hover:bg-washi focus:border-koten/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-koten/40',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
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
