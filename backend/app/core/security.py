from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security.utils import get_authorization_scheme_param

from app.core.settings import get_settings

pyjwt: Any
try:
    import jwt as pyjwt
except ModuleNotFoundError:  # pragma: no cover - fallback for partially provisioned envs
    pyjwt = None


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



def auth_enabled() -> bool:
    return get_settings().app_auth_enabled



def public_mode_enabled() -> bool:
    explicit = get_settings().app_public_mode
    if explicit is not None:
        return explicit
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
    return _parse_token_map(get_settings().app_auth_api_keys, auth_type="api_key")



def _bearer_token_map() -> dict[str, AuthPrincipal]:
    return _parse_token_map(get_settings().app_auth_bearer_tokens, auth_type="bearer")



def _decode_jwt_principal(token: str) -> AuthPrincipal | None:
    settings = get_settings()
    secret = settings.app_auth_jwt_secret.strip()
    if not secret:
        return None
    if pyjwt is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务端缺少 JWT 依赖（PyJWT），无法校验 Bearer Token",
        )

    algorithm = settings.app_auth_jwt_algorithm.strip() or "HS256"
    audience = settings.app_auth_jwt_audience.strip()
    issuer = settings.app_auth_jwt_issuer.strip()
    role_claim = settings.app_auth_jwt_role_claim.strip() or "role"
    subject_claim = settings.app_auth_jwt_sub_claim.strip() or "sub"

    decode_kwargs: dict[str, Any] = {
        "algorithms": [algorithm],
        "options": {"verify_aud": bool(audience)},
    }
    if audience:
        decode_kwargs["audience"] = audience
    if issuer:
        decode_kwargs["issuer"] = issuer

    try:
        payload = pyjwt.decode(token, secret, **(decode_kwargs))
    except pyjwt.PyJWTError as exc:
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
