import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  BACKGROUND_PRESETS,
  BackgroundPreset,
  FontPreset,
  FontSizePreset,
  normalizeHexColor,
  pushRecentColor,
  THEME_PRESETS,
  ThemePreset,
  ThemeSettings
} from "../../lib/appTheme";
import { AppWorkspaceMode, MobilePrimaryTab } from "../../types";

interface AppTopBarProps {
  mode: AppWorkspaceMode;
  onModeChange: (mode: AppWorkspaceMode) => void;
  mobileStatusText?: string;
  isMobileViewport: boolean;
  currentMobilePrimaryTab?: MobilePrimaryTab;
  onOpenOperationFeedback?: () => void;
  operationFeedbackCount?: number;
  themePickerOpen: boolean;
  onToggleThemePicker: () => void;
  themePickerRef: RefObject<HTMLDivElement>;
  themeSettings: ThemeSettings;
  onThemeSettingsChange: Dispatch<SetStateAction<ThemeSettings>>;
  onSaveAsDefault: () => void;
  onRestoreDefault: () => void;
}

export default function AppTopBar({
  mode,
  onModeChange,
  mobileStatusText = "就绪",
  isMobileViewport,
  currentMobilePrimaryTab = "params",
  onOpenOperationFeedback,
  operationFeedbackCount = 0,
  themePickerOpen,
  onToggleThemePicker,
  themePickerRef,
  themeSettings,
  onThemeSettingsChange,
  onSaveAsDefault,
  onRestoreDefault
}: AppTopBarProps) {
  const iconTooltipClass =
    "pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-slate-600/80 bg-slate-950/95 px-2 py-0.5 text-[11px] text-slate-100 opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100";
  const showDesktopModeTabs = !isMobileViewport;
  const mobileTitle =
    currentMobilePrimaryTab === "backtest"
      ? "回测"
      : currentMobilePrimaryTab === "optimize"
        ? "优化"
        : currentMobilePrimaryTab === "live"
          ? "实盘监测"
        : "参数";

  return (
    <div className="card z-[1200] overflow-visible flex flex-wrap items-start justify-between gap-3 p-2.5 sm:p-3">
      {showDesktopModeTabs ? (
        <div className="ui-tab-group">
          <button
            type="button"
            className={`ui-tab ${mode === "backtest" ? "is-active" : ""}`}
            onClick={() => onModeChange("backtest")}
            data-tour-id="mode-backtest-button"
          >
            回测
          </button>
          <button
            type="button"
            className={`ui-tab ${mode === "optimize" ? "is-active" : ""}`}
            onClick={() => onModeChange("optimize")}
            data-tour-id="mode-optimize-button"
          >
            参数优化
          </button>
          <button
            type="button"
            className={`ui-tab ${mode === "live" ? "is-active" : ""}`}
            onClick={() => onModeChange("live")}
            data-tour-id="mode-live-button"
          >
            实盘监测
          </button>
        </div>
      ) : (
        <div>
          <p className="text-sm font-semibold text-slate-100">{mobileTitle}</p>
          <p className="text-xs text-slate-400">状态: {mobileStatusText}</p>
        </div>
      )}

      <div ref={themePickerRef} className="relative z-[3000]">
        {isMobileViewport && onOpenOperationFeedback && (
          <div className="group relative mr-2 inline-flex">
            <button
              type="button"
              className="inline-flex h-9 min-w-[3.2rem] items-center justify-center gap-1 rounded-md border border-slate-600/80 bg-slate-900/70 px-3 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
              onClick={onOpenOperationFeedback}
              aria-label="打开通知中心"
              title="通知中心"
            >
              <span>通知</span>
              {operationFeedbackCount > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb))] px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">
                  {operationFeedbackCount}
                </span>
              )}
            </button>
          </div>
        )}
        <div className="group relative inline-flex">
          <button
            type="button"
            className={`inline-flex items-center justify-center rounded-md border border-slate-600/80 bg-slate-900/70 text-slate-200 transition hover:bg-slate-800 ${
              isMobileViewport ? "h-9 min-w-[3.2rem] px-3 text-xs font-semibold" : "h-9 w-9"
            }`}
            onClick={onToggleThemePicker}
            aria-label={isMobileViewport ? "打开更多设置" : "打开主题色设置"}
            title={isMobileViewport ? "更多设置" : "主题色设置"}
          >
            {isMobileViewport ? (
              "更多"
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5c0 1.8-1.2 3-3 3h-1.1a2.1 2.1 0 1 1 0 4.2h.2A5.4 5.4 0 0 0 22 13.8C22 8 17.5 3.5 12 3.5Z" />
                  <circle cx="7.2" cy="10" r="1.1" />
                  <circle cx="10.5" cy="7.3" r="1.1" />
                  <circle cx="14.3" cy="7.1" r="1.1" />
                  <circle cx="16.9" cy="10.3" r="1.1" />
                </svg>
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-slate-950"
                  style={{
                    backgroundColor:
                      themeSettings.preset === "custom"
                        ? themeSettings.customColor
                        : THEME_PRESETS[themeSettings.preset]
                  }}
                />
              </>
            )}
          </button>
          {!isMobileViewport && (
            <span className={iconTooltipClass} aria-hidden="true">
              主题设置
            </span>
          )}
        </div>

        {themePickerOpen && (
          <div
            className={`rounded-md border border-slate-700/60 bg-slate-950/95 p-2.5 sm:p-3 shadow-xl ${
              isMobileViewport
                ? "fixed inset-x-2 top-14 z-[3200] max-h-[calc(100vh-5rem)] overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
                : "absolute right-0 top-11 z-[3200] w-[280px]"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">主题色</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {(Object.keys(THEME_PRESETS) as Array<Exclude<ThemePreset, "custom">>).map((presetKey) => {
                  const color = THEME_PRESETS[presetKey];
                  const active = themeSettings.preset === presetKey;
                  return (
                    <button
                      key={presetKey}
                      type="button"
                      className={`theme-swatch h-6 w-6 rounded-full border transition sm:h-7 sm:w-7 ${
                        active ? "border-slate-100 ring-2 ring-slate-300/40" : "border-slate-700 hover:border-slate-500"
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() =>
                        onThemeSettingsChange((prev) => ({
                          ...prev,
                          preset: presetKey
                        }))
                      }
                      title={presetKey}
                    />
                  );
                })}
              </div>
              <input
                type="color"
                className="theme-color-input h-7 w-10 cursor-pointer rounded border border-slate-700 bg-slate-950/70 p-1 sm:h-8 sm:w-11"
                value={themeSettings.customColor}
                onChange={(event) =>
                  onThemeSettingsChange((prev) => ({
                    ...prev,
                    customColor: normalizeHexColor(event.target.value),
                    preset: "custom",
                    customAccentHistory: pushRecentColor(prev.customAccentHistory, event.target.value)
                  }))
                }
                title="自定义主题色"
              />
            </div>
            {themeSettings.customAccentHistory.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 sm:gap-2">
                {themeSettings.customAccentHistory.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="theme-history-swatch h-5 w-5 rounded-full border border-slate-700 transition hover:border-slate-500 sm:h-6 sm:w-6"
                    style={{ backgroundColor: color }}
                    onClick={() =>
                      onThemeSettingsChange((prev) => ({
                        ...prev,
                        preset: "custom",
                        customColor: color
                      }))
                    }
                    title={color}
                  />
                ))}
              </div>
            )}

            <div className="mt-3 border-t border-slate-700/60 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">背景色</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                  {(Object.keys(BACKGROUND_PRESETS) as Array<Exclude<BackgroundPreset, "custom">>).map((presetKey) => {
                    const color = BACKGROUND_PRESETS[presetKey];
                    const active = themeSettings.backgroundPreset === presetKey;
                    return (
                      <button
                        key={presetKey}
                        type="button"
                        className={`theme-swatch-square h-6 w-6 rounded-md border transition sm:h-7 sm:w-7 ${
                          active ? "border-slate-100 ring-2 ring-slate-300/40" : "border-slate-700 hover:border-slate-500"
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() =>
                          onThemeSettingsChange((prev) => ({
                            ...prev,
                            backgroundPreset: presetKey
                          }))
                        }
                        title={presetKey}
                      />
                    );
                  })}
                </div>
                <input
                  type="color"
                  className="theme-color-input h-7 w-10 cursor-pointer rounded border border-slate-700 bg-slate-950/70 p-1 sm:h-8 sm:w-11"
                  value={themeSettings.customBackground}
                  onChange={(event) =>
                    onThemeSettingsChange((prev) => ({
                      ...prev,
                      customBackground: normalizeHexColor(event.target.value, "#0f172a"),
                      backgroundPreset: "custom",
                      customBackgroundHistory: pushRecentColor(prev.customBackgroundHistory, event.target.value)
                    }))
                  }
                  title="自定义背景色"
                />
              </div>
              {themeSettings.customBackgroundHistory.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 sm:gap-2">
                  {themeSettings.customBackgroundHistory.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="theme-history-swatch h-5 w-5 rounded-md border border-slate-700 transition hover:border-slate-500 sm:h-6 sm:w-6"
                      style={{ backgroundColor: color }}
                      onClick={() =>
                        onThemeSettingsChange((prev) => ({
                          ...prev,
                          backgroundPreset: "custom",
                          customBackground: color
                        }))
                      }
                      title={color}
                    />
                  ))}
                </div>
              )}
            </div>

            {!isMobileViewport && (
              <>
                <div className="mt-3 border-t border-slate-700/60 pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">字体</p>
                  <div className="mobile-two-col-grid mt-2 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                    <select
                      className="ui-input ui-input-sm text-xs"
                      value={themeSettings.fontPreset}
                      onChange={(event) =>
                        onThemeSettingsChange((prev) => ({
                          ...prev,
                          fontPreset: event.target.value as FontPreset
                        }))
                      }
                    >
                      <option value="manrope">Manrope</option>
                      <option value="pingfang">苹方</option>
                      <option value="yahei">微软雅黑</option>
                      <option value="plex">IBM Plex Sans</option>
                    </select>
                    <select
                      className="ui-input ui-input-sm text-xs"
                      value={themeSettings.fontSizePreset}
                      onChange={(event) =>
                        onThemeSettingsChange((prev) => ({
                          ...prev,
                          fontSizePreset: event.target.value as FontSizePreset
                        }))
                      }
                    >
                      <option value="small">小</option>
                      <option value="medium">中</option>
                      <option value="large">大</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 border-t border-slate-700/60 pt-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">圆角</p>
                    <span className="mono text-[11px] text-slate-300">{themeSettings.cardRadiusPx}px</span>
                  </div>
                  <input
                    type="range"
                    min={6}
                    max={28}
                    step={1}
                    className="mt-2 w-full accent-[rgb(var(--accent-rgb))]"
                    value={themeSettings.cardRadiusPx}
                    onChange={(event) =>
                      onThemeSettingsChange((prev) => ({
                        ...prev,
                        cardRadiusPx: Math.max(6, Math.min(28, Number(event.target.value)))
                      }))
                    }
                  />
                </div>

                <div className="mt-3 border-t border-slate-700/60 pt-3">
                  <div className="mobile-two-col-grid grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                    <button
                      type="button"
                      className="ui-btn ui-btn-primary ui-btn-xs"
                      onClick={onSaveAsDefault}
                    >
                      保存为默认
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary ui-btn-xs"
                      onClick={onRestoreDefault}
                    >
                      恢复默认
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
