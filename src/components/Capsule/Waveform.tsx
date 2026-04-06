import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useAppStore } from '../../stores/appStore'

const BAR_COUNT = 20
const MIN_HEIGHT = 3
const MAX_HEIGHT = 36

export function Waveform() {
  const barsRef = useRef<(HTMLDivElement | null)[]>([])
  const rafRef = useRef<number>(0)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) {
      // Static bars at mid-height when reduced motion is preferred
      barsRef.current.forEach((bar) => {
        if (!bar) return
        bar.style.height = `${(MIN_HEIGHT + MAX_HEIGHT) / 2}px`
        bar.style.opacity = '0.7'
      })
      return
    }

    const animate = () => {
      const volume = useAppStore.getState().audioVolume
      const now = Date.now()
      barsRef.current.forEach((bar, i) => {
        if (!bar) return
        // Each bar has a unique phase offset for a wave-like visual
        const phase = (i / BAR_COUNT) * Math.PI * 2
        // Sinusoidal offset creates a wave pattern across bars
        // Dual-frequency wave for richer, more organic movement
        const wave = Math.sin(now / 140 + phase) * 0.25
          + Math.sin(now / 90 + phase * 1.5) * 0.08
        // Power curve (< 1) lifts quiet sounds, (> 1) pushes louder sounds higher
        // 0.5 (sqrt) gives the widest visual dynamic range
        const vol = Math.pow(volume, 0.5)
        const normalized = Math.max(0, Math.min(1, vol + wave))
        const height = MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * normalized
        const opacity = Math.max(0.25, normalized * 0.85 + 0.15)
        bar.style.height = `${height}px`
        bar.style.opacity = `${opacity}`
      })
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [reduced])

  return (
    <div className="flex items-center justify-center gap-[2px] h-9">
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          ref={(el) => {
            barsRef.current[i] = el
          }}
          className="w-[2px] rounded-full bg-white/90"
          style={{
            height: `${MIN_HEIGHT}px`,
            opacity: 0.25,
            transition: 'height 50ms ease-out, opacity 50ms ease-out',
          }}
        />
      ))}
    </div>
  )
}
