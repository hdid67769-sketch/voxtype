import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useEffect, useRef, useCallback, useState } from 'react'
import { getLocalModelStatus, resetLocalModel, type LocalModelStatus } from '../../lib/tauri'
import { CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react'

/// Format seconds into human-readable string: "1m 23s"
function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export function SttPane() {
  const { t } = useTranslation()

  // ─── Local model status state ──────────────────────────────
  const [modelStatus] = useLocalModelStatus(true)

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Local SenseVoice model status card */}
      <ModelStatusCard status={modelStatus} t={t} />

      {/* Local mode note */}
      <p className="text-[11px] text-text-secondary">
        ⚡ {t('settings.localSenseVoiceNote')}
      </p>
    </div>
  )
}

// ─── Model Status Card Component ──────────────────────────────

function ModelStatusCard({
  status,
  t,
}: {
  status: LocalModelStatus | null
  t: TFunction
}) {
  if (!status) return null

  switch (status.status) {
    case 'loading': {
      const elapsed = formatElapsed(status.elapsedSecs)
      return (
        <div className="border border-green-200 dark:border-green-800 rounded-[10px] px-4 py-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <Loader2 size={18} className="text-green-500 shrink-0 animate-spin" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-text-primary">
                {t('settings.modelLoading')}
              </p>
              <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                {status.message || t('settings.modelLoadingDesc')}
              </p>
            </div>
            <span className="text-[11px] text-text-secondary tabular-nums shrink-0 whitespace-nowrap">
              {elapsed}
            </span>
          </div>

          {/* Indeterminate progress bar */}
          <div className="w-full h-1.5 bg-green-100 dark:bg-green-900/30 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-green-400 to-emerald-400 rounded-full animate-pulse" />
          </div>

          <p className="text-[10px] text-text-secondary">
            ⏱ {t('settings.modelLoadTime')}
          </p>
        </div>
      )
    }

    case 'ready':
      return (
        <div className="border border-green-200 dark:border-green-800 rounded-[10px] px-4 py-3 space-y-2 bg-green-50/50 dark:bg-green-950/20">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={16} className="text-green-500 shrink-0" />
            <div>
              <p className="text-[13px] font-medium text-green-600 dark:text-green-400">
                {t('settings.modelReady')}
              </p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                {t('settings.localSenseVoiceInfo')}
              </p>
            </div>
          </div>
        </div>
      )

    case 'failed':
      return (
        <div className="border border-red-200 dark:border-red-800 rounded-[10px] px-4 py-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-red-600 dark:text-red-400">
                {t('settings.modelError')}
              </p>
              <p className="text-[11px] text-text-secondary mt-1 break-all">
                {status.message || t('settings.modelErrorUnknown')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={async () => {
                try {
                  await resetLocalModel()
                  window.location.reload()
                } catch {
                  window.location.reload()
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors cursor-pointer"
            >
              <RefreshCw size={12} />
              {t('settings.modelRetry')}
            </button>
          </div>
          <p className="text-[10px] text-text-secondary">
            💡 {t('settings.modelErrorTip')}
          </p>
        </div>
      )
  }

  // Fallback (shouldn't reach here with proper typing)
  return null
}

// ─── Custom hook: poll local model status ─────────────────────

/**
 * Polls the Rust backend for SenseVoice model loading status.
 * Auto-polls every 2s when active and status is "loading".
 */
function useLocalModelStatus(active: boolean): [
  LocalModelStatus | null,
  React.Dispatch<React.SetStateAction<LocalModelStatus | null>>
] {
  const [modelStatus, setModelStatus] = useState<LocalModelStatus | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async (): Promise<boolean> => {
    try {
      const status = await getLocalModelStatus()
      setModelStatus(status)
      return status.status === 'loading'
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    if (!active) {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setModelStatus(null)
      return
    }

    // Initial fetch immediately
    poll()

    timerRef.current = setInterval(() => {
      poll().then((keepPolling) => {
        if (!keepPolling && timerRef.current !== null) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
      })
    }, 2000)

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [active, poll])

  return [modelStatus, setModelStatus]
}
