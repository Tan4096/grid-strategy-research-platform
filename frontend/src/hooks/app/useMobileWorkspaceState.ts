import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { WorkspaceTab } from "../../components/OptimizationPanel";
import {
  readMobilePrimaryTabFromSession,
  writeMobilePrimaryTabToSession
} from "../../lib/mobileShell";
import {
  AppWorkspaceMode,
  MobilePrimaryTab,
  ParameterMode
} from "../../types";

const OPTIMIZATION_PANEL_TAB_SESSION_KEY = "btc-grid-backtest:optimization-panel-tab:v1";

function readOptimizationWorkspaceTabFromSession(): WorkspaceTab {
  if (typeof window === "undefined") {
    return "runtime";
  }
  try {
    const raw = window.sessionStorage.getItem(OPTIMIZATION_PANEL_TAB_SESSION_KEY);
    if (raw === "runtime" || raw === "results" || raw === "history") {
      return raw;
    }
  } catch {
    // ignore
  }
  return "runtime";
}

interface Params {
  mobileShellEnabled: boolean;
  mobileMinimalLayoutEnabled: boolean;
}

export interface MobileWorkspaceState {
  workspaceMode: AppWorkspaceMode;
  parameterMode: ParameterMode;
  mobilePrimaryTab: MobilePrimaryTab;
  optimizationWorkspaceTab: WorkspaceTab;
  setWorkspaceMode: Dispatch<SetStateAction<AppWorkspaceMode>>;
  setParameterMode: Dispatch<SetStateAction<ParameterMode>>;
  setMobilePrimaryTab: Dispatch<SetStateAction<MobilePrimaryTab>>;
  setOptimizationWorkspaceTab: Dispatch<SetStateAction<WorkspaceTab>>;
  handleWorkspaceModeChange: (nextMode: AppWorkspaceMode) => void;
  handleParameterModeChange: (nextMode: ParameterMode) => void;
  handleMobilePrimaryTabChange: (nextTab: MobilePrimaryTab) => void;
}

export function useMobileWorkspaceState({
  mobileShellEnabled,
  mobileMinimalLayoutEnabled
}: Params): MobileWorkspaceState {
  const [workspaceMode, setWorkspaceMode] = useState<AppWorkspaceMode>("backtest");
  const [parameterMode, setParameterMode] = useState<ParameterMode>("backtest");
  const [mobilePrimaryTab, setMobilePrimaryTab] = useState<MobilePrimaryTab>(() =>
    readMobilePrimaryTabFromSession("params")
  );
  const [optimizationWorkspaceTab, setOptimizationWorkspaceTab] = useState<WorkspaceTab>(
    readOptimizationWorkspaceTabFromSession
  );

  useEffect(() => {
    if (!mobileShellEnabled) {
      return;
    }
    writeMobilePrimaryTabToSession(mobilePrimaryTab);
  }, [mobilePrimaryTab, mobileShellEnabled]);

  useEffect(() => {
    if (!mobileShellEnabled) {
      return;
    }
    setMobilePrimaryTab(readMobilePrimaryTabFromSession("params"));
  }, [mobileShellEnabled]);

  const handleWorkspaceModeChange = useCallback((nextMode: AppWorkspaceMode) => {
    setWorkspaceMode(nextMode);
    if (nextMode === "live") {
      setParameterMode("backtest");
      return;
    }
    setParameterMode(nextMode);
  }, []);

  const handleParameterModeChange = useCallback(
    (nextMode: ParameterMode) => {
      setParameterMode(nextMode);
      if (workspaceMode === "live") {
        return;
      }
      if (!mobileMinimalLayoutEnabled || mobilePrimaryTab !== "params") {
        setWorkspaceMode(nextMode);
      }
    },
    [mobileMinimalLayoutEnabled, mobilePrimaryTab, workspaceMode]
  );

  const handleMobilePrimaryTabChange = useCallback((nextTab: MobilePrimaryTab) => {
    setMobilePrimaryTab(nextTab);
    if (nextTab === "backtest") {
      setParameterMode("backtest");
      setWorkspaceMode("backtest");
      return;
    }
    if (nextTab === "optimize") {
      setParameterMode("optimize");
      setWorkspaceMode("optimize");
      return;
    }
    if (nextTab === "live") {
      setParameterMode("backtest");
      setWorkspaceMode("live");
    }
  }, []);

  return {
    workspaceMode,
    parameterMode,
    mobilePrimaryTab,
    optimizationWorkspaceTab,
    setWorkspaceMode,
    setParameterMode,
    setMobilePrimaryTab,
    setOptimizationWorkspaceTab,
    handleWorkspaceModeChange,
    handleParameterModeChange,
    handleMobilePrimaryTabChange
  };
}
