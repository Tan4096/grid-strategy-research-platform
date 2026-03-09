import { AnchorMode } from "../types";

export type ThemePreset = "cyan" | "blue" | "emerald" | "amber" | "rose" | "custom";
export type BackgroundPreset = "deep" | "slate" | "graphite" | "paper" | "custom";
export type FontPreset = "manrope" | "pingfang" | "yahei" | "plex";
export type FontSizePreset = "small" | "medium" | "large";

export interface ThemeSettings {
  preset: ThemePreset;
  customColor: string;
  backgroundPreset: BackgroundPreset;
  customBackground: string;
  fontPreset: FontPreset;
  fontSizePreset: FontSizePreset;
  cardRadiusPx: number;
  customAccentHistory: string[];
  customBackgroundHistory: string[];
}

export const THEME_PRESETS: Record<Exclude<ThemePreset, "custom">, string> = {
  cyan: "#3b82f6",
  blue: "#10b981",
  emerald: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#ef4444"
};

export const BACKGROUND_PRESETS: Record<Exclude<BackgroundPreset, "custom">, string> = {
  deep: "#0f172a",
  slate: "#1f2937",
  graphite: "#f3f4f6",
  paper: "#ffffff"
};

export const FONT_FAMILIES: Record<FontPreset, string> = {
  manrope: '"Manrope", "Noto Sans SC", sans-serif',
  pingfang: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  yahei: '"Microsoft YaHei", "Noto Sans SC", sans-serif',
  plex: '"IBM Plex Sans", "Noto Sans SC", sans-serif'
};

export const FONT_SIZES: Record<FontSizePreset, string> = {
  small: "14px",
  medium: "16px",
  large: "18px"
};

export const OPTIMIZATION_ANCHOR_LABELS: Record<AnchorMode, string> = {
  BACKTEST_START_PRICE: "第一根K线收盘价",
  BACKTEST_AVG_PRICE: "区间均价",
  CURRENT_PRICE: "回测末端K线收盘价",
  CUSTOM_PRICE: "自定义价格"
};

const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  preset: "cyan",
  customColor: "#3b82f6",
  backgroundPreset: "deep",
  customBackground: "#0f172a",
  fontPreset: "manrope",
  fontSizePreset: "medium",
  cardRadiusPx: 14,
  customAccentHistory: [],
  customBackgroundHistory: []
};

export function createDefaultThemeSettings(): ThemeSettings {
  return {
    ...DEFAULT_THEME_SETTINGS,
    customAccentHistory: [],
    customBackgroundHistory: []
  };
}

export function normalizeHexColor(value: string, fallback = "#3b82f6"): string {
  const trimmed = value.trim();
  if (!/^#[\da-fA-F]{6}$/.test(trimmed)) {
    return fallback;
  }
  return trimmed.toLowerCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const safe = normalizeHexColor(hex, "#000000");
  const raw = safe.slice(1);
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  if (![r, g, b].every((v) => Number.isFinite(v))) {
    return null;
  }
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function shiftColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return hex;
  }
  const ratio = Math.min(1, Math.max(0, Math.abs(amount)));
  const target = amount >= 0 ? 255 : 0;
  const r = rgb.r + (target - rgb.r) * ratio;
  const g = rgb.g + (target - rgb.g) * ratio;
  const b = rgb.b + (target - rgb.b) * ratio;
  return rgbToHex(r, g, b);
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(rgb.r);
  const g = channel(rgb.g);
  const b = channel(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function normalizeColorHistory(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = normalizeHexColor(value, "");
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= 5) {
      break;
    }
  }
  return result;
}

export function pushRecentColor(history: string[], color: string): string[] {
  const normalized = normalizeHexColor(color, "");
  if (!normalized) {
    return history;
  }
  const next = [normalized, ...history.filter((item) => item !== normalized)];
  return next.slice(0, 5);
}

export function mergeColorHistories(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const value of list) {
      const normalized = normalizeHexColor(value, "");
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(normalized);
      if (merged.length >= 5) {
        return merged;
      }
    }
  }
  return merged;
}

export function cloneThemeSettings(settings: ThemeSettings): ThemeSettings {
  return {
    ...settings,
    customAccentHistory: [...settings.customAccentHistory],
    customBackgroundHistory: [...settings.customBackgroundHistory]
  };
}

