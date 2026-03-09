import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { clamp, LineChartPoint } from "./buildLineChartOption";

interface UseLineChartInteractionParams {
  dataLength: number;
  points: LineChartPoint[];
  chartLeft: number;
  chartWidth: number;
  svgWidth: number;
  resolvedHeight: number;
  hoverSyncRatio?: number | null;
  onHoverSyncRatioChange?: (ratio: number | null) => void;
  isNarrowChart: boolean;
  svgRef: RefObject<SVGSVGElement>;
  tooltipRef: RefObject<HTMLDivElement>;
}

interface LineChartInteractionHandlers {
  hoverIndex: number | null;
  clearHover: () => void;
  handlePointerMove: (event: ReactMouseEvent<SVGSVGElement>) => void;
  handleTouchStart: (event: ReactTouchEvent<SVGSVGElement>) => void;
  handleTouchMove: (event: ReactTouchEvent<SVGSVGElement>) => void;
  handleTouchEnd: (event?: ReactTouchEvent<SVGSVGElement>) => void;
}

export function useLineChartInteraction({
  dataLength,
  points,
  chartLeft,
  chartWidth,
  svgWidth,
  resolvedHeight,
  hoverSyncRatio,
  onHoverSyncRatioChange,
  isNarrowChart,
  svgRef,
  tooltipRef
}: UseLineChartInteractionParams): LineChartInteractionHandlers {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const touchLongPressTimerRef = useRef<number | null>(null);
  const touchLockedRef = useRef(false);
  const lastSyncIndexRef = useRef<number | null>(null);

  const clearTouchLongPressTimer = useCallback(() => {
    if (touchLongPressTimerRef.current !== null) {
      window.clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
    }
  }, []);

  const clearHover = useCallback(() => {
    setHoverIndex(null);
    if (lastSyncIndexRef.current !== null) {
      lastSyncIndexRef.current = null;
      onHoverSyncRatioChange?.(null);
    }
  }, [onHoverSyncRatioChange]);

  const positionTooltipByRaw = useCallback(
    (rawX: number, rawY: number) => {
      if (!svgRef.current) {
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const tooltip = tooltipRef.current;
      if (!tooltip) {
        return;
      }
      const tipW = Math.max(tooltip.offsetWidth, isNarrowChart ? 170 : 220);
      const tipH = Math.max(tooltip.offsetHeight, isNarrowChart ? 82 : 92);
      const offset = 10;
      let targetX = rawX + offset;
      let targetY = rawY + offset;
      if (targetX + tipW > rect.width - 6) {
        targetX = rawX - tipW - offset;
      }
      if (targetY + tipH > rect.height - 6) {
        targetY = rawY - tipH - offset;
      }
      targetX = clamp(targetX, 6, Math.max(6, rect.width - tipW - 6));
      targetY = clamp(targetY, 6, Math.max(6, rect.height - tipH - 6));
      tooltip.style.left = `${targetX}px`;
      tooltip.style.top = `${targetY}px`;
    },
    [isNarrowChart, svgRef, tooltipRef]
  );

  useEffect(() => () => clearTouchLongPressTimer(), [clearTouchLongPressTimer]);

  const updateHoverByClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!svgRef.current || dataLength <= 0) {
        return;
      }
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const chartLeftPx = (chartLeft / svgWidth) * rect.width;
      const chartWidthPx = (chartWidth / svgWidth) * rect.width;
      const rawX = clamp(clientX - rect.left, 0, rect.width);
      const rawY = clamp(clientY - rect.top, 0, rect.height);
      const x = clamp(rawX, chartLeftPx, chartLeftPx + chartWidthPx);
      const ratio = chartWidthPx > 0 ? (x - chartLeftPx) / chartWidthPx : 0;
      const rawIndex = ratio * (dataLength - 1);
      const idx = clamp(Math.round(rawIndex), 0, dataLength - 1);
      positionTooltipByRaw(rawX, rawY);
      setHoverIndex((prev) => (prev === idx ? prev : idx));
      if (lastSyncIndexRef.current !== idx) {
        lastSyncIndexRef.current = idx;
        onHoverSyncRatioChange?.(dataLength > 1 ? idx / (dataLength - 1) : 0);
      }
    },
    [chartLeft, chartWidth, dataLength, onHoverSyncRatioChange, positionTooltipByRaw, svgRef, svgWidth]
  );

  useEffect(() => {
    if (hoverSyncRatio === undefined) {
      return;
    }
    if (hoverSyncRatio === null) {
      lastSyncIndexRef.current = null;
      setHoverIndex(null);
      return;
    }
    const idx = clamp(Math.round(clamp(hoverSyncRatio, 0, 1) * Math.max(dataLength - 1, 1)), 0, Math.max(dataLength - 1, 0));
    if (hoverIndex === idx) {
      return;
    }
    setHoverIndex(idx);
    if (!svgRef.current) {
      return;
    }
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const point = points[idx];
    if (!point) {
      return;
    }
    const rawX = (point.x / svgWidth) * rect.width;
    const rawY = (point.y / resolvedHeight) * rect.height;
    positionTooltipByRaw(rawX, rawY);
  }, [dataLength, hoverIndex, hoverSyncRatio, points, positionTooltipByRaw, resolvedHeight, svgRef, svgWidth]);

  const handlePointerMove = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      updateHoverByClient(event.clientX, event.clientY);
    },
    [updateHoverByClient]
  );

  const handleTouchStart = useCallback(
    (event: ReactTouchEvent<SVGSVGElement>) => {
      if (event.touches.length >= 2) {
        clearTouchLongPressTimer();
        touchLockedRef.current = false;
        clearHover();
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      touchLockedRef.current = false;
      clearTouchLongPressTimer();
      updateHoverByClient(touch.clientX, touch.clientY);
      touchLongPressTimerRef.current = window.setTimeout(() => {
        touchLockedRef.current = true;
      }, 220);
    },
    [clearHover, clearTouchLongPressTimer, updateHoverByClient]
  );

  const handleTouchMove = useCallback(
    (event: ReactTouchEvent<SVGSVGElement>) => {
      if (event.touches.length >= 2) {
        clearTouchLongPressTimer();
        touchLockedRef.current = false;
        clearHover();
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      if (touchLockedRef.current) {
        event.preventDefault();
      }
      updateHoverByClient(touch.clientX, touch.clientY);
    },
    [clearHover, clearTouchLongPressTimer, updateHoverByClient]
  );

  const handleTouchEnd = useCallback(
    (event?: ReactTouchEvent<SVGSVGElement>) => {
      clearTouchLongPressTimer();
      if (event?.touches.length === 1) {
        const touch = event.touches[0];
        if (touch) {
          touchLockedRef.current = false;
          updateHoverByClient(touch.clientX, touch.clientY);
          touchLongPressTimerRef.current = window.setTimeout(() => {
            touchLockedRef.current = true;
          }, 220);
          return;
        }
      }
      touchLockedRef.current = false;
      clearHover();
    },
    [clearHover, clearTouchLongPressTimer, updateHoverByClient]
  );

  return {
    hoverIndex,
    clearHover,
    handlePointerMove,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  };
}
