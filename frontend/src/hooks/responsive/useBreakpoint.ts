import { useMediaQuery } from "./useMediaQuery";

export type BreakpointName = "mobile" | "tablet" | "desktop";

export interface BreakpointState {
  mobile: boolean;
  tablet: boolean;
  desktop: boolean;
  current: BreakpointName;
}

export function useBreakpoint(): BreakpointState {
  const mobile = useMediaQuery("(max-width: 767px)");
  const tablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
  const desktop = useMediaQuery("(min-width: 1024px)");

  const current: BreakpointName = mobile ? "mobile" : tablet ? "tablet" : "desktop";

  return {
    mobile,
    tablet,
    desktop,
    current
  };
}
