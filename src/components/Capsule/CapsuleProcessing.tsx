import { motion, useReducedMotion } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'

export function CapsuleProcessing() {
  const partialTranscript = useAppStore((s) => s.partialTranscript)
  const resetRecording = useAppStore((s) => s.resetRecording)
  const setPipelineState = useAppStore((s) => s.setPipelineState)
  const reduced = useReducedMotion()

  const displayText = partialTranscript || 'Transcribing...'

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    resetRecording()
    setPipelineState('idle')
  }

  return (
    <motion.div className="relative z-10 flex items-start gap-2 px-3 py-2">
      {/* Shimmer sweep overlay */}
      <div className="capsule-shimmer" />
      <motion.div
        className="flex-shrink-0 mt-0.5"
        animate={reduced ? undefined : { rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
      >
        <Loader2 size={12} className="text-white/80" />
      </motion.div>
      <p className="text-[11px] text-white leading-relaxed flex-1 min-w-0 break-words">
        {displayText}
        <motion.span
          className="inline-block w-[2px] h-[11px] bg-white/60 ml-0.5 align-middle"
          animate={reduced ? undefined : { opacity: [1, 0, 1] }}
          transition={{ repeat: Infinity, duration: 0.8 }}
        />
      </p>
      <button
        onClick={handleCancel}
        aria-label="Cancel processing"
        className="flex-shrink-0 p-1 rounded-full text-white/70 hover:text-white hover:bg-white/15 transition-colors bg-transparent border-none cursor-pointer"
      >
        <X size={12} />
      </button>
    </motion.div>
  )
}
