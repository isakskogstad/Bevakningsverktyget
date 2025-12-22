"""
Bevakningsverktyg - Huvudapplikation

Startar FastAPI-servern med schemalagd bevakning.
"""

import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .config import settings
from .api import routes
from .services.bevakning_service import BevakningService

# Konfigurera logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Scheduler för periodiska kontroller
scheduler = AsyncIOScheduler()


def scheduled_check():
    """Schemalagd POIT-kontroll"""
    logger.info("Kör schemalagd POIT-kontroll...")
    try:
        if routes.bevakning_service:
            haendelser = routes.bevakning_service.kontrollera_poit(dagar_tillbaka=1)
            logger.info(f"Schemalagd kontroll klar. Hittade {len(haendelser)} nya händelser.")
    except Exception as e:
        logger.error(f"Fel vid schemalagd kontroll: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup och shutdown events"""

    # === STARTUP ===
    logger.info(f"Startar {settings.app_name} v{settings.app_version}")

    # Hitta företagslistan
    base_path = Path(__file__).parent.parent
    companies_path = base_path / settings.companies_file

    if not companies_path.exists():
        logger.warning(f"Företagslista hittades inte: {companies_path}")
        # Försök med environment variabel om den finns
        if settings.companies_path_override:
            companies_path = Path(settings.companies_path_override)
            logger.info(f"Använder överskriven path från miljövariabel: {companies_path}")

    logger.info(f"Laddar företag från: {companies_path}")

    # Initiera bevakningstjänsten
    routes.bevakning_service = BevakningService(
        foretags_lista_path=str(companies_path),
        headless=settings.headless,
        nopecha_path=settings.nopecha_extension_path
    )

    logger.info(f"Bevakningsservice startad med {len(routes.bevakning_service.bevakade_foretag)} företag")

    # Starta scheduler
    scheduler.add_job(
        scheduled_check,
        'interval',
        minutes=settings.check_interval_minutes,
        id='poit_check'
    )
    scheduler.start()
    logger.info(f"Scheduler startad - kontrollerar var {settings.check_interval_minutes}:e minut")

    yield

    # === SHUTDOWN ===
    logger.info("Stänger ner...")
    scheduler.shutdown()


# Skapa FastAPI-app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="""
    Bevakningsverktyg för svenska företag.

    Övervakar Post- och Inrikes Tidningar (POIT) för händelser som:
    - Styrelseändringar
    - Konkurser och likvidationer
    - Fusioner
    - Bolagsordningsändringar

    Bevakar 1217 utvalda företag automatiskt.
    """,
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inkludera routes
app.include_router(routes.router, prefix="/api/v1", tags=["Bevakning"])


# Root endpoint
@app.get("/")
async def root():
    """Välkomstsida"""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "api": "/api/v1"
    }


@app.get("/health")
async def health():
    """Health check för deployment"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.debug
    )
