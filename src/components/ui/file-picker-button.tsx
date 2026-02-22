import * as React from 'react'

import { Button, type ButtonProps } from '#/components/ui/button'

interface FilePickerButtonProps extends Omit<ButtonProps, 'onClick'> {
  accept?: string
  onFileSelect: (file: File) => void
}

export function FilePickerButton({
  accept,
  onFileSelect,
  children,
  ...buttonProps
}: FilePickerButtonProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  return (
    <>
      <Button
        {...buttonProps}
        type="button"
        onClick={() => inputRef.current?.click()}
      >
        {children}
      </Button>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            onFileSelect(file)
          }
          event.currentTarget.value = ''
        }}
      />
    </>
  )
}
