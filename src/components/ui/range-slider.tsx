import type * as React from 'react'

import { cn } from '#/lib/utils'

export interface RangeSliderProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

export function RangeSlider({ className, ...props }: RangeSliderProps) {
  return (
    <input
      type="range"
      className={cn(
        'h-11 w-full cursor-pointer appearance-none bg-transparent accent-primary transition-opacity duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-border [&::-webkit-slider-thumb]:-mt-[6px] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-border [&::-moz-range-progress]:h-2 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-primary [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-primary',
        className,
      )}
      {...props}
    />
  )
}
