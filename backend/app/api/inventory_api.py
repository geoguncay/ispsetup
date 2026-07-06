"""
Endpoints CRUD de Inventario/Stock (InventoryItem) y Categorías (ProductCategory).
"""
import uuid
from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import AdminOrTechnician, DBSession
from app.models.inventory import InventoryItem
from app.models.supplier import Supplier
from app.models.product_category import ProductCategory
from app.schemas.inventory_schema import InventoryItemCreate, InventoryItemUpdate, InventoryItemResponse
from app.schemas.product_category_schema import ProductCategoryCreate, ProductCategoryUpdate, ProductCategoryResponse

router = APIRouter(prefix="/inventory", tags=["inventory"])


# ── Categorías ────────────────────────────────────────────────────────────────

@router.get("/categories", response_model=list[ProductCategoryResponse])
def list_categories(db: DBSession, _: AdminOrTechnician) -> list[ProductCategory]:
    """Lista todas las categorías de productos ordenadas por nombre."""
    return db.query(ProductCategory).order_by(ProductCategory.name.asc()).all()


@router.post("/categories", response_model=ProductCategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: ProductCategoryCreate,
    db: DBSession,
    _: AdminOrTechnician,
) -> ProductCategory:
    """Crea una nueva categoría de producto."""
    exists = db.query(ProductCategory).filter(ProductCategory.name == payload.name).first()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe la categoría '{payload.name}'.",
        )
    cat = ProductCategory(name=payload.name)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/categories/{category_id}", response_model=ProductCategoryResponse)
def update_category(
    category_id: uuid.UUID,
    payload: ProductCategoryUpdate,
    db: DBSession,
    _: AdminOrTechnician,
) -> ProductCategory:
    """Renombra una categoría y actualiza todos los artículos que la usaban."""
    cat = db.get(ProductCategory, category_id)
    if not cat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoría no encontrada")
    old_name = cat.name
    cat.name = payload.name
    db.query(InventoryItem).filter(InventoryItem.category == old_name).update({"category": payload.name})
    db.commit()
    db.refresh(cat)
    return cat


# ── Artículos de Inventario ───────────────────────────────────────────────────

@router.get("", response_model=list[InventoryItemResponse])
def list_inventory_items(
    db: DBSession,
    _: AdminOrTechnician,
    search: str | None = None,
) -> list[InventoryItem]:
    """Lista todos los artículos en inventario con buscador opcional."""
    query = db.query(InventoryItem)
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            (InventoryItem.name.ilike(search_filter))
            | (InventoryItem.code.ilike(search_filter))
        )
    return query.order_by(InventoryItem.name.asc()).all()


@router.get("/{item_id}", response_model=InventoryItemResponse)
def get_inventory_item(
    item_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTechnician,
) -> InventoryItem:
    """Obtiene el detalle de un artículo de inventario."""
    item = db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artículo no encontrado")
    return item


@router.post("", response_model=InventoryItemResponse, status_code=status.HTTP_201_CREATED)
def create_inventory_item(
    payload: InventoryItemCreate,
    db: DBSession,
    _: AdminOrTechnician,
) -> InventoryItem:
    """Crea un nuevo artículo de inventario."""
    exists = db.query(InventoryItem).filter(InventoryItem.code == payload.code).first()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un artículo en inventario con el código o SKU {payload.code}.",
        )

    if payload.supplier_id:
        supplier = db.get(Supplier, payload.supplier_id)
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El proveedor especificado no existe.",
            )
            
    item = InventoryItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{item_id}", response_model=InventoryItemResponse)
def update_inventory_item(
    item_id: uuid.UUID,
    payload: InventoryItemUpdate,
    db: DBSession,
    _: AdminOrTechnician,
) -> InventoryItem:
    """Edita un artículo de inventario."""
    item = db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artículo no encontrado")
        
    update_data = payload.model_dump(exclude_unset=True)

    if "code" in update_data and update_data["code"] != item.code:
        exists = db.query(InventoryItem).filter(InventoryItem.code == update_data["code"]).first()
        if exists:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe un artículo con el código o SKU {update_data['code']}.",
            )

    if "supplier_id" in update_data and update_data["supplier_id"]:
        supplier = db.get(Supplier, update_data["supplier_id"])
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El proveedor especificado no existe.",
            )
            
    for field, value in update_data.items():
        setattr(item, field, value)
        
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory_item(
    item_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTechnician,
) -> None:
    """Elimina un artículo de inventario."""
    item = db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artículo no encontrado")
    db.delete(item)
    db.commit()


