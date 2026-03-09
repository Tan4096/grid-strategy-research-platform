export interface OptimizationHistoryFailedItem {
  job_id: string;
  reason_code: string;
  reason_message: string;
}

export interface OptimizationHistoryClearResult {
  requested: number;
  deleted: number;
  failed: number;
  deleted_job_ids: string[];
  failed_job_ids: string[];
  failed_items: OptimizationHistoryFailedItem[];
  skipped?: number;
  skipped_job_ids?: string[];
  soft_delete_ttl_hours?: number;
  operation_id?: string;
  undo_until?: string;
  summary_text?: string;
  request_id?: string;
  meta?: {
    retryable?: boolean;
    [key: string]: unknown;
  };
}

export interface OptimizationHistoryRestoreResult {
  requested: number;
  restored: number;
  failed: number;
  restored_job_ids: string[];
  failed_job_ids: string[];
  failed_items: OptimizationHistoryFailedItem[];
  operation_id?: string;
  summary_text?: string;
  request_id?: string;
  meta?: {
    retryable?: boolean;
    [key: string]: unknown;
  };
}

export type OperationEventCategory = "info" | "success" | "warning" | "error";

export type OperationEventKind = "state" | "history";

export type OperationEventStatus =
  | "queued"
  | "running"
  | "success"
  | "partial_failed"
  | "failed"
  | "undone"
  | "expired";

export interface OperationEvent {
  id: string;
  kind?: OperationEventKind;
  category: OperationEventCategory;
  action: string;
  status: OperationEventStatus;
  title: string;
  detail: string | null;
  created_at: string;
  updated_at: string;
  request_id?: string | null;
  operation_id?: string | null;
  job_ids?: string[];
  failed_items?: OptimizationHistoryFailedItem[];
  retryable?: boolean | null;
  undo_until?: string | null;
  source?: string | null;
}

export interface OperationRecord {
  operation_id: string;
  action: string;
  status: string;
  requested: number;
  success: number;
  failed: number;
  skipped: number;
  job_ids: string[];
  failed_items: OptimizationHistoryFailedItem[];
  undo_until?: string | null;
  summary_text?: string | null;
  request_id?: string | null;
  created_at: string;
  updated_at: string;
  meta?: {
    retryable?: boolean;
    [key: string]: unknown;
  };
}

export interface OperationRecordPageResponse {
  items: OperationRecord[];
  next_cursor: string | null;
}

export type JobStreamType = "backtest" | "optimization";

export interface JobStreamUpdate<TPayload = unknown> {
  job_id: string;
  job_type: JobStreamType;
  status: string;
  progress: number;
  terminal: boolean;
  payload: TPayload;
}
