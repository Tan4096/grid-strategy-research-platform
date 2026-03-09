import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo, useState } from "react";
import { STORAGE_KEYS, writePlain } from "../lib/storage";
import {
  LiveConnectionDraft,
  LiveExchange,
  LiveRobotListItem,
  LiveRobotListScope
} from "../types";
import { inputClass, labelClass } from "./parameter/shared";

interface Props {
  draft: LiveConnectionDraft;
  onChange: Dispatch<SetStateAction<LiveConnectionDraft>>;
  persistCredentialsEnabled: boolean;
  onPersistCredentialsEnabledChange: Dispatch<SetStateAction<boolean>>;
  exchange: LiveExchange | null;
  symbol: string;
  strategyStartedAt: string | null;
  loading: boolean;
  monitoringActive: boolean;
  autoRefreshPaused: boolean;
  autoRefreshPausedReason?: string | null;
  error: string | null;
  robotItems: LiveRobotListItem[];
  robotListLoading: boolean;
  robotListError?: string | null;
  selectedScope: LiveRobotListScope;
  onSelectedScopeChange: (scope: LiveRobotListScope) => void;
  pollIntervalSec: 5 | 15 | 30 | 60;
  onPollIntervalChange: (seconds: 5 | 15 | 30 | 60) => void;
  selectedRobotMissing: boolean;
  onSelectRecentRobot: () => void;
  onRefreshRobots: () => void;
  onClearCredentials: () => void;
  primaryBlockingReason?: string | null;
  compact?: boolean;
}

function formatRobotSummary(item: LiveRobotListItem): string {
  const stateLabel =
    item.state === "running" ? "运行中" : item.state === "stopped" ? "已停止" : item.state ?? "状态未知";
  const pieces = [item.name, item.side === "short" ? "做空" : item.side === "long" ? "做多" : "方向未知", stateLabel];
  if (item.updated_at) {
    pieces.push(
      new Date(item.updated_at).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      })
    );
  }
  return pieces.join(" · ");
}

function readCredentialsExpandedPreference(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.liveConnectionCredentialsExpanded);
    if (!raw) {
      return true;
    }
    const parsed = JSON.parse(raw);
    return typeof parsed === "boolean" ? parsed : true;
  } catch {
    return true;
  }
}

