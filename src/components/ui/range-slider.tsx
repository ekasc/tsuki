import type * as React from 'react'

import { cn } from '#/lib/utils'

export interface RangeSliderProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

export function RangeSlider({ className, ...props }: RangeSliderProps) {
  return (
    <input
      type="range"
      className={cn(
        'w-full cursor-pointer accent-primary transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
