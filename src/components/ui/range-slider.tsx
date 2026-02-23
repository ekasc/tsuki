import type * as React from 'react'

import { cn } from '#/lib/utils'

export interface RangeSliderProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

export function RangeSlider({ className, ...props }: RangeSliderProps) {
  return (
    <input
      type="range"
      className={cn(
        'h-2 w-full cursor-pointer appearance-none accent-primary transition-opacity duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
