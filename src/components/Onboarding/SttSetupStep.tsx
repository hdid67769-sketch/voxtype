import { useTranslation } from 'react-i18next'

export function SttSetupStep() {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      <div className="border border-green-200 dark:border-green-800 rounded-[10px] px-4 py-3 space-y-2 bg-green-50/50 dark:bg-green-950/20">
        <p className="text-[13px] font-medium text-green-600 dark:text-green-400">
          Local SenseVoice (Offline)
        </p>
        <p className="text-[11px] text-text-secondary">
          {t('settings.localSenseVoiceNote')}
        </p>
      </div>
    </div>
  )
}
