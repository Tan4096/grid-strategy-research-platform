import { useMediaQuery } from "./useMediaQuery";

const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

export function useIsMobile(query: string = MOBILE_MEDIA_QUERY): boolean {
  return useMediaQuery(query);
}