export function normalizeThemeSettings(raw: unknown): ThemeSettings | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<ThemeSettings>;
  const preset = value.preset;
  const customColor = value.customColor;
  const backgroundPreset = value.backgroundPreset;
  const customBackground = value.customBackground;
  if (
    preset !== "cyan" &&
    preset !== "blue" &&
    preset !== "emerald" &&
    preset !== "amber" &&
    preset !== "rose" &&
    preset !== "custom"
  ) {
    return null;
  }
  if (typeof customColor !== "string") {
    return null;
  }
  const fontPreset: FontPreset =
    value.fontPreset === "manrope" ||
    value.fontPreset === "pingfang" ||
    value.fontPreset === "yahei" ||
    value.fontPreset === "plex"
      ? value.fontPreset
      : DEFAULT_THEME_SETTINGS.fontPreset;
  const fontSizePreset: FontSizePreset =
    value.fontSizePreset === "small" ||
    value.fontSizePreset === "medium" ||
    value.fontSizePreset === "large"
      ? value.fontSizePreset
      : DEFAULT_THEME_SETTINGS.fontSizePreset;
  const cardRadiusRaw =
    typeof value.cardRadiusPx === "number" && Number.isFinite(value.cardRadiusPx)
      ? value.cardRadiusPx
      : DEFAULT_THEME_SETTINGS.cardRadiusPx;
  const cardRadiusPx = Math.max(6, Math.min(28, Math.round(cardRadiusRaw)));
  const resolvedBackgroundPreset =
    backgroundPreset === "deep" ||
    backgroundPreset === "slate" ||
    backgroundPreset === "graphite" ||
    backgroundPreset === "paper" ||
    backgroundPreset === "custom"
      ? backgroundPreset
      : "deep";
  return {
    preset,
    customColor: normalizeHexColor(customColor),
    backgroundPreset: resolvedBackgroundPreset,
    customBackground:
      typeof customBackground === "string"
        ? normalizeHexColor(customBackground, "#0f172a")
        : "#0f172a",
    fontPreset,
    fontSizePreset,
    cardRadiusPx,
    customAccentHistory: normalizeColorHistory(value.customAccentHistory),
    customBackgroundHistory: normalizeColorHistory(value.customBackgroundHistory)
  };
}

function resolveAccentHex(settings: ThemeSettings): string {
  return settings.preset === "custom" ? settings.customColor : THEME_PRESETS[settings.preset];
}

function resolveBackgroundHex(settings: ThemeSettings): string {
  return settings.backgroundPreset === "custom"
    ? settings.customBackground
    : BACKGROUND_PRESETS[settings.backgroundPreset];
}

export function applyThemeToDocument(settings: ThemeSettings): void {
  const accentHex = resolveAccentHex(settings);
  const rgb = hexToRgb(accentHex);
  if (!rgb) {
    return;
  }
  const backgroundHex = resolveBackgroundHex(settings);
  const bgRgb = hexToRgb(backgroundHex);
  if (!bgRgb) {
    return;
  }
  const isLightBg = relativeLuminance(bgRgb) > 0.58;
  const root = document.documentElement;
  root.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  root.style.setProperty("--bg-base", backgroundHex);
  root.style.setProperty("--bg-elevated", shiftColor(backgroundHex, isLightBg ? -0.06 : 0.08));
  root.style.setProperty("--card", isLightBg ? "rgba(255,255,255,0.88)" : "rgba(15, 23, 42, 0.9)");
  root.style.setProperty("--line", isLightBg ? "rgba(15, 23, 42, 0.18)" : "rgba(148, 163, 184, 0.18)");
  root.style.setProperty("--app-font-family", FONT_FAMILIES[settings.fontPreset]);
  root.style.setProperty("--app-font-size", FONT_SIZES[settings.fontSizePreset]);
  root.style.setProperty("--card-radius", `${settings.cardRadiusPx}px`);
  root.style.setProperty("--card-sub-radius", `${Math.max(4, Math.round(settings.cardRadiusPx * 0.72))}px`);
  root.style.setProperty("--control-radius", `${Math.max(6, Math.round(settings.cardRadiusPx * 0.58))}px`);
  root.style.setProperty("--control-group-radius", `${Math.max(7, Math.round(settings.cardRadiusPx * 0.72))}px`);
  root.style.setProperty("--control-input-radius", `${Math.max(5, Math.round(settings.cardRadiusPx * 0.5))}px`);
  root.classList.toggle("theme-light", isLightBg);
}
