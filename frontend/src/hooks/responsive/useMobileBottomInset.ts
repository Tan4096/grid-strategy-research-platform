import { useEffect, useMemo, useState } from "react";
import { MobileBottomInsetState } from "../../types";
import { STORAGE_KEYS, writePlain } from "../../lib/storage";

interface UseMobileBottomInsetParams {
  enabled: boolean;
  stickyActionVisible: boolean;
  floatingEntryVisible: boolean;
  bottomTabVisible?: boolean;
  stickyActionHeightPx?: number;
  floatingEntryHeightPx?: number;
  bottomTabHeightPx?: number;
  gapPx?: number;
}

function readSafeAreaInsetBottomPx(): number {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return 0;
  }
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingBottom = "env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const value = Number.parseFloat(window.getComputedStyle(probe).paddingBottom || "0");
  probe.remove();
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function useMobileBottomInset({
  enabled,
  stickyActionVisible,
  floatingEntryVisible,
  bottomTabVisible = false,
  stickyActionHeightPx = 56,
  floatingEntryHeightPx = 40,
  bottomTabHeightPx = 64,
  gapPx = 8
}: UseMobileBottomInsetParams): MobileBottomInsetState {
  const [safeAreaPx, setSafeAreaPx] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setSafeAreaPx(0);
      return;
    }
    const update = () => {
      setSafeAreaPx(readSafeAreaInsetBottomPx());
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [enabled]);

  const state = useMemo<MobileBottomInsetState>(() => {
    const stickyActionPx = enabled && stickyActionVisible ? stickyActionHeightPx + gapPx : 0;
    const floatingEntryPx = enabled && floatingEntryVisible ? floatingEntryHeightPx + gapPx : 0;
    const bottomNavPx = enabled && bottomTabVisible ? bottomTabHeightPx + gapPx : 0;
    const reservedBottomPx = Math.max(stickyActionPx, floatingEntryPx, bottomNavPx);
    return {
      safe_area_px: safeAreaPx,
      sticky_action_px: stickyActionPx,
      floating_entry_px: floatingEntryPx,
      bottom_nav_px: bottomNavPx,
      reserved_bottom_px: reservedBottomPx
    };
  }, [
    bottomTabHeightPx,
    bottomTabVisible,
    enabled,
    floatingEntryHeightPx,
    floatingEntryVisible,
    gapPx,
    safeAreaPx,
    stickyActionHeightPx,
    stickyActionVisible
  ]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    const nextValue = `${Math.max(0, Math.round(state.reserved_bottom_px))}px`;
    root.style.setProperty("--mobile-bottom-reserved", nextValue);
    root.style.setProperty(
      "--mobile-bottom-sticky-offset",
      `${Math.max(0, Math.round(state.bottom_nav_px))}px`
    );
    writePlain(STORAGE_KEYS.mobileBottomReserved, state);
    return () => {
      root.style.setProperty("--mobile-bottom-reserved", "0px");
      root.style.setProperty("--mobile-bottom-sticky-offset", "0px");
    };
  }, [state]);

  return state;
}
