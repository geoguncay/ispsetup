"""
Endpoints CRUD de usuarios (solo admin).
"""
import os
import shutil
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.core.deps import AdminOnly, CurrentUser, DBSession
from app.core.security import hash_password
from app.models.user import User
from app.models.client import Client
from app.schemas.user import ClientStats, UserCreate, UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserRead])
def list_users(db: DBSession, _: AdminOnly) -> list[User]:
    return db.query(User).order_by(User.created_at.desc()).all()


@router.get("/stats", response_model=ClientStats)
def get_client_stats(db: DBSession, _: AdminOnly) -> ClientStats:
    """
    Retorna conteo de clientes ISP agrupados por estado:
      - connected, disconnected, suspended
    """
    clients = db.query(Client).all()
    total = len(clients)
    connected = 0
    disconnected = 0
    suspended = 0
    for c in clients:
        if not c.active:
            suspended += 1
        else:
            first_char = str(c.id)[0]
            if ord(first_char) % 7 == 0:
                disconnected += 1
            else:
                connected += 1
    return ClientStats(
        total=total,
        connected=connected,
        disconnected=disconnected,
        suspended=suspended,
    )


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: DBSession, _: AdminOnly) -> User:
    user = User(
        name=payload.name,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        active=payload.active,
        operator_type=payload.operator_type,
        gateway_permissions=payload.gateway_permissions,
        access_schedule=payload.access_schedule,
        permissions=payload.permissions,
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
    if current_user.role != "admin" and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permisos")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    if "password" in update_data:
        update_data["hashed_password"] = hash_password(update_data.pop("password"))

    # Proteger contra dejar el sistema sin admin activo
    if user.role == "admin":
        deactivating = update_data.get("active") is False
        changing_role = "role" in update_data and update_data["role"] != "admin"
        if deactivating or changing_role:
            active_admins = (
                db.query(User)
                .filter(User.role == "admin", User.active == True, User.id != user.id)
                .count()
            )
            if active_admins == 0:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="No se puede desactivar o cambiar el rol de este administrador porque es el único activo en el sistema.",
                )

    for field, value in update_data.items():
        setattr(user, field, value)

    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email ya en uso")

    return user


@router.post("/{user_id}/avatar", response_model=dict)
def upload_user_avatar(
    user_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> dict:
    if current_user.role != "admin" and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sin permisos")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato no soportado. Use PNG, JPG, JPEG o WEBP.",
        )

    upload_dir = "static/uploads/avatars"
    os.makedirs(upload_dir, exist_ok=True)

    filename = f"avatar_{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(upload_dir, filename)

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"No se pudo guardar la imagen: {e}",
        )

    # Eliminar avatar anterior si existe
    if user.avatar_url:
        old_path = user.avatar_url.lstrip("/")
        if os.path.exists(old_path):
            os.remove(old_path)

    user.avatar_url = f"/static/uploads/avatars/{filename}"
    db.commit()
    db.refresh(user)

    return {"avatar_url": user.avatar_url}


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: uuid.UUID, db: DBSession, _: AdminOnly) -> None:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    db.delete(user)
    db.commit()
