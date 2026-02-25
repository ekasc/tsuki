import { useEffect, useMemo, useState } from 'react'

export type DevicePlatform = 'ios' | 'android' | 'desktop'
export type DeviceFormFactor = 'phone' | 'tablet' | 'desktop'

interface DeviceProfile {
  platform: DevicePlatform
  formFactor: DeviceFormFactor
  isStandalonePwa: boolean
}

function detectPlatform(): DevicePlatform {
  if (typeof navigator === 'undefined') {
    return 'desktop'
  }

  const userAgent = navigator.userAgent.toLowerCase()
  const isTouchMac =
    /macintosh|mac os x/.test(userAgent) && navigator.maxTouchPoints > 1

  if (/iphone|ipad|ipod/.test(userAgent) || isTouchMac) {
    return 'ios'
  }

  if (/android/.test(userAgent)) {
    return 'android'
  }

  return 'desktop'
}

function detectFormFactor(platform: DevicePlatform): DeviceFormFactor {
  if (typeof window === 'undefined') {
    return 'desktop'
  }

  const hasFinePointer = window.matchMedia('(pointer: fine)').matches
  if (platform === 'desktop' && hasFinePointer) {
    return 'desktop'
  }

  const width = Math.min(window.innerWidth, window.innerHeight)
  return width >= 768 ? 'tablet' : 'phone'
}

function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const iOSStandalone =
    'standalone' in navigator &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const mediaStandalone = window.matchMedia(
    '(display-mode: standalone)',
  ).matches
  return iOSStandalone || mediaStandalone
}

export function useDeviceProfile(): DeviceProfile {
  const [platform, setPlatform] = useState<DevicePlatform>('desktop')
  const [formFactor, setFormFactor] = useState<DeviceFormFactor>('desktop')
  const [isStandalonePwa, setIsStandalonePwa] = useState(false)

  useEffect(() => {
    const nextPlatform = detectPlatform()

    const update = () => {
      setPlatform(nextPlatform)
      setFormFactor(detectFormFactor(nextPlatform))
      setIsStandalonePwa(detectStandaloneMode())
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)

    const standaloneQuery = window.matchMedia('(display-mode: standalone)')
    standaloneQuery.addEventListener?.('change', update)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      standaloneQuery.removeEventListener?.('change', update)
    }
  }, [])

  return useMemo(
    () => ({
      platform,
      formFactor,
      isStandalonePwa,
    }),
    [formFactor, isStandalonePwa, platform],
  )
}
