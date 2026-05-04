import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '../../stores/appStore'
import { saveOnboardingCompleted, updateConfig as saveConfig } from '../../lib/tauri'
import { OnboardingLayout } from './OnboardingLayout'
import { WelcomeStep } from './WelcomeStep'
import { AccountStep } from './AccountStep'
import { QuickTestStep } from './QuickTestStep'
import { DoneStep } from './DoneStep'
import { slideRight } from '../../lib/animations'

// Cloud-only: removed ModeSelectStep, SttSetupStep, LlmSetupStep
const TOTAL_STEPS = 4

export function Onboarding() {
  const step = useAppStore((s) => s.onboardingStep)
  const setStep = useAppStore((s) => s.setOnboardingStep)
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted)
  const updateConfig = useAppStore((s) => s.updateConfig)

  // Cloud-only: simplified step validation
  const canNext = (() => {
    switch (step) {
      case 0:
        return true // Welcome — always
      case 1:
        return true // Account — can skip
      case 2:
        return true // Quick test — optional
      case 3:
        return true // Done
      default:
        return false
    }
  })()

  const titles = [
    {
      title: 'Welcome to VoxType',
      subtitle: 'A few quick steps to get started with voice input',
    },
    {
      title: 'Sign In',
      subtitle: 'Sign in to get free cloud minutes, or skip to try it out',
    },
    {
      title: 'How It Works',
      subtitle: 'See the full pipeline in action — from voice to polished text',
    },
    { title: 'Setup Complete', subtitle: undefined },
  ]

  const config = useAppStore((s) => s.config)

  const handleNext = async () => {
    if (step < TOTAL_STEPS - 1) {
      // Auto-set providers after account step
      if (step === 1) {
        updateConfig({ stt_provider: 'local-sensevoice', llm_provider: 'cloud' })
        try {
          await saveConfig({ ...config, stt_provider: 'local-sensevoice', llm_provider: 'cloud' })
        } catch {
          // Best-effort save
        }
      }
      try {
        await saveConfig(config)
      } catch {
        // Best-effort save — continue navigation even if save fails
      }
      setStep(step + 1)
    } else {
      await saveConfig(config)
      await saveOnboardingCompleted()
      setOnboardingCompleted(true)
    }
  }

  const handleBack = async () => {
    if (step > 0) {
      try {
        await saveConfig(config)
      } catch {
        // Best-effort save
      }
      setStep(step - 1)
    }
  }

  const handleSkip = async () => {
    // Skip → set local-sensevoice mode and jump to quick test
    updateConfig({ stt_provider: 'local-sensevoice', llm_provider: 'cloud' })
    try {
      await saveConfig({ ...config, stt_provider: 'local-sensevoice', llm_provider: 'cloud' })
    } catch {
      // Best-effort save
    }
    setStep(2)
  }

  return (
    <OnboardingLayout
      step={step}
      totalSteps={TOTAL_STEPS}
      title={titles[step].title}
      subtitle={titles[step].subtitle}
      canNext={canNext}
      canBack={step > 0}
      nextLabel={step === TOTAL_STEPS - 1 ? 'Get Started' : 'Next'}
      onNext={handleNext}
      onBack={handleBack}
      onSkip={handleSkip}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          variants={slideRight}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.2 }}
        >
          {step === 0 && <WelcomeStep />}
          {step === 1 && <AccountStep />}
          {step === 2 && <QuickTestStep />}
          {step === 3 && <DoneStep />}
        </motion.div>
      </AnimatePresence>
    </OnboardingLayout>
  )
}
