import { useEffect, useRef } from 'react'
import { useAppStore, type PipelineState } from '../stores/appStore'

/** Re-assert always-on-top so the capsule stays visible above all windows. */
async function bringToFront(win: import('@tauri-apps/api/window').Window) {
  await win.setAlwaysOnTop(true).catch(() => {})
  await win.show().catch(() => {})
}

interface CapsuleSize {
  width: number
  height: number
}

function getSizeForState(state: PipelineState, expanded: boolean, hasError: boolean, contextMenuOpen: boolean): CapsuleSize {
  if (contextMenuOpen) return { width: 220, height: 220 }
  if (hasError) return { width: 300, height: 56 }
  if (expanded) return { width: 220, height: 90 }
  switch (state) {
    case 'idle':
      return { width: 36, height: 36 }
    case 'recording':
      return { width: 200, height: 36 }
    case 'transcribing':
    case 'polishing':
      return { width: 300, height: 56 }
    case 'outputting':
      return { width: 120, height: 36 }
    default:
      return { width: 36, height: 36 }
  }
}

/** States where the capsule window should be visible */
function shouldShowWindow(state: PipelineState, hasError: boolean, contextMenuOpen: boolean): boolean {
  if (contextMenuOpen) return true
  if (hasError) return true
  return state !== 'idle'
}

export function useCapsuleResize() {
  const pipelineState = useAppStore((s) => s.pipelineState)
  const capsuleExpanded = useAppStore((s) => s.capsuleExpanded)
  const pipelineError = useAppStore((s) => s.pipelineError)
  const contextMenuOpen = useAppStore((s) => s.contextMenuOpen)
  const setContextMenuReady = useAppStore((s) => s.setContextMenuReady)
  const initialized = useRef(false)
  const prevWindowSize = useRef<{ width: number; height: number } | null>(null)

  const hasError = pipelineError !== null

  useEffect(() => {
    const size = getSizeForState(pipelineState, capsuleExpanded, hasError, contextMenuOpen)
    const windowWidth = size.width
    const windowHeight = size.height

    import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor }) => {
        const win = getCurrentWindow()

        if (!initialized.current) {
          // First mount: position at bottom-center of screen
          await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
          try {
            const monitor = await currentMonitor()
            if (monitor) {
              const sw = monitor.size.width / monitor.scaleFactor
              const sh = monitor.size.height / monitor.scaleFactor
              const x = Math.round(sw / 2 - windowWidth / 2)
              const y = Math.round(sh - windowHeight - 80)
              await win.setPosition(new LogicalPosition(x, y)).catch(() => {})
            }
          } catch {
            /* ignore – monitor info unavailable */
          }
          // Only show window if not idle (user may have launched app without pressing shortcut)
          if (shouldShowWindow(pipelineState, hasError, contextMenuOpen)) {
            await bringToFront(win)
          }
          initialized.current = true
          prevWindowSize.current = { width: windowWidth, height: windowHeight }
          return
        }

        // Show/hide based on state
        const show = shouldShowWindow(pipelineState, hasError, contextMenuOpen)
        if (!show) {
          await win.hide().catch(() => {})
          prevWindowSize.current = { width: windowWidth, height: windowHeight }
          return
        }

        // Show and resize
        await bringToFront(win)

        // Re-center on screen when becoming visible from idle
        if (prevWindowSize.current && prevWindowSize.current.width <= 36 && prevWindowSize.current.height <= 36) {
          try {
            const monitor = await currentMonitor()
            if (monitor) {
              const sw = monitor.size.width / monitor.scaleFactor
              const sh = monitor.size.height / monitor.scaleFactor
              const x = Math.round(sw / 2 - windowWidth / 2)
              const y = Math.round(sh - windowHeight - 80)
              await win.setPosition(new LogicalPosition(x, y)).catch(() => {})
            }
          } catch {
            /* ignore */
          }
        }

        // Subsequent resizes: left edge + vertical center stay fixed.
        const prev = prevWindowSize.current
        if (prev) {
          const pos = await win.outerPosition().catch(() => null)
          if (pos) {
            const monitor = await currentMonitor()
            const scale = monitor?.scaleFactor ?? 1
            const oldLeftX = pos.x / scale
            const oldCenterY = pos.y / scale + prev.height / 2
            const newX = Math.round(oldLeftX)
            const newY = Math.round(oldCenterY - windowHeight / 2)
            await win.setPosition(new LogicalPosition(newX, newY)).catch(() => {})
            await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
          } else {
            await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
          }
        } else {
          await win.setSize(new LogicalSize(windowWidth, windowHeight)).catch(() => {})
        }

        prevWindowSize.current = { width: windowWidth, height: windowHeight }

        // Signal that the window has finished resizing for context menu
        if (contextMenuOpen) {
          setContextMenuReady(true)
        }
      })
      .catch(() => {})
  }, [pipelineState, capsuleExpanded, hasError, contextMenuOpen, setContextMenuReady])

  return getSizeForState(pipelineState, capsuleExpanded, hasError, contextMenuOpen)
}
