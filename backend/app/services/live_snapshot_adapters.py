from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import datetime, timedelta
from typing import Any, Callable, Iterable, Optional

from app.core.schemas import LiveFundingEntry, LiveLedgerEntry, LiveRobotListRequest, LiveSnapshotRequest
from app.services.live_snapshot_types import LiveSnapshotError


def binance_signed_get(
    payload: LiveSnapshotRequest,
    path: str,
    params: dict[str, Any],
    *,
    utc_now: Callable[[], datetime],
    query_string: Callable[[dict[str, Any]], str],
    request_json: Callable[..., Any],
    base_url: str,
) -> Any:
    timestamp = int(utc_now().timestamp() * 1000)
    signed_params = {**params, "timestamp": timestamp, "recvWindow": 5000}
    query = query_string(signed_params)
    signature = hmac.new(
        payload.credentials.api_secret.encode("utf-8"),
        query.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    signed_params["signature"] = signature
    return request_json(
        "GET",
        f"{base_url}{path}",
        headers={"X-MBX-APIKEY": payload.credentials.api_key},
        params=signed_params,
    )



def binance_collect_records(
    payload: LiveSnapshotRequest,
    path: str,
    base_params: dict[str, Any],
    *,
    time_field: str,
    signed_get: Callable[[LiveSnapshotRequest, str, dict[str, Any]], Any],
    safe_int: Callable[[Any, int], int],
    limit: int,
    max_pages: int,
) -> tuple[list[dict[str, Any]], bool]:
    records: list[dict[str, Any]] = []
    next_start = base_params.get("startTime")
    truncated = False

    for _ in range(max_pages):
        page_params = {**base_params, "limit": limit}
        if next_start is not None:
            page_params["startTime"] = next_start
        page = signed_get(payload, path, page_params)
        if not isinstance(page, list) or not page:
            break

        page_items = [item for item in page if isinstance(item, dict)]
        records.extend(page_items)
        if len(page_items) < limit:
            break

        max_time = max(safe_int(item.get(time_field), 0) for item in page_items)
        if max_time <= 0:
            truncated = True
            break
        next_start = max_time + 1
    else:
        truncated = True

    return records, truncated



def bybit_signed_get(
    payload: LiveSnapshotRequest,
    path: str,
    params: dict[str, Any],
    *,
    utc_now: Callable[[], datetime],
    query_string: Callable[[dict[str, Any]], str],
    request_json: Callable[..., Any],
    safe_int: Callable[[Any, int], int],
    sanitize_error_message: Callable[[str], str],
    base_url: str,
) -> Any:
    query = query_string(params)
    timestamp = str(int(utc_now().timestamp() * 1000))
    recv_window = "5000"
    pre_sign = f"{timestamp}{payload.credentials.api_key}{recv_window}{query}"
    signature = hmac.new(
        payload.credentials.api_secret.encode("utf-8"),
        pre_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    response = request_json(
        "GET",
        f"{base_url}{path}",
        headers={
            "X-BAPI-API-KEY": payload.credentials.api_key,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": recv_window,
            "X-BAPI-SIGN": signature,
            "X-BAPI-SIGN-TYPE": "2",
        },
        params=params,
    )
    if not isinstance(response, dict):
        raise LiveSnapshotError("Bybit 返回了无效响应", status_code=502, retryable=True)
    ret_code = safe_int(response.get("retCode"), 0)
    if ret_code != 0:
        raise LiveSnapshotError(
            sanitize_error_message(str(response.get("retMsg") or f"retCode={ret_code}")),
            status_code=400,
        )
    return response.get("result") if isinstance(response.get("result"), dict) else {}



def bybit_collect_execution_history(
    payload: LiveSnapshotRequest,
    symbol: str,
    *,
    start_at: datetime,
    end_at: datetime,
    time_chunks: Callable[..., list[tuple[datetime, datetime]]],
    ms: Callable[[datetime], int],
    signed_get: Callable[[LiveSnapshotRequest, str, dict[str, Any]], Any],
    execution_page_limit: int,
    execution_max_pages: int,
    max_window_days: int,
    coerce_text: Callable[[Any], str],
) -> tuple[list[dict[str, Any]], bool]:
    records: list[dict[str, Any]] = []
    truncated = False

    for window_start, window_end in time_chunks(start_at, end_at, chunk_days=max_window_days):
        cursor: Optional[str] = None
        for _ in range(execution_max_pages):
            params: dict[str, Any] = {
                "category": "linear",
                "symbol": symbol,
                "startTime": ms(window_start),
                "endTime": ms(window_end),
                "limit": execution_page_limit,
            }
            if cursor:
                params["cursor"] = cursor

            payload_page = signed_get(payload, "/v5/execution/list", params)
            page_records = payload_page.get("list", []) if isinstance(payload_page, dict) else []
            if not isinstance(page_records, list) or not page_records:
                break

            records.extend(item for item in page_records if isinstance(item, dict))
            cursor = coerce_text(payload_page.get("nextPageCursor")) if isinstance(payload_page, dict) else ""
            if not cursor:
                break
        else:
            truncated = True

    return records, truncated



def bybit_collect_transaction_logs(
    payload: LiveSnapshotRequest,
    symbol: str,
    *,
    start_at: datetime,
    end_at: datetime,
    time_chunks: Callable[..., list[tuple[datetime, datetime]]],
    ms: Callable[[datetime], int],
    signed_get: Callable[[LiveSnapshotRequest, str, dict[str, Any]], Any],
    transaction_page_limit: int,
    transaction_max_pages: int,
    max_window_days: int,
    coerce_text: Callable[[Any], str],
) -> tuple[list[dict[str, Any]], bool, Optional[str]]:
    records: list[dict[str, Any]] = []
    truncated = False
    attempts = ("UNIFIED", "CONTRACT")
    last_error: Optional[str] = None

    for account_type in attempts:
        try:
            for window_start, window_end in time_chunks(start_at, end_at, chunk_days=max_window_days):
                cursor: Optional[str] = None
                for _ in range(transaction_max_pages):
                    params: dict[str, Any] = {
                        "accountType": account_type,
                        "category": "linear",
                        "symbol": symbol,
                        "startTime": ms(window_start),
                        "endTime": ms(window_end),
                        "limit": transaction_page_limit,
                    }
                    if cursor:
                        params["cursor"] = cursor

                    payload_page = signed_get(payload, "/v5/account/transaction-log", params)
                    page_records = payload_page.get("list", []) if isinstance(payload_page, dict) else []
                    if not isinstance(page_records, list) or not page_records:
                        break

                    records.extend(item for item in page_records if isinstance(item, dict))
                    cursor = coerce_text(payload_page.get("nextPageCursor")) if isinstance(payload_page, dict) else ""
                    if not cursor:
                        break
                else:
                    truncated = True
            return records, truncated, account_type
        except LiveSnapshotError as exc:
            last_error = str(exc)
            records.clear()
            truncated = False

    return [], False, last_error



def bybit_build_funding_entries(
    logs: Iterable[dict[str, Any]],
    *,
    safe_float: Callable[[Any, float], float],
    coerce_text: Callable[[Any], str],
    normalize_datetime: Callable[[Any], datetime],
    sort_and_dedupe_funding: Callable[[Iterable[LiveFundingEntry]], list[LiveFundingEntry]],
) -> list[LiveFundingEntry]:
    entries: list[LiveFundingEntry] = []
    for item in logs:
        funding_amount = safe_float(item.get("funding"), fallback=0.0)
        entry_type = coerce_text(item.get("type")).upper()
        if funding_amount == 0 and entry_type != "SETTLEMENT":
            continue
        if funding_amount == 0:
            continue
        entries.append(
            LiveFundingEntry(
                timestamp=normalize_datetime(item.get("transactionTime") or item.get("tradeTime")),
                amount=funding_amount,
                rate=safe_float(item.get("fundingRate"), fallback=0.0) or None,
                position_size=safe_float(item.get("size"), fallback=0.0) or None,
                currency=coerce_text(item.get("currency")) or None,
            )
        )
    return sort_and_dedupe_funding(entries)



def okx_iso_timestamp(*, utc_now: Callable[[], datetime]) -> str:
    return utc_now().isoformat(timespec="milliseconds").replace("+00:00", "Z")



def okx_signed_get(
    payload: LiveSnapshotRequest,
    path: str,
    params: Optional[dict[str, Any]] = None,
    *,
    query_string: Callable[[dict[str, Any]], str],
    request_json: Callable[..., Any],
    iso_timestamp: Callable[[], str],
    sanitize_error_message: Callable[[str], str],
    base_url: str,
) -> Any:
    query = query_string(params or {})
    request_path = f"{path}?{query}" if query else path
    timestamp = iso_timestamp()
    pre_sign = f"{timestamp}GET{request_path}"
    signature = base64.b64encode(
        hmac.new(
            payload.credentials.api_secret.encode("utf-8"),
            pre_sign.encode("utf-8"),
            hashlib.sha256,
        ).digest()
    ).decode("utf-8")
    response = request_json(
        "GET",
        f"{base_url}{request_path}",
        headers={
            "OK-ACCESS-KEY": payload.credentials.api_key,
            "OK-ACCESS-SIGN": signature,
            "OK-ACCESS-TIMESTAMP": timestamp,
            "OK-ACCESS-PASSPHRASE": payload.credentials.passphrase or "",
        },
    )
    if not isinstance(response, dict):
        raise LiveSnapshotError("OKX 返回了无效响应", status_code=502, retryable=True)
    code = str(response.get("code") or "0")
    if code not in {"0", ""}:
        raise LiveSnapshotError(
            sanitize_error_message(str(response.get("msg") or f"code={code}")),
            status_code=400,
        )
    return response.get("data") if isinstance(response.get("data"), list) else []



def okx_split_billing_windows(
    start_at: datetime,
    end_at: datetime,
    *,
    normalize_datetime: Callable[[Any], datetime],
    time_chunks: Callable[..., list[tuple[datetime, datetime]]],
    recent_window_days: int,
    archive_window_days: int,
) -> tuple[list[tuple[datetime, datetime]], list[tuple[datetime, datetime]], bool]:
    start = normalize_datetime(start_at)
    end = normalize_datetime(end_at)
    recent_cutoff = end - timedelta(days=recent_window_days)
    archive_cutoff = end - timedelta(days=archive_window_days)
    clipped = start < archive_cutoff
    effective_start = max(start, archive_cutoff)

    archive_windows: list[tuple[datetime, datetime]] = []
    recent_windows: list[tuple[datetime, datetime]] = []
    if effective_start < recent_cutoff:
        archive_windows = time_chunks(effective_start, min(recent_cutoff, end), chunk_days=30)
    if end > recent_cutoff:
        recent_windows = time_chunks(max(effective_start, recent_cutoff), end, chunk_days=7)
    return recent_windows, archive_windows, clipped



def okx_collect_funding_entries(
    payload: LiveSnapshotRequest,
    symbol: str,
    *,
    start_at: datetime,
    end_at: datetime,
    split_billing_windows: Callable[..., tuple[list[tuple[datetime, datetime]], list[tuple[datetime, datetime]], bool]],
    signed_get: Callable[[LiveSnapshotRequest, str, Optional[dict[str, Any]]], Any],
    ms: Callable[[datetime], int],
    coerce_text: Callable[[Any], str],
    safe_float: Callable[[Any, float], float],
    normalize_datetime: Callable[[Any], datetime],
    sort_and_dedupe_funding: Callable[[Iterable[LiveFundingEntry]], list[LiveFundingEntry]],
) -> tuple[list[LiveFundingEntry], bool, bool]:
    recent_windows, archive_windows, clipped = split_billing_windows(start_at, end_at)
    entries: list[LiveFundingEntry] = []
    truncated = False

    def collect(path: str, windows: list[tuple[datetime, datetime]]) -> None:
        nonlocal truncated
        for window_start, window_end in windows:
            page = signed_get(
                payload,
                path,
                {
                    "instType": "SWAP",
                    "instId": symbol,
                    "type": 8,
                    "begin": ms(window_start),
                    "end": ms(window_end),
                    "limit": 100,
                },
            )
            if not isinstance(page, list):
                continue
            if len(page) >= 100:
                truncated = True
            for item in page:
                if not isinstance(item, dict):
                    continue
                subtype = coerce_text(item.get("subType"))
                if subtype not in {"173", "174", ""} and safe_float(item.get("pnl"), 0.0) == 0.0:
                    continue
                amount = safe_float(item.get("pnl"), fallback=safe_float(item.get("balChg"), fallback=0.0))
                if subtype == "173" and amount > 0:
                    amount = -amount
                if subtype == "174" and amount < 0:
                    amount = abs(amount)
                entries.append(
                    LiveFundingEntry(
                        timestamp=normalize_datetime(item.get("ts")),
                        amount=amount,
                        currency=coerce_text(item.get("ccy")) or None,
                    )
                )

    collect("/api/v5/account/bills-archive", archive_windows)
    collect("/api/v5/account/bills", recent_windows)

    return sort_and_dedupe_funding(entries), truncated, clipped


def okx_collect_ledger_entries(
    payload: LiveSnapshotRequest,
    symbol: str,
    *,
    start_at: datetime,
    end_at: datetime,
    split_billing_windows: Callable[..., tuple[list[tuple[datetime, datetime]], list[tuple[datetime, datetime]], bool]],
    signed_get: Callable[[LiveSnapshotRequest, str, Optional[dict[str, Any]]], Any],
    ms: Callable[[datetime], int],
    coerce_text: Callable[[Any], str],
    safe_float: Callable[[Any, float], float],
    normalize_datetime: Callable[[Any], datetime],
) -> tuple[list[LiveLedgerEntry], bool, bool]:
    recent_windows, archive_windows, clipped = split_billing_windows(start_at, end_at)
    entries: list[LiveLedgerEntry] = []
    truncated = False
    seen: set[tuple[str, str, str, str, str, str]] = set()

    def append_entry(entry: LiveLedgerEntry) -> None:
        key = (
            entry.kind,
            entry.timestamp.isoformat(),
            f"{entry.amount:.12f}",
            f"{entry.fee:.12f}",
            entry.order_id or "",
            entry.trade_id or "",
        )
        if key in seen:
            return
        seen.add(key)
        entries.append(entry)

    def collect(path: str, windows: list[tuple[datetime, datetime]]) -> None:
        nonlocal truncated
        for window_start, window_end in windows:
            cursor_after: str | None = None
            while True:
                params: dict[str, Any] = {
                    "instType": "SWAP",
                    "instId": symbol,
                    "begin": ms(window_start),
                    "end": ms(window_end),
                    "limit": 100,
                }
                if cursor_after:
                    params["after"] = cursor_after
                page = signed_get(payload, path, params)
                if not isinstance(page, list) or not page:
                    break
                if len(page) >= 100:
                    truncated = True
                for item in page:
                    if not isinstance(item, dict) or item.get("ts") is None:
                        continue
                    entry_type = coerce_text(item.get("type"))
                    if entry_type != "2":
                        continue
                    timestamp = normalize_datetime(item.get("ts"))
                    currency = coerce_text(item.get("ccy")) or None
                    order_id_raw = coerce_text(item.get("ordId"))
                    trade_id_raw = coerce_text(item.get("tradeId"))
                    order_id = order_id_raw or None
                    trade_id = trade_id_raw if trade_id_raw and trade_id_raw != "0" else None
                    pnl = safe_float(item.get("pnl"), 0.0)
                    fee = abs(safe_float(item.get("fee"), 0.0))

                    if abs(pnl) > 1e-9:
                        append_entry(
                            LiveLedgerEntry(
                                timestamp=timestamp,
                                kind="trade",
                                amount=pnl,
                                pnl=pnl,
                                currency=currency,
                                order_id=order_id,
                                trade_id=trade_id,
                                note="账单已实现盈亏",
                            )
                        )

                    if fee > 1e-9:
                        append_entry(
                            LiveLedgerEntry(
                                timestamp=timestamp,
                                kind="fee",
                                amount=-fee,
                                fee=fee,
                                currency=currency,
                                order_id=order_id,
                                trade_id=trade_id,
                                note="账单手续费",
                            )
                        )

                if len(page) < 100:
                    break
                last_bill_id = coerce_text(page[-1].get("billId")) if isinstance(page[-1], dict) else ""
                if not last_bill_id:
                    break
                cursor_after = last_bill_id

    collect("/api/v5/account/bills-archive", archive_windows)
    collect("/api/v5/account/bills", recent_windows)

    return sorted(entries, key=lambda item: item.timestamp, reverse=True), truncated, clipped



def okx_bot_list_param_variants(
    extra_params: Optional[dict[str, Any]] = None,
    *,
    algo_type_candidates: Iterable[str],
) -> list[dict[str, Any]]:
    variants: list[dict[str, Any]] = []
    for algo_ord_type in algo_type_candidates:
        params = {"algoOrdType": algo_ord_type}
        if extra_params:
            params.update(extra_params)
        variants.append(params)
    return variants



def okx_signed_get_robot_list(
    payload: LiveRobotListRequest,
    path: str,
    params: Optional[dict[str, Any]] = None,
    *,
    query_string: Callable[[dict[str, Any]], str],
    request_json: Callable[..., Any],
    iso_timestamp: Callable[[], str],
    sanitize_error_message: Callable[[str], str],
    base_url: str,
) -> Any:
    query = query_string(params or {})
    request_path = f"{path}?{query}" if query else path
    timestamp = iso_timestamp()
    pre_sign = f"{timestamp}GET{request_path}"
    signature = base64.b64encode(
        hmac.new(
            payload.credentials.api_secret.encode("utf-8"),
            pre_sign.encode("utf-8"),
            hashlib.sha256,
        ).digest()
    ).decode("utf-8")
    response = request_json(
        "GET",
        f"{base_url}{request_path}",
        headers={
            "OK-ACCESS-KEY": payload.credentials.api_key,
            "OK-ACCESS-SIGN": signature,
            "OK-ACCESS-TIMESTAMP": timestamp,
            "OK-ACCESS-PASSPHRASE": payload.credentials.passphrase or "",
        },
    )
    if not isinstance(response, dict):
        raise LiveSnapshotError("OKX 返回了无效响应", status_code=502, retryable=True)
    code = str(response.get("code") or "0")
    if code not in {"0", ""}:
        raise LiveSnapshotError(
            sanitize_error_message(str(response.get("msg") or f"code={code}")),
            status_code=400,
        )
    return response.get("data") if isinstance(response.get("data"), list) else []



def okx_bot_param_variants(
    payload: LiveSnapshotRequest,
    extra_params: Optional[dict[str, Any]] = None,
    *,
    algo_type_candidates: Iterable[str],
) -> list[dict[str, Any]]:
    variants: list[dict[str, Any]] = []
    for algo_ord_type in algo_type_candidates:
        params = {"algoId": payload.algo_id or "", "algoOrdType": algo_ord_type}
        if extra_params:
            params.update(extra_params)
        variants.append(params)
    return variants



def okx_bot_get_first_available(
    payload: LiveSnapshotRequest,
    paths: tuple[str, ...],
    *,
    extra_params: Optional[dict[str, Any]] = None,
    required: bool = False,
    okx_signed_get: Callable[[LiveSnapshotRequest, str, Optional[dict[str, Any]]], Any],
    bot_param_variants: Callable[[LiveSnapshotRequest, Optional[dict[str, Any]]], list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], bool]:
    errors: list[LiveSnapshotError] = []
    had_success = False
    for path in paths:
        for params in bot_param_variants(payload, extra_params):
            try:
                data = okx_signed_get(payload, path, params)
                had_success = True
                if isinstance(data, list):
                    if data:
                        return data, True
                    continue
                continue
            except LiveSnapshotError as exc:
                errors.append(exc)
    if required and not had_success:
        if errors:
            raise errors[-1]
        raise LiveSnapshotError(
            "OKX 机器人接口暂不可用，请稍后重试。",
            status_code=502,
            code="LIVE_BOT_API_UNAVAILABLE",
            retryable=True,
        )
    return [], had_success



def okx_bot_sub_order_paths(
    entry_type: str,
    *,
    pending_paths: tuple[str, ...],
    history_paths: tuple[str, ...],
    sub_order_path: str,
) -> tuple[str, ...]:
    if entry_type == "live":
        return (*pending_paths, sub_order_path)
    if entry_type == "filled":
        return (*history_paths, sub_order_path)
    return (sub_order_path,)



def okx_bot_get_sub_orders(
    payload: LiveSnapshotRequest,
    entry_type: str,
    *,
    limit: int,
    start_at: datetime | None,
    max_items: int,
    normalize_datetime: Callable[[Any], datetime],
    sub_order_paths: Callable[[str], tuple[str, ...]],
    bot_param_variants: Callable[[LiveSnapshotRequest, Optional[dict[str, Any]]], list[dict[str, Any]]],
    retry_live_action: Callable[[Callable[[], Any], int], Any],
    okx_signed_get: Callable[[LiveSnapshotRequest, str, Optional[dict[str, Any]]], Any],
    first_present: Callable[..., Any],
    optional_datetime: Callable[[Any], datetime | None],
    coerce_optional_text: Callable[[Any], str | None],
) -> tuple[list[dict[str, Any]], bool, int, bool]:
    collected: list[dict[str, Any]] = []
    page_count = 0
    capped = False
    cursor_after: str | None = None
    start_boundary = normalize_datetime(start_at) if start_at is not None else None
    candidate_paths = sub_order_paths(entry_type)

    while True:
        page: list[dict[str, Any]] | None = None
        success = False
        for path in candidate_paths:
            extra_params: dict[str, Any] = {"limit": limit, "after": cursor_after}
            if path.endswith("/grid/sub-orders"):
                extra_params["type"] = entry_type
            for params in bot_param_variants(payload, extra_params):
                params = {key: value for key, value in params.items() if value not in {None, ""}}
                try:
                    raw = retry_live_action(lambda: okx_signed_get(payload, path, params), retries=2)
                    page = [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
                    success = True
                    break
                except LiveSnapshotError:
                    continue
            if success:
                break
        if not success:
            return collected, False, page_count, capped
        page_count += 1
        if not page:
            return collected, True, page_count, capped

        should_stop = False
        for item in page:
            timestamp_value = first_present(item, "uTime", "fillTime", "cTime", "ts")
            item_dt = optional_datetime(timestamp_value) if timestamp_value is not None else None
            if start_boundary is not None and item_dt is not None and item_dt < start_boundary:
                should_stop = True
                continue
            collected.append(item)
            if len(collected) >= max_items:
                capped = True
                return collected[:max_items], True, page_count, capped
        if len(page) < limit:
            return collected, True, page_count, capped
        if should_stop:
            return collected, True, page_count, capped
        cursor_after = coerce_optional_text(first_present(page[-1], "ordId", "tradeId"))
        if not cursor_after:
            return collected, True, page_count, capped
