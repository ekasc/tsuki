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
    const media = window.matchMedia('(orientation: portrait)')

    const update = () => {
      setIsTouchPortrait(getTouchPortraitState())
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    media.addEventListener('change', update)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      media.removeEventListener('change', update)
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

    const update = () => {
      setIsTouchDevice(getTouchDeviceState())
    }

    update()
    window.addEventListener('resize', update)
    pointer.addEventListener('change', update)

    return () => {
      window.removeEventListener('resize', update)
      pointer.removeEventListener('change', update)
    }
  }, [])

  return isTouchDevice
}
