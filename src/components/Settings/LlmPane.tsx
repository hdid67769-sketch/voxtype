import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/appStore'
import { useAuthStore } from '../../stores/authStore'
import { Toggle } from './shared/Toggle'
import { Crown } from 'lucide-react'

export function LlmPane() {
  const config = useAppStore((s) => s.config)
  const updateConfig = useAppStore((s) => s.updateConfig)
  const { user, plan } = useAuthStore()
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      {/* Cloud-only: always show Cloud status card */}
      <div className="border border-border rounded-[10px] px-3 py-3 space-y-2">
        <div className="flex items-center gap-2 text-[13px]">
          <Crown size={14} className="text-accent" />
          <span className="text-text-primary font-medium">{t('settings.cloudLlmPro')}</span>
        </div>
        {!user ? (
          <p className="text-[12px] text-text-secondary">{t('settings.llmSignInHint')}</p>
        ) : plan !== 'pro' ? (
          <p className="text-[12px] text-text-secondary">{t('settings.llmUpgradeHint')}</p>
        ) : (
          <p className="text-[12px] text-green-500">{t('settings.llmProActive')}</p>
        )}
      </div>

      <div className="space-y-3 pt-1">
        <Toggle
          checked={config.polish_enabled}
          onChange={(checked) => updateConfig({ polish_enabled: checked })}
          label={t('settings.enableAiPolish')}
        />
      </div>
    </div>
  )
}
