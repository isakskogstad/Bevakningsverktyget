"""
API Routes för Bevakningsverktyget
"""

from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks

from ..models.schemas import (
    BevakatForetag,
    Haendelse,
    EventType,
    BevakningsStatus
)
from ..services.bevakning_service import BevakningService

router = APIRouter()

# Service-instans (sätts vid startup)
bevakning_service: Optional[BevakningService] = None


def get_service() -> BevakningService:
    """Hämtar service-instansen"""
    if bevakning_service is None:
        raise HTTPException(status_code=500, detail="Service inte initialiserad")
    return bevakning_service


# ============ Status endpoints ============

@router.get("/status", response_model=BevakningsStatus)
async def get_status():
    """Hämtar aktuell status för bevakningen"""
    service = get_service()
    return service.get_status()


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


# ============ Företag endpoints ============

@router.get("/foretag", response_model=List[BevakatForetag])
async def list_foretag(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0)
):
    """Listar alla bevakade företag"""
    service = get_service()
    foretag = service.get_bevakade_foretag()
    return foretag[offset:offset + limit]


@router.get("/foretag/{orgnr}", response_model=BevakatForetag)
async def get_foretag(orgnr: str):
    """Hämtar ett specifikt företag"""
    service = get_service()
    foretag = service.get_foretag(orgnr)
    if not foretag:
        raise HTTPException(status_code=404, detail=f"Företag {orgnr} inte bevakat")
    return foretag


@router.get("/foretag/{orgnr}/haendelser", response_model=List[Haendelse])
async def get_foretag_haendelser(orgnr: str):
    """Hämtar alla händelser för ett företag"""
    service = get_service()
    if not service.is_bevakat(orgnr):
        raise HTTPException(status_code=404, detail=f"Företag {orgnr} inte bevakat")
    return service.get_haendelser(orgnr=orgnr)


# ============ Händelser endpoints ============

@router.get("/haendelser", response_model=List[Haendelse])
async def list_haendelser(
    haendelse_typ: Optional[EventType] = None,
    from_date: Optional[datetime] = None,
    limit: int = Query(100, ge=1, le=1000)
):
    """Listar alla upptäckta händelser"""
    service = get_service()
    haendelser = service.get_haendelser(
        haendelse_typ=haendelse_typ,
        from_date=from_date
    )
    return haendelser[:limit]


@router.get("/haendelser/typer")
async def list_haendelse_typer():
    """Listar alla händelsetyper"""
    return [{"value": e.value, "name": e.name} for e in EventType]


# ============ Kontroll endpoints ============

@router.post("/kontrollera")
async def trigger_kontroll(
    background_tasks: BackgroundTasks,
    dagar_tillbaka: int = Query(1, ge=1, le=30)
):
    """
    Triggar en manuell kontroll av POIT

    Körs i bakgrunden och returnerar direkt.
    """
    service = get_service()

    def run_kontroll():
        try:
            service.kontrollera_poit(dagar_tillbaka=dagar_tillbaka)
        except Exception as e:
            print(f"Fel vid kontroll: {e}")

    background_tasks.add_task(run_kontroll)

    return {
        "message": "Kontroll startad i bakgrunden",
        "dagar_tillbaka": dagar_tillbaka,
        "timestamp": datetime.now().isoformat()
    }


@router.post("/kontrollera/sync", response_model=List[Haendelse])
async def trigger_kontroll_sync(
    dagar_tillbaka: int = Query(1, ge=1, le=7)
):
    """
    Triggar en synkron kontroll av POIT

    OBS: Kan ta lång tid (30-60 sekunder). Använd /kontrollera för asynkron.
    """
    service = get_service()
    haendelser = service.kontrollera_poit(dagar_tillbaka=dagar_tillbaka)
    return haendelser
