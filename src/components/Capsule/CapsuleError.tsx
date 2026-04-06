import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../stores/appStore'

export function CapsuleError() {
  const pipelineError = useAppStore((s) => s.pipelineError)
  const setPipelineError = useAppStore((s) => s.setPipelineError)
  const setPipelineState = useAppStore((s) => s.setPipelineState)
  const resetRecording = useAppStore((s) => s.resetRecording)

  useEffect(() => {
    const timer = setTimeout(() => {
      setPipelineError(null)
      resetRecording()
      setPipelineState('idle')
    }, 4000)
    return () => clearTimeout(timer)
  }, [setPipelineError, resetRecording, setPipelineState])

  return (
    <motion.div
      className="relative z-10 flex items-start gap-2 px-3 py-2"
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Warning icon */}
      <motion.svg
        className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-400"
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path d="M8 1.5l6.5 12h-13L8 1.5zM7 6v3h2V6H7zm0 4v1.5h2V10H7z" />
      </motion.svg>
      <p className="text-[11px] text-white leading-relaxed flex-1 break-words">
        {pipelineError || 'An error occurred'}
      </p>
    </motion.div>
  )
}