@router.post("/import")
def import_inventory_items(
    payload: list[dict],
    db: DBSession,
    _: AdminOrTechnician,
) -> dict:
    """
    Importa artículos de inventario desde datos JSON (parseados de un CSV en el frontend).
    Valida campos requeridos, duplicados de código/SKU, y resuelve proveedores por nombre.
    """
    successes = []
    failures = []
    seen_codes: set[str] = set()

    # Pre-load suppliers for name-matching
    all_suppliers = db.query(Supplier).all()
    supplier_map = {s.name.strip().lower(): s for s in all_suppliers}

    for idx, row in enumerate(payload):
        try:
            name = (row.get("nombre") or "").strip()
            code = (row.get("codigo") or "").strip()
            quantity_raw = row.get("cantidad", "0")
            min_alert_raw = row.get("minimo_alerta", "5")
            purchase_price_raw = row.get("precio_compra", "0")
            sale_price_raw = row.get("precio_venta", "0")
            description = (row.get("descripcion") or "").strip() or None
            category = (row.get("categoria") or "").strip() or None
            model = (row.get("modelo") or "").strip() or None
            supplier_raw = (row.get("proveedor") or "").strip()

            errors = []
            if not name:
                errors.append("El nombre del producto es requerido.")
            if not code:
                errors.append("El código/SKU es requerido.")

            # Parse numeric fields safely
            try:
                quantity = int(float(quantity_raw)) if quantity_raw else 0
            except (ValueError, TypeError):
                errors.append(f"Cantidad inválida: '{quantity_raw}'.")
                quantity = 0

            try:
                min_alert = int(float(min_alert_raw)) if min_alert_raw else 5
            except (ValueError, TypeError):
                errors.append(f"Mínimo alerta inválido: '{min_alert_raw}'.")
                min_alert = 5

            try:
                purchase_price = float(purchase_price_raw) if purchase_price_raw else 0.0
            except (ValueError, TypeError):
                errors.append(f"Precio compra inválido: '{purchase_price_raw}'.")
                purchase_price = 0.0

            try:
                sale_price = float(sale_price_raw) if sale_price_raw else 0.0
            except (ValueError, TypeError):
                errors.append(f"Precio venta inválido: '{sale_price_raw}'.")
                sale_price = 0.0

            # Check duplicate code within file
            if code:
                if code in seen_codes:
                    errors.append(f"El código '{code}' está duplicado dentro del archivo.")
                else:
                    seen_codes.add(code)
                    exists = db.query(InventoryItem).filter(InventoryItem.code == code).first()
                    if exists:
                        errors.append(f"Ya existe un artículo con el código '{code}' en el sistema.")

            # Resolve supplier by name
            supplier_id = None
            if supplier_raw:
                supplier = supplier_map.get(supplier_raw.lower())
                if supplier:
                    supplier_id = supplier.id
                else:
                    errors.append(f"El proveedor '{supplier_raw}' no fue encontrado en el sistema.")

            if errors:
                failures.append({
                    "row": idx + 1,
                    "code": code,
                    "name": name,
                    "errors": errors
                })
                continue

            item = InventoryItem(
                name=name,
                code=code,
                quantity=quantity,
                min_alert=min_alert,
                purchase_price=purchase_price,
                sale_price=sale_price,
                description=description,
                category=category,
                model=model,
                supplier_id=supplier_id,
            )
            db.add(item)
            db.flush()
            successes.append({
                "row": idx + 1,
                "code": code,
                "name": name
            })
        except Exception as e:
            db.rollback()
            failures.append({
                "row": idx + 1,
                "code": (row.get("codigo") or ""),
                "name": (row.get("nombre") or ""),
                "errors": [str(e)]
            })

    if successes:
        db.commit()

    return {
        "success": len(failures) == 0,
        "total": len(payload),
        "imported_count": len(successes),
        "failed_count": len(failures),
        "successes": successes,
        "failures": failures
    }