export default function LiveConnectionPanel({
  draft,
  onChange,
  persistCredentialsEnabled,
  onPersistCredentialsEnabledChange,
  exchange,
  symbol,
  strategyStartedAt,
  loading,
  monitoringActive,
  autoRefreshPaused,
  autoRefreshPausedReason = null,
  error,
  robotItems,
  robotListLoading,
  robotListError = null,
  selectedScope,
  onSelectedScopeChange,
  pollIntervalSec,
  onPollIntervalChange,
  selectedRobotMissing,
  onSelectRecentRobot,
  onRefreshRobots,
  onClearCredentials,
  primaryBlockingReason: _primaryBlockingReason = null,
  compact = false
}: Props) {
  void monitoringActive;
  void autoRefreshPaused;
  void autoRefreshPausedReason;
  void selectedScope;
  void onSelectedScopeChange;
  void pollIntervalSec;
  void onPollIntervalChange;
  void onSelectRecentRobot;
  const exchangeLabel = exchange ? exchange.toUpperCase() : "未设置";
  const symbolLabel = symbol.trim().toUpperCase() || "未设置";
  const activeCredentials = draft.profiles.okx;
  const cardClass = compact ? "card-sub border border-slate-700/60 bg-slate-900/30 p-2" : "card p-2 sm:p-2.5";
  const credentialsGridClass = "mt-2 grid gap-2 md:grid-cols-4";
  const okxBotMode = exchange === "okx";
  const credentialsReady = Boolean(
    activeCredentials.api_key.trim() &&
      activeCredentials.api_secret.trim() &&
      (activeCredentials.passphrase ?? "").trim()
  );
  const credentialsDisabled = !okxBotMode || loading;
  const [credentialsExpanded, setCredentialsExpanded] = useState(readCredentialsExpandedPreference);
  const selectedRobot = useMemo(
    () => robotItems.find((item) => item.algo_id === draft.algo_id) ?? null,
    [draft.algo_id, robotItems]
  );
  const filteredRobotItems = useMemo(() => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      return robotItems;
    }
    const matched = robotItems.filter((item) => item.symbol.trim().toUpperCase() === normalizedSymbol);
    return matched.length > 0 ? matched : robotItems;
  }, [robotItems, symbol]);

  const panelNote = robotListError || error
    ? robotListError ?? error
    : selectedRobotMissing
      ? "当前监测对象暂不可用。"
      : !okxBotMode
        ? "实盘监测目前仅支持 OKX。"
        : !credentialsReady
          ? "填写 OKX 凭证后请选择要监测的 OKX 机器人。"
          : selectedRobot
            ? `当前对象：${formatRobotSummary(selectedRobot)}`
            : robotListLoading
              ? "正在读取当前环境下的监测对象。"
              : strategyStartedAt
                ? "请选择当前交易环境下要监测的机器人。"
                : "先在左侧设置交易环境，再使用实盘监测。";
  const panelNoteTone =
    robotListError || error
      ? "text-rose-200"
      : selectedRobotMissing || !okxBotMode
        ? "text-amber-200"
        : "text-slate-400";

  const updateCredentialsExpanded = useCallback((nextValue: boolean | ((prev: boolean) => boolean)) => {
    setCredentialsExpanded((prev) => {
      const resolved = typeof nextValue === "function" ? nextValue(prev) : nextValue;
      writePlain(STORAGE_KEYS.liveConnectionCredentialsExpanded, resolved);
      return resolved;
    });
  }, []);

  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-100">监测连接</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-100">OKX 凭证</h2>
            <span className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-0.5 text-[11px] text-slate-300">
              {exchangeLabel} · {symbolLabel}
            </span>
            {credentialsReady ? (
              <span className="rounded border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">已配置</span>
            ) : (
              <span className="rounded border border-slate-700/70 bg-slate-900/40 px-2 py-0.5 text-[11px] text-slate-400">未配置</span>
            )}
          </div>
          <p className={`mt-1 text-xs ${panelNoteTone}`}>{panelNote}</p>
        </div>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs shrink-0"
          onClick={() => updateCredentialsExpanded((prev) => !prev)}
        >
          {credentialsExpanded ? "收起凭证" : credentialsReady ? "编辑凭证" : "填写凭证"}
        </button>
      </div>

      {okxBotMode && credentialsExpanded ? (
        <>
          <div className={`${credentialsGridClass} rounded border border-slate-700/60 bg-slate-950/20 p-2`}>
            <div>
              <label className={labelClass()}>API Key</label>
              <input
                className={`${inputClass()} ui-input-sm`}
                value={activeCredentials.api_key}
                onChange={(event) =>
                  onChange((prev) => ({
                    ...prev,
                    profiles: {
                      ...prev.profiles,
                      okx: {
                        ...prev.profiles.okx,
                        api_key: event.target.value.trim()
                      }
                    }
                  }))
                }
                autoComplete="off"
                spellCheck={false}
                disabled={credentialsDisabled}
                placeholder="输入 OKX API Key"
              />
            </div>
            <div>
              <label className={labelClass()}>API Secret</label>
              <input
                className={`${inputClass()} ui-input-sm`}
                type="password"
                value={activeCredentials.api_secret}
                onChange={(event) =>
                  onChange((prev) => ({
                    ...prev,
                    profiles: {
                      ...prev.profiles,
                      okx: {
                        ...prev.profiles.okx,
                        api_secret: event.target.value
                      }
                    }
                  }))
                }
                autoComplete="new-password"
                spellCheck={false}
                disabled={credentialsDisabled}
                placeholder="输入 OKX API Secret"
              />
            </div>
            <div>
              <label className={labelClass()}>Passphrase</label>
              <input
                className={`${inputClass()} ui-input-sm`}
                type="password"
                value={activeCredentials.passphrase ?? ""}
                onChange={(event) =>
                  onChange((prev) => ({
                    ...prev,
                    profiles: {
                      ...prev.profiles,
                      okx: {
                        ...prev.profiles.okx,
                        passphrase: event.target.value
                      }
                    }
                  }))
                }
                autoComplete="new-password"
                spellCheck={false}
                disabled={credentialsDisabled}
                placeholder="输入 OKX Passphrase"
              />
            </div>
            <div>
              <label className={labelClass()}>监测对象 (algoId)</label>
              <select
                className={`${inputClass()} ui-input-sm`}
                value={draft.algo_id}
                disabled={!okxBotMode || loading || robotListLoading || !credentialsReady}
                onChange={(event) =>
                  onChange((prev) => ({
                    ...prev,
                    algo_id: event.target.value
                  }))
                }
              >
                <option value="">
                  {robotListLoading
                    ? "正在加载机器人..."
                    : filteredRobotItems.length > 0
                      ? "请选择机器人"
                      : credentialsReady
                        ? "暂无可选机器人"
                        : "先填写凭证"}
                </option>
                {filteredRobotItems.map((item) => (
                  <option key={item.algo_id} value={item.algo_id}>
                    {`${item.symbol} · ${item.side === "short" ? "做空" : item.side === "long" ? "做多" : "方向未知"} · ${item.updated_at ? new Date(item.updated_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "无更新时间"} · ${item.algo_id.slice(-6)}` }
                  </option>
                ))}
              </select>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span>{selectedRobot ? `当前对象：${formatRobotSummary(selectedRobot)}` : "需选择一个机器人后才能开始监测"}</span>
                {selectedRobot ? <span>完整 algoId：{selectedRobot.algo_id}</span> : null}
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary ui-btn-xs"
                  disabled={!credentialsReady || loading}
                  onClick={onRefreshRobots}
                >
                  刷新列表
                </button>
              </div>
            </div>
          </div>
          <div className="mt-2 rounded border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={persistCredentialsEnabled}
                disabled={credentialsDisabled}
                onChange={(event) => onPersistCredentialsEnabledChange(event.target.checked)}
              />
              <span>
                在当前浏览器会话中保存 OKX 凭证（刷新后恢复）。默认不保存；共享设备请勿启用。
              </span>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-xs"
              disabled={credentialsDisabled || !credentialsReady}
              onClick={onClearCredentials}
            >
              清空凭证
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
