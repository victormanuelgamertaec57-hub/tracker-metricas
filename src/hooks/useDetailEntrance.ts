import { useEffect, useState } from 'react'

/** One clock for the score, category chip and all metric rings. */
export function useDetailEntrance(creativeId: string) {
  const [frame, setFrame] = useState(() => ({
    id: creativeId,
    progress: typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0,
  }))

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let raf: number | undefined
    let start: number | undefined
    const cancel = () => { if (raf !== undefined) cancelAnimationFrame(raf) }
    const finish = () => {
      cancel()
      setFrame({ id: creativeId, progress: 1 })
    }
    const tick = (timestamp: number) => {
      start ??= timestamp
      const elapsed = Math.min((timestamp - start) / 1200, 1)
      setFrame({ id: creativeId, progress: 1 - (1 - elapsed) ** 3 })
      if (elapsed < 1) raf = requestAnimationFrame(tick)
    }
    if (!preference || preference.matches) finish()
    else {
      setFrame({ id: creativeId, progress: 0 })
      raf = requestAnimationFrame(tick)
    }
    const onPreferenceChange = () => { if (preference?.matches) finish() }
    preference?.addEventListener('change', onPreferenceChange)
    return () => {
      cancel()
      preference?.removeEventListener('change', onPreferenceChange)
    }
  }, [creativeId])

  if (frame.id === creativeId) return frame.progress
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0
}
