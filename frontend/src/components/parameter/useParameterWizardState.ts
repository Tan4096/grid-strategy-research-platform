import { useEffect, useMemo, useState } from "react";
import { MobileParameterTab } from "./useParameterFormState";
import { MobileParameterWizardStep } from "../../types";
import { STORAGE_KEYS } from "../../lib/storage";

interface UseParameterWizardStateParams {
  enabled: boolean;
  mobileTabIncompleteCount: Record<MobileParameterTab, number>;
}

interface UseParameterWizardStateResult {
  step: MobileParameterWizardStep;
  stepIndex: number;
  stepCount: number;
  stepIncompleteCount: Record<MobileParameterWizardStep, number>;
  currentStepIncompleteCount: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  goPrev: () => void;
  goNext: () => void;
  goToStep: (nextStep: MobileParameterWizardStep) => void;
  jumpToSubmitStep: () => void;
}

const WIZARD_STEPS: MobileParameterWizardStep[] = [
  "environment",
  "strategy_position",
  "risk_submit"
];

const LAST_STEP_INDEX = WIZARD_STEPS.length - 1;

function normalizeWizardStep(value: unknown): MobileParameterWizardStep | null {
  if (value === "time") {
    return "environment";
  }
  if (
    value === "environment" ||
    value === "strategy_position" ||
    value === "risk_submit"
  ) {
    return value;
  }
  return null;
}

function readWizardStepFromSession(defaultStep: MobileParameterWizardStep): MobileParameterWizardStep {
  if (typeof window === "undefined") {
    return defaultStep;
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.mobileParameterWizardStep);
    return normalizeWizardStep(raw) ?? defaultStep;
  } catch {
    return defaultStep;
  }
}

function writeWizardStepToSession(step: MobileParameterWizardStep): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.mobileParameterWizardStep, step);
  } catch {
    // ignore session storage errors
  }
}

export function useParameterWizardState({
  enabled,
  mobileTabIncompleteCount
}: UseParameterWizardStateParams): UseParameterWizardStateResult {
  const [step, setStep] = useState<MobileParameterWizardStep>(() =>
    readWizardStepFromSession("environment")
  );

  const stepIncompleteCount = useMemo<Record<MobileParameterWizardStep, number>>(
    () => ({
      environment: mobileTabIncompleteCount.env + mobileTabIncompleteCount.time,
      strategy_position: mobileTabIncompleteCount.range + mobileTabIncompleteCount.position,
      risk_submit: mobileTabIncompleteCount.risk
    }),
    [mobileTabIncompleteCount]
  );

  const stepIndex = Math.max(0, WIZARD_STEPS.indexOf(step));
  const currentStepIncompleteCount = stepIncompleteCount[step];
  const canGoPrev = stepIndex > 0;
  const canGoNext = stepIndex < LAST_STEP_INDEX && currentStepIncompleteCount <= 0;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    writeWizardStepToSession(step);
  }, [enabled, step]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setStep(readWizardStepFromSession("environment"));
  }, [enabled]);

  const goPrev = () => {
    setStep((previous) => {
      const previousIndex = Math.max(0, WIZARD_STEPS.indexOf(previous));
      const nextIndex = Math.max(0, previousIndex - 1);
      return WIZARD_STEPS[nextIndex];
    });
  };

  const goNext = () => {
    setStep((previous) => {
      const previousIndex = Math.max(0, WIZARD_STEPS.indexOf(previous));
      const currentIncomplete = stepIncompleteCount[previous];
      if (currentIncomplete > 0) {
        return previous;
      }
      const nextIndex = Math.min(LAST_STEP_INDEX, previousIndex + 1);
      return WIZARD_STEPS[nextIndex];
    });
  };

  const goToStep = (nextStep: MobileParameterWizardStep) => {
    setStep(nextStep);
  };

  const jumpToSubmitStep = () => {
    setStep("risk_submit");
  };

  return {
    step,
    stepIndex,
    stepCount: WIZARD_STEPS.length,
    stepIncompleteCount,
    currentStepIncompleteCount,
    canGoPrev,
    canGoNext,
    goPrev,
    goNext,
    goToStep,
    jumpToSubmitStep
  };
}
