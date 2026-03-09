import type { JobStreamType, JobStreamUpdate } from "../../lib/operation-models";
import { normalizeJobStreamUpdate } from "../api-contract";
import { getClientSessionId } from "./core";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export function buildJobStreamUrl(jobId: string, jobType: JobStreamType): string {
  const base = API_BASE.replace(/\/+$/, "");
  const query = new URLSearchParams({
    job_type: jobType,
    client_session: getClientSessionId()
  });
  return `${base}/api/v1/jobs/${encodeURIComponent(jobId)}/stream?${query.toString()}`;
}

export function parseJobStreamUpdate<TPayload>(raw: string): JobStreamUpdate<TPayload> | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  try {
    return normalizeJobStreamUpdate<TPayload>(JSON.parse(raw));
  } catch {
    return null;
  }
}
