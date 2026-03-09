from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from typing import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security.utils import get_authorization_scheme_param

try:
    import jwt
except ModuleNotFoundError:  # pragma: no cover - fallback for partially provisioned envs
    jwt = None


class Role(str, Enum):
    VIEWER = "viewer"
    OPERATOR = "operator"
    ADMIN = "admin"


_ROLE_RANK = {
    Role.VIEWER: 1,
    Role.OPERATOR: 2,
    Role.ADMIN: 3,
}


@dataclass(frozen=True)
class AuthPrincipal:
    subject: str
    role: Role
    auth_type: str


def _truthy(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def auth_enabled() -> bool:
    return _truthy(os.getenv("APP_AUTH_ENABLED"), default=True)


def public_mode_enabled() -> bool:
    explicit = os.getenv("APP_PUBLIC_MODE")
    if explicit is not None:
        return _truthy(explicit, default=False)
    return not auth_enabled()


def _parse_role(raw: str) -> Role | None:
    try:
        return Role(raw.strip().lower())
    except ValueError:
        return None


def _parse_token_map(raw: str, auth_type: str) -> dict[str, AuthPrincipal]:
    result: dict[str, AuthPrincipal] = {}
    for chunk in raw.split(","):
        item = chunk.strip()
        if not item:
            continue
        parts = [part.strip() for part in item.split(":")]
        if len(parts) < 2:
            continue
        token = parts[0]
        role = _parse_role(parts[1])
        if not token or role is None:
            continue
        subject = parts[2] if len(parts) >= 3 and parts[2] else f"{auth_type}:{role.value}"
        result[token] = AuthPrincipal(subject=subject, role=role, auth_type=auth_type)
    return result


def _api_key_map() -> dict[str, AuthPrincipal]:
    raw = os.getenv("APP_AUTH_API_KEYS", "")
    return _parse_token_map(raw, auth_type="api_key")


def _bearer_token_map() -> dict[str, AuthPrincipal]:
    raw = os.getenv("APP_AUTH_BEARER_TOKENS", "")
    return _parse_token_map(raw, auth_type="bearer")


def _decode_jwt_principal(token: str) -> AuthPrincipal | None:
    secret = os.getenv("APP_AUTH_JWT_SECRET", "").strip()
    if not secret:
        return None
    if jwt is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务端缺少 JWT 依赖（PyJWT），无法校验 Bearer Token",
        )

    algorithm = os.getenv("APP_AUTH_JWT_ALGORITHM", "HS256").strip() or "HS256"
    audience = os.getenv("APP_AUTH_JWT_AUDIENCE", "").strip()
    issuer = os.getenv("APP_AUTH_JWT_ISSUER", "").strip()
    role_claim = os.getenv("APP_AUTH_JWT_ROLE_CLAIM", "role").strip() or "role"
    subject_claim = os.getenv("APP_AUTH_JWT_SUB_CLAIM", "sub").strip() or "sub"

    decode_kwargs: dict[str, object] = {
        "algorithms": [algorithm],
        "options": {"verify_aud": bool(audience)},
    }
    if audience:
        decode_kwargs["audience"] = audience
    if issuer:
        decode_kwargs["issuer"] = issuer

    try:
        payload = jwt.decode(token, secret, **decode_kwargs)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"JWT 无效: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    role_raw = payload.get(role_claim)
    role = _parse_role(str(role_raw)) if role_raw is not None else None
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"JWT 缺少合法角色声明: {role_claim}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    subject_raw = payload.get(subject_claim)
    subject = str(subject_raw).strip() if subject_raw else "jwt-user"
    return AuthPrincipal(subject=subject, role=role, auth_type="jwt")


def authenticate_request(request: Request) -> AuthPrincipal:
    if not auth_enabled():
        return AuthPrincipal(subject="auth-disabled", role=Role.ADMIN, auth_type="disabled")

    api_key = request.headers.get("X-API-Key", "").strip()
    if api_key:
        principal = _api_key_map().get(api_key)
        if principal:
            return principal

    auth_header = request.headers.get("Authorization")
    scheme, credential = get_authorization_scheme_param(auth_header)
    if scheme and scheme.lower() == "bearer" and credential:
        static_bearer = _bearer_token_map().get(credential)
        if static_bearer:
            return static_bearer
        jwt_principal = _decode_jwt_principal(credential)
        if jwt_principal:
            return jwt_principal

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="缺少或无效的认证凭据，请提供 X-API-Key 或 Bearer Token",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_principal(request: Request) -> AuthPrincipal:
    principal = getattr(request.state, "principal", None)
    if isinstance(principal, AuthPrincipal):
        return principal
    return authenticate_request(request)


def require_min_role(required_role: Role) -> Callable[..., AuthPrincipal]:
    def _dependency(principal: AuthPrincipal = Depends(get_current_principal)) -> AuthPrincipal:
        if _ROLE_RANK[principal.role] < _ROLE_RANK[required_role]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足：需要角色 {required_role.value}",
            )
        return principal

    return _dependency
