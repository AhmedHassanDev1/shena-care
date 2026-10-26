import hmac

from fastapi import Header, HTTPException, status

from app.core.config import get_settings


def require_service_token(authorization: str | None = Header(default=None)) -> None:
    """Only the ShenaCare API may call the /v1 routes: they spend the provider key and carry customer context.

    Fails closed: with no AI_SERVICE_TOKEN configured the routes refuse every call, unless the
    local-development switch AI_ALLOW_UNAUTHENTICATED is on.
    """
    settings = get_settings()
    if not settings.service_token:
        if settings.allow_unauthenticated:
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI service token is not configured",
        )

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token.encode(), settings.service_token.encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service token",
            headers={"WWW-Authenticate": "Bearer"},
        )
