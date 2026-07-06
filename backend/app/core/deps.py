"""
FastAPI dependencies: sesión BD, usuario actual, control de roles.
"""
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import decode_token
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


# ── Base de datos ──────────────────────────────────────────────────────────────
def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DBSession = Annotated[Session, Depends(get_db)]


# ── Autenticación ──────────────────────────────────────────────────────────────
def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: DBSession,
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No autenticado o token inválido",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise credentials_exception

    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            raise credentials_exception
        user_id_str: str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = uuid.UUID(user_id_str)  # convertir a UUID para que SQLAlchemy lo procese correctamente
    except (JWTError, ValueError):
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.active:
        raise credentials_exception

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


# ── Control de roles ──────────────────────────────────────────────────────────
def require_role(*roles: str):
    """
    Dependency factory que valida que el usuario tenga uno de los roles indicados.
    Uso: Depends(require_role("admin", "technician"))
    """
    def _checker(current_user: CurrentUser) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Se requiere rol: {' o '.join(roles)}",
            )
        return current_user

    return _checker


AdminOnly = Annotated[User, Depends(require_role("admin"))]
AdminOrTechnician = Annotated[User, Depends(require_role("admin", "technician"))]
