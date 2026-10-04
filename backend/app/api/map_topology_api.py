"""
Endpoints de la topología del mapa de radio: puntos de acceso (AP) y enlaces editables.
"""
import uuid

from fastapi import APIRouter, HTTPException, status

from app.core.deps import AdminOrTechnician, DBSession
from app.models.client import Client
from app.models.map_topology import MapAccessPoint, MapLink
from app.models.router import Router
from app.schemas.map_topology import (
    AccessPointCreate, AccessPointRead, AccessPointUpdate,
    LinkCreate, LinkRead, LinkUpdate, NodeRef, PtpCreate, PtpRead,
)

router = APIRouter(prefix="/map", tags=["map"])

_NODE_MODELS = {"router": Router, "ap": MapAccessPoint, "client": Client}


@router.get("/access-points", response_model=list[AccessPointRead])
def list_access_points(db: DBSession, _: AdminOrTechnician) -> list:
    return db.query(MapAccessPoint).order_by(MapAccessPoint.name).all()


def _check_node(db, ref: NodeRef) -> None:
    if not db.get(_NODE_MODELS[ref.type], ref.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Nodo no encontrado ({ref.type})")


@router.post("/access-points", response_model=AccessPointRead, status_code=status.HTTP_201_CREATED)
def create_access_point(payload: AccessPointCreate, db: DBSession, _: AdminOrTechnician) -> MapAccessPoint:
    if payload.connect_to:
        _check_node(db, payload.connect_to)
    ap = MapAccessPoint(
        name=payload.name.strip(), latitude=payload.latitude, longitude=payload.longitude,
        ip=(payload.ip or "").strip() or None, frequency_mhz=payload.frequency_mhz,
    )
    db.add(ap)
    db.flush()
    if payload.connect_to:
        db.add(MapLink(kind="ap", source_type=payload.connect_to.type, source_id=payload.connect_to.id,
                       target_type="ap", target_id=ap.id))
    db.commit()
    db.refresh(ap)
    return ap


@router.post("/ptp", response_model=PtpRead, status_code=status.HTTP_201_CREATED)
def create_ptp(payload: PtpCreate, db: DBSession, _: AdminOrTechnician) -> dict:
    """Crea de una vez el AP, la antena estación y el enlace PtP entre ambos."""
    if payload.connect_to:
        _check_node(db, payload.connect_to)
    ap = MapAccessPoint(
        name=payload.ap.name.strip(), latitude=payload.ap.latitude, longitude=payload.ap.longitude,
        role="ap", ip=(payload.ap.ip or "").strip() or None, frequency_mhz=payload.frequency_mhz,
    )
    station = MapAccessPoint(
        name=payload.station.name.strip(), latitude=payload.station.latitude, longitude=payload.station.longitude,
        role="station", ip=(payload.station.ip or "").strip() or None, frequency_mhz=payload.frequency_mhz,
    )
    db.add_all([ap, station])
    db.flush()
    link = MapLink(kind="ptp", source_type="ap", source_id=ap.id, target_type="ap", target_id=station.id)
    db.add(link)
    if payload.connect_to:
        db.add(MapLink(kind="ap", source_type=payload.connect_to.type, source_id=payload.connect_to.id,
                       target_type="ap", target_id=ap.id))
    db.commit()
    for obj in (ap, station, link):
        db.refresh(obj)
    return {"ap": ap, "station": station, "link": link}


@router.put("/access-points/{ap_id}", response_model=AccessPointRead)
def update_access_point(ap_id: uuid.UUID, payload: AccessPointUpdate, db: DBSession, _: AdminOrTechnician) -> MapAccessPoint:
    ap = db.get(MapAccessPoint, ap_id)
    if not ap:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AP no encontrado")
    if payload.name is not None:
        ap.name = payload.name.strip()
    if payload.latitude is not None:
        ap.latitude = payload.latitude
    if payload.longitude is not None:
        ap.longitude = payload.longitude
    if "ip" in payload.model_fields_set:
        ap.ip = (payload.ip or "").strip() or None
    if "frequency_mhz" in payload.model_fields_set:
        ap.frequency_mhz = payload.frequency_mhz
    db.commit()
    db.refresh(ap)
    return ap


@router.delete("/access-points/{ap_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_access_point(ap_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> None:
    ap = db.get(MapAccessPoint, ap_id)
    if not ap:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AP no encontrado")
    # Los enlaces que tocan al AP dejan de tener sentido.
    db.query(MapLink).filter(
        ((MapLink.source_type == "ap") & (MapLink.source_id == ap_id))
        | ((MapLink.target_type == "ap") & (MapLink.target_id == ap_id))
    ).delete(synchronize_session=False)
    db.delete(ap)
    db.commit()


@router.get("/links", response_model=list[LinkRead])
def list_links(db: DBSession, _: AdminOrTechnician) -> list:
    return db.query(MapLink).all()


def _validate_endpoints(db, link_id: uuid.UUID | None, st: str, sid: uuid.UUID, tt: str, tid: uuid.UUID) -> None:
    if st == tt and sid == tid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Un nodo no puede enlazarse consigo mismo")
    for node_type, node_id in ((st, sid), (tt, tid)):
        if not db.get(_NODE_MODELS[node_type], node_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Nodo no encontrado ({node_type})")
    # Mismo par de nodos en cualquier sentido = enlace duplicado.
    query = db.query(MapLink).filter(
        ((MapLink.source_type == st) & (MapLink.source_id == sid)
         & (MapLink.target_type == tt) & (MapLink.target_id == tid))
        | ((MapLink.source_type == tt) & (MapLink.source_id == tid)
           & (MapLink.target_type == st) & (MapLink.target_id == sid))
    )
    if link_id is not None:
        query = query.filter(MapLink.id != link_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ya existe un enlace entre esos nodos")


@router.post("/links", response_model=LinkRead, status_code=status.HTTP_201_CREATED)
def create_link(payload: LinkCreate, db: DBSession, _: AdminOrTechnician) -> MapLink:
    _validate_endpoints(db, None, payload.source_type, payload.source_id, payload.target_type, payload.target_id)
    link = MapLink(**payload.model_dump())
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.put("/links/{link_id}", response_model=LinkRead)
def update_link(link_id: uuid.UUID, payload: LinkUpdate, db: DBSession, _: AdminOrTechnician) -> MapLink:
    link = db.get(MapLink, link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Enlace no encontrado")
    if (payload.source_type is None) != (payload.source_id is None) or (payload.target_type is None) != (payload.target_id is None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El tipo y el id del nodo van juntos")
    st = payload.source_type or link.source_type
    sid = payload.source_id or link.source_id
    tt = payload.target_type or link.target_type
    tid = payload.target_id or link.target_id
    _validate_endpoints(db, link.id, st, sid, tt, tid)
    link.source_type, link.source_id, link.target_type, link.target_id = st, sid, tt, tid
    if payload.kind is not None:
        link.kind = payload.kind
    db.commit()
    db.refresh(link)
    return link


@router.delete("/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_link(link_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> None:
    link = db.get(MapLink, link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Enlace no encontrado")
    db.delete(link)
    db.commit()
