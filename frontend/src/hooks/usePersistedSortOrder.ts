import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { readPlain, writePlain } from "../lib/storage";
import type { SortOrder } from "../lib/api-schema";

function normalizeSortOrder(raw: unknown): SortOrder | null {
  if (raw === "asc" || raw === "desc") {
    return raw;
  }
  return null;
}

export function usePersistedSortOrder(
  storageKey: string,
  defaultValue: SortOrder = "desc",
  legacyKeys: string[] = []
): [SortOrder, Dispatch<SetStateAction<SortOrder>>] {
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    if (typeof window === "undefined") {
      return defaultValue;
    }
    return readPlain(storageKey, normalizeSortOrder, legacyKeys) ?? defaultValue;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writePlain(storageKey, sortOrder);
  }, [storageKey, sortOrder]);

  return [sortOrder, setSortOrder];
}
