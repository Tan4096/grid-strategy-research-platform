import { RefObject, useEffect, useMemo, useState } from "react";

interface UseLayoutCardHeightOptions {
  baseHeight: number;
  minHeight?: number;
  maxHeight?: number;
  reservedSpacePx?: number;
  headerRef?: RefObject<HTMLElement>;
  footerRef?: RefObject<HTMLElement>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nearEqual(a: number, b: number, tolerance = 1): boolean {
  return Math.abs(a - b) <= tolerance;
}

function parseExplicitCardHeight(value: string): number | null {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function useLayoutCardHeight(
  containerRef: RefObject<HTMLElement>,
  {
    baseHeight,
    minHeight = 140,
    maxHeight = 1800,
    reservedSpacePx = 10,
    headerRef,
    footerRef
  }: UseLayoutCardHeightOptions
): number {
  const [explicitCardHeight, setExplicitCardHeight] = useState<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const sync = () => {
      const nextExplicit = parseExplicitCardHeight(container.style.getPropertyValue("--card-height"));
      setExplicitCardHeight((prev) => {
        if (prev === null && nextExplicit === null) {
          return prev;
        }
        if (prev !== null && nextExplicit !== null && nearEqual(prev, nextExplicit)) {
          return prev;
        }
        return nextExplicit;
      });

      const currentHeader = headerRef?.current
        ? Math.max(0, Math.round(headerRef.current.getBoundingClientRect().height || 0))
        : 0;
      const currentFooter = footerRef?.current
        ? Math.max(0, Math.round(footerRef.current.getBoundingClientRect().height || 0))
        : 0;
      setHeaderHeight((prev) => (nearEqual(prev, currentHeader) ? prev : currentHeader));
      setFooterHeight((prev) => (nearEqual(prev, currentFooter) ? prev : currentFooter));
    };

    sync();

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    resizeObserver?.observe(container);
    if (headerRef?.current) {
      resizeObserver?.observe(headerRef.current);
    }
    if (footerRef?.current) {
      resizeObserver?.observe(footerRef.current);
    }

    const mutationObserver = new MutationObserver(sync);
    mutationObserver.observe(container, {
      attributes: true,
      attributeFilter: ["style", "class"]
    });

    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, [containerRef, footerRef, headerRef]);

  return useMemo(() => {
    if (explicitCardHeight === null) {
      return clamp(Math.round(baseHeight), minHeight, maxHeight);
    }
    const available = explicitCardHeight - headerHeight - footerHeight - reservedSpacePx;
    return clamp(Math.round(available), minHeight, maxHeight);
  }, [baseHeight, explicitCardHeight, footerHeight, headerHeight, maxHeight, minHeight, reservedSpacePx]);
}
