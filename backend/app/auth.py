from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings


@dataclass(frozen=True)
class AuthUser:
    id: UUID
    email: str | None
    access_token: str


class InvalidTokenError(ValueError):
    pass


class AuthServiceUnavailableError(RuntimeError):
    pass


class TokenVerifier(Protocol):
    async def verify(self, access_token: str) -> AuthUser: ...


class SupabaseTokenVerifier:
    """Validate bearer tokens against the project's Supabase Auth service."""

    def __init__(self, settings: Settings) -> None:
        self.url = settings.supabase_url.rstrip("/")
        self.anon_key = settings.supabase_anon_key

    async def verify(self, access_token: str) -> AuthUser:
        if not self.url or not self.anon_key:
            raise AuthServiceUnavailableError("Supabase Auth is not configured")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(
                    f"{self.url}/auth/v1/user",
                    headers={
                        "apikey": self.anon_key,
                        "Authorization": f"Bearer {access_token}",
                    },
                )
        except httpx.HTTPError as error:
            raise AuthServiceUnavailableError("Supabase Auth is unavailable") from error

        if response.status_code != 200:
            raise InvalidTokenError("expired or invalid access token")
        payload = response.json()
        try:
            user_id = UUID(payload["id"])
        except (KeyError, TypeError, ValueError) as error:
            raise InvalidTokenError("Supabase Auth returned an invalid user") from error
        return AuthUser(id=user_id, email=payload.get("email"), access_token=access_token)


bearer_scheme = HTTPBearer(auto_error=False)
bearer_dependency = Depends(bearer_scheme)
token_verifier: TokenVerifier = SupabaseTokenVerifier(get_settings())


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = bearer_dependency,
) -> AuthUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return await token_verifier.verify(credentials.credentials)
    except InvalidTokenError as error:
        raise HTTPException(
            status_code=401,
            detail=str(error),
            headers={"WWW-Authenticate": "Bearer"},
        ) from error
    except AuthServiceUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
