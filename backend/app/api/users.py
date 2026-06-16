"""
Endpoints CRUD de usuarios (solo admin).
"""
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.core.deps import AdminOnly, CurrentUser, DBSession
from app.core.security import hash_password
from app.models.user import User
from app.schemas.user import ClientStats, UserCreate, UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserRead])
def list_users(db: DBSession, _: AdminOnly) -> list[User]:
    return db.query(User).order_by(User.created_at.desc()).all()


@router.get("/stats", response_model=ClientStats)
def get_client_stats(db: DBSession, _: AdminOnly) -> ClientStats:
    """
    Retorna conteo de clientes (usuarios no-admin) agrupados por estado.
      - conectados  → activo=True  y rol != 'admin'
      - suspendidos → activo=False y rol != 'admin'
    """
    base_q = db.query(User).filter(User.rol != "admin")
    total = base_q.count()
    conectados = base_q.filter(User.activo == True).count()  # noqa: E712
    suspendidos = base_q.filter(User.activo == False).count()  # noqa: E712
    desconectados = 0  # Se calculará con datos de sesiones MikroTik en fases futuras
    return ClientStats(
        total=total,
        conectados=conectados,
        desconectados=desconectados,
        suspendidos=suspendidos,
    )


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: DBSession, _: AdminOnly) -> User:
    user = User(
        nombre=payload.nombre,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        rol=payload.rol,
        activo=payload.activo,
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un usuario con email {payload.email}",
        )
    return user


@router.get("/me", response_model=UserRead)
def get_me(current_user: CurrentUser) -> User:
    return current_user


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: uuid.UUID, db: DBSession, _: AdminOnly) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    return user


@router.put("/{user_id}", response_model=UserRead)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: DBSession,
    current_user: CurrentUser,
) -> User:
    # Admin puede editar cualquier usuario; los demás solo su propio perfil
    if current_user.rol != "admin" and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permisos")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    if "password" in update_data:
        update_data["hashed_password"] = hash_password(update_data.pop("password"))

    for field, value in update_data.items():
        setattr(user, field, value)

    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email ya en uso")

    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: uuid.UUID, db: DBSession, _: AdminOnly) -> None:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    db.delete(user)
    db.commit()
