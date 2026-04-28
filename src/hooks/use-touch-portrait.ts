import { useEffect, useState } from 'react'

function getTouchDeviceState() {
  if (typeof window === 'undefined') {
    return false
  }

  return (
    window.matchMedia('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0
  )
}

function getTouchPortraitState() {
  if (typeof window === 'undefined') {
    return false
  }

  const hasTouchPointer = getTouchDeviceState()
  const isPortrait =
    window.matchMedia('(orientation: portrait)').matches ||
    window.innerHeight >= window.innerWidth

  return hasTouchPointer && isPortrait
}

export function useTouchPortrait() {
  const [isTouchPortrait, setIsTouchPortrait] = useState<boolean>(() =>
    getTouchPortraitState(),
  )

  useEffect(() => {
    const orientationMedia = window.matchMedia('(orientation: portrait)')
    const pointerMedia = window.matchMedia('(pointer: coarse)')

    let lastValue = getTouchPortraitState()

    const update = () => {
      const next = getTouchPortraitState()
      if (next !== lastValue) {
        lastValue = next
        setIsTouchPortrait(next)
      }
    }

    orientationMedia.addEventListener('change', update)
    pointerMedia.addEventListener('change', update)

    return () => {
      orientationMedia.removeEventListener('change', update)
      pointerMedia.removeEventListener('change', update)
    }
  }, [])

  return isTouchPortrait
}

export function useTouchDevice() {
  const [isTouchDevice, setIsTouchDevice] = useState<boolean>(() =>
    getTouchDeviceState(),
  )

  useEffect(() => {
    const pointer = window.matchMedia('(pointer: coarse)')

    let lastValue = getTouchDeviceState()

    const update = () => {
      const next = getTouchDeviceState()
      if (next !== lastValue) {
        lastValue = next
        setIsTouchDevice(next)
      }
    }

    pointer.addEventListener('change', update)

    return () => {
      pointer.removeEventListener('change', update)
    }
  }, [])

  return isTouchDevice
}
