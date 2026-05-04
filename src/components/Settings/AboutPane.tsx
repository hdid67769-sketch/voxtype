import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Download, CheckCircle, AlertCircle } from 'lucide-react'
import { APP_NAME, APP_VERSION } from '../../lib/constants'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'unavailable'
  | 'error'
  | 'downloading'

function renderUpdateSection(
  status: UpdateStatus,
  version: string,
  notes: string,
  errorMsg: string,
  onCheck: () => void,
  onInstall: () => void,
) {
  if (status === 'checking') {
    return <p className="text-text-tertiary text-[12px]">正在检查更新...</p>
  }

  if (status === 'available') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[13px]">
          <Download size={14} className="text-accent" />
          <span className="text-text-primary font-medium">发现新版本 {version}</span>
        </div>
        {notes && (
          <p className="text-text-secondary text-[12px] leading-relaxed whitespace-pre-line">{notes}</p>
        )}
        <button
          onClick={onInstall}
          className="w-full py-2 rounded-lg text-[13px] font-medium bg-accent text-white
            hover:opacity-90 transition-opacity cursor-pointer border-none"
        >
          立即更新并重启
        </button>
      </div>
    )
  }

  if (status === 'unavailable') {
    return (
      <p className="text-green-600 text-[12px] flex items-center gap-1.5">
        <CheckCircle size={13} />
        当前已是最新版本
      </p>
    )
  }

  if (status === 'downloading') {
    return <p className="text-text-tertiary text-[12px]">正在下载更新...</p>
  }

  if (status === 'error') {
    return (
      <p className="text-red-500 text-[12px] flex items-center gap-1.5">
        <AlertCircle size={13} />
        检查失败：{errorMsg || '未知错误'}
      </p>
    )
  }

  // idle: show check button
  return (
    <button
      onClick={onCheck}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium
        bg-accent/10 text-accent hover:bg-accent/20 transition-colors
        cursor-pointer border-none"
    >
      <RefreshCw size={13} />
      检查更新
    </button>
  )
}

export function AboutPane() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const doCheck = async () => {
    setStatus('checking')
    setErrorMsg('')
    try {
      const u = await check()
      if (u) {
        setVersion(u.version)
        const body = (u as unknown as Record<string, unknown>).body
        setNotes(typeof body === 'string' ? body : '')
        setStatus('available')
      } else {
        setStatus('unavailable')
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  const doInstall = async () => {
    setStatus('downloading')
    try {
      const u = await check()
      if (!u) return
      await u.downloadAndInstall()
      await relaunch()
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  return (
    <div className="space-y-5 text-[13px]">
      {/* Header */}
      <div className="text-center py-6">
        <h2 className="text-[22px] font-semibold text-text-primary">{APP_NAME}</h2>
        <p className="text-text-secondary mt-1 text-[13px]">{APP_VERSION}</p>
      </div>

      <p className="text-text-secondary leading-relaxed">{t('settings.aboutDescription')}</p>

      {/* Update section */}
      <div className="border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-text-primary font-medium text-[13px]">版本更新</span>
          {renderUpdateSection(status, version, notes, errorMsg, doCheck, doInstall)}
        </div>
      </div>
    </div>
  )
}
