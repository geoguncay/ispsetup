"""
Endpoints de autenticación: login, refresh, logout y setup inicial.

Dos formas de crear el admin:
  1. Seed automático al iniciar la API en modo development (app/core/seed.py)
  2. POST /api/auth/setup — funciona en cualquier entorno; requiere ADMIN_SEED_KEY
"""
from fastapi import APIRouter, HTTPException, Request, status
from jose import JWTError
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.deps import CurrentUser, DBSession
from app.core.redis import REFRESH_TOKEN_PREFIX, REFRESH_TOKEN_TTL, redis_client
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.user import LoginRequest, RefreshRequest, TokenResponse, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Schemas exclusivos de /setup ─────────────────────────────────────────────
class SetupRequest(BaseModel):
    seed_key: str = Field(description="Debe coincidir con ADMIN_SEED_KEY del .env")
    email: EmailStr | None = Field(
        default=None,
        description="Si se omite, usa ADMIN_SEED_EMAIL del .env",
    )
    password: str | None = Field(
        default=None,
        min_length=8,
        description="Si se omite, usa ADMIN_SEED_PASSWORD del .env",
    )
    name: str | None = Field(
        default=None,
        description="Si se omite, usa ADMIN_SEED_NAME del .env",
    )


class SetupResponse(BaseModel):
    created: bool
    message: str
    email: str


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: DBSession, request: Request) -> TokenResponse:
    """
    Autentica al usuario con email/password.
    Devuelve access_token (Bearer) y almacena refresh_token en Redis.
    """
    user: User | None = db.query(User).filter(User.email == payload.email).first()

    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
        )
    if not user.active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo. Contacte al administrador.",
        )

    user_id = str(user.id)
    access_token = create_access_token({"sub": user_id, "role": user.role})
    refresh_token = create_refresh_token(user_id)

    # Guardar refresh token en Redis con TTL de 7 días
    await redis_client.setex(
        f"{REFRESH_TOKEN_PREFIX}{user_id}",
        REFRESH_TOKEN_TTL,
        refresh_token,
    )

    from app.services.audit_service import AuditAction, log_event
    log_event(
        db,
        action=AuditAction.USER_LOGIN,
        entity_type="User",
        entity_id=str(user.id),
        entity_name=user.name,
        user_id=user.id,
        user_name=user.name,
        ip_address=request.client.host if request.client else None,
    )

    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, db: DBSession) -> TokenResponse:
    """
    Valida el refresh token contra Redis y emite un nuevo access token.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Refresh token inválido o expirado",
    )
    try:
        token_data = decode_token(payload.refresh_token)
        if token_data.get("type") != "refresh":
            raise credentials_exception
        user_id: str = token_data.get("sub")
    except JWTError:
        raise credentials_exception

    # Verificar que el token en Redis coincida (invalida logout previo)
    stored = await redis_client.get(f"{REFRESH_TOKEN_PREFIX}{user_id}")
    if stored != payload.refresh_token:
        raise credentials_exception

    user = db.get(User, user_id)
    if not user or not user.active:
        raise credentials_exception

    new_access = create_access_token({"sub": user_id, "role": user.role})
    new_refresh = create_refresh_token(user_id)

    # Rotar refresh token
    await redis_client.setex(
        f"{REFRESH_TOKEN_PREFIX}{user_id}",
        REFRESH_TOKEN_TTL,
        new_refresh,
    )

    return TokenResponse(access_token=new_access, refresh_token=new_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(current_user: CurrentUser) -> None:
    """
    Invalida el refresh token del usuario en Redis.
    """
    await redis_client.delete(f"{REFRESH_TOKEN_PREFIX}{str(current_user.id)}")


@router.get("/me", response_model=UserRead)
async def me(current_user: CurrentUser) -> User:
    """Devuelve el perfil del usuario autenticado."""
    return current_user


@router.post(
    "/setup",
    response_model=SetupResponse,
    summary="Crear usuario admin inicial",
    description=(
        "Crea el usuario administrador inicial mediante una clave secreta. "
        "Funciona en cualquier entorno (dev y producción). "
        "Requiere que `ADMIN_SEED_KEY` esté definida en las variables de entorno. "
        "Devuelve 409 si ya existe un administrador activo. "
        "Este endpoint es idempotente: llamarlo múltiples veces con la misma clave "
        "no duplica el usuario."
    ),
)
def setup_admin(payload: SetupRequest, db: DBSession) -> SetupResponse:
    """
    **Forma 2** de crear el admin: endpoint protegido por ADMIN_SEED_KEY.

    - Si `ADMIN_SEED_KEY` no está configurada en el .env → 501 Not Implemented
    - Si `seed_key` no coincide → 403 Forbidden
    - Si ya existe un admin activo → 409 Conflict (idempotente: no falla si el email es el mismo)
    - En cualquier otro caso → crea el usuario y devuelve 200
    """
    # 1. Verificar que la clave esté configurada en el servidor
    if not settings.ADMIN_SEED_KEY:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                "ADMIN_SEED_KEY no está configurada. "
                "Agrégala al .env para habilitar este endpoint."
            ),
        )

    # 2. Verificar que la clave enviada coincida
    if payload.seed_key != settings.ADMIN_SEED_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clave de setup inválida.",
        )

    # 3. Determinar datos del admin (payload tiene prioridad sobre el .env)
    admin_email = payload.email or settings.ADMIN_SEED_EMAIL
    admin_password = payload.password or settings.ADMIN_SEED_PASSWORD
    admin_name = payload.name or settings.ADMIN_SEED_NAME

    # 4. Verificar si ya existe un usuario con ese email
    existing = db.query(User).filter(User.email == admin_email).first()
    if existing:
        if existing.role == "admin":
            return SetupResponse(
                created=False,
                message=f"El administrador '{admin_email}' ya existe. No se realizaron cambios.",
                email=admin_email,
            )
        # Existe pero no es admin → promoverlo
        existing.role = "admin"
        existing.active = True
        db.commit()
        return SetupResponse(
            created=False,
            message=f"Usuario '{admin_email}' promovido a administrador.",
            email=admin_email,
        )

    # 5. Verificar que no haya ya otro admin activo (protección extra)
    existing_admin = (
        db.query(User).filter(User.role == "admin", User.active == True).first()
    )
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ya existe un administrador activo ({existing_admin.email}). "
                "Si necesitas crear otro, hazlo desde el panel de usuarios."
            ),
        )

    # 6. Crear el usuario admin
    admin = User(
        name=admin_name,
        email=admin_email,
        hashed_password=hash_password(admin_password),
        role="admin",
        active=True,
    )
    db.add(admin)
    try:
        db.commit()
        db.refresh(admin)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Conflicto al crear el usuario '{admin_email}'.",
        )

    return SetupResponse(
        created=True,
        message=f"✅ Administrador '{admin_name}' creado exitosamente con email {admin_email}.",
        email=admin_email,
    )
