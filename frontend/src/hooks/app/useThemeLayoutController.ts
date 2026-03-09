import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  applyThemeToDocument,
  cloneThemeSettings,
  createDefaultThemeSettings,
  mergeColorHistories,
  normalizeThemeSettings,
  type ThemeSettings
} from "../../lib/appTheme";
import { readPlain, removeStorage, STORAGE_KEYS, writePlain } from "../../lib/storage";
import type { AppWorkspaceMode } from "../../types";

interface Params {
  isMobileViewport: boolean;
  workspaceMode: AppWorkspaceMode;
  showToast: (message: string) => void;
}

const LEGACY_LAYOUT_STORAGE_KEYS = [
  "btc-grid-backtest:card-layout-snapshot:v2",
  "btc-grid-backtest:card-layout-default-snapshot:v2",
  "btc-grid-backtest:card-layout-snapshots-by-workspace:v1",
  "btc-grid-backtest:card-layout-default-snapshots-by-workspace:v1"
] as const;

export interface ThemeLayoutController {
  themePickerOpen: boolean;
  setThemePickerOpen: Dispatch<SetStateAction<boolean>>;
  themeSettings: ThemeSettings;
  setThemeSettings: Dispatch<SetStateAction<ThemeSettings>>;
  themePickerRef: RefObject<HTMLDivElement>;
  confirmLayoutScopeSwitch: (nextScope: AppWorkspaceMode, apply: () => void) => void;
  handleSaveDefaultThemeAndLayout: () => void;
  handleRestoreDefaultThemeAndLayout: () => void;
}

export function useThemeLayoutController({
  isMobileViewport: _isMobileViewport,
  workspaceMode: _workspaceMode,
  showToast
}: Params): ThemeLayoutController {
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() => {
    const saved = readPlain<ThemeSettings>(STORAGE_KEYS.themeSettings, normalizeThemeSettings);
    return saved ?? createDefaultThemeSettings();
  });

  const themePickerRef = useRef<HTMLDivElement>(null);
  const themeDefaultRef = useRef<ThemeSettings | null>(null);

  useEffect(() => {
    if (themeDefaultRef.current) {
      return;
    }
    const savedDefault = readPlain<ThemeSettings>(
      STORAGE_KEYS.themeDefaultSettings,
      normalizeThemeSettings
    );
    themeDefaultRef.current = cloneThemeSettings(savedDefault ?? themeSettings);
    if (!savedDefault) {
      writePlain(STORAGE_KEYS.themeDefaultSettings, themeDefaultRef.current);
    }
  }, [themeSettings]);

  useEffect(() => {
    LEGACY_LAYOUT_STORAGE_KEYS.forEach((key) => removeStorage(key));
  }, []);

  useEffect(() => {
    applyThemeToDocument(themeSettings);
    writePlain(STORAGE_KEYS.themeSettings, themeSettings);
  }, [themeSettings]);

  useEffect(() => {
    if (!themePickerOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (themePickerRef.current?.contains(target)) {
        return;
      }
      setThemePickerOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [themePickerOpen]);

  const confirmLayoutScopeSwitch = useCallback(
    (_nextScope: AppWorkspaceMode, apply: () => void) => {
      apply();
    },
    []
  );

  const handleSaveDefaultThemeAndLayout = useCallback(() => {
    const nextDefault = cloneThemeSettings(themeSettings);
    themeDefaultRef.current = nextDefault;
    writePlain(STORAGE_KEYS.themeDefaultSettings, nextDefault);
    showToast("主题已设为默认。");
  }, [showToast, themeSettings]);

  const handleRestoreDefaultThemeAndLayout = useCallback(() => {
    const baseline = themeDefaultRef.current ?? createDefaultThemeSettings();
    setThemeSettings((prev) => ({
      ...baseline,
      customAccentHistory: mergeColorHistories(
        prev.customAccentHistory,
        baseline.customAccentHistory,
        [prev.customColor, baseline.customColor]
      ),
      customBackgroundHistory: mergeColorHistories(
        prev.customBackgroundHistory,
        baseline.customBackgroundHistory,
        [prev.customBackground, baseline.customBackground]
      )
    }));
    showToast("默认主题已恢复。");
  }, [showToast]);

  return {
    themePickerOpen,
    setThemePickerOpen,
    themeSettings,
    setThemeSettings,
    themePickerRef,
    confirmLayoutScopeSwitch,
    handleSaveDefaultThemeAndLayout,
    handleRestoreDefaultThemeAndLayout
  };
}
