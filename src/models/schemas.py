"""
Pydantic-modeller för Bevakningsverktyget
"""

from datetime import datetime
from typing import Optional, List
from enum import Enum
from pydantic import BaseModel, Field


class EventType(str, Enum):
    """Typer av händelser att bevaka"""
    STYRELSE_ANDRING = "styrelse_andring"
    VD_BYTE = "vd_byte"
    KONKURS = "konkurs"
    LIKVIDATION = "likvidation"
    FUSION = "fusion"
    NYEMISSION = "nyemission"
    BOLAGSORDNING = "bolagsordning_andring"
    OKAND_BORGENAR = "kallelse_okand_borgenar"
    ARSREDOVISNING = "arsredovisning"
    ANNAN = "annan"


class KungorelseBase(BaseModel):
    """Bas-schema för kungörelse"""
    kungorelse_id: str = Field(..., description="Unikt ID från POIT")
    rubrik: str = Field(..., description="Kungörelsens rubrik")
    amnesomrade: str = Field(..., description="Ämnesområde")
    publiceringsdatum: str = Field(..., description="Publiceringsdatum (YYYY-MM-DD)")
    organisationsnummer: Optional[str] = Field(None, description="Organisationsnummer om kopplat till företag")
    foretag: Optional[str] = Field(None, description="Företagsnamn")
    innehall: Optional[str] = Field(None, description="Kungörelsens innehåll")
    url: Optional[str] = Field(None, description="URL till kungörelsen")


class KungorelseCreate(KungorelseBase):
    """Schema för att skapa ny kungörelse"""
    pass


class Kungorelse(KungorelseBase):
    """Schema för kungörelse från databas"""
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BevakatForetag(BaseModel):
    """Schema för bevakat företag"""
    id: Optional[int] = None
    organisationsnummer: str = Field(..., min_length=10, max_length=10, description="10-siffrigt orgnr")
    namn: str = Field(..., description="Företagsnamn")
    aktiv_bevakning: bool = Field(default=True, description="Om bevakning är aktiv")
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Haendelse(BaseModel):
    """Schema för upptäckt händelse"""
    id: Optional[int] = None
    foretag_orgnr: str = Field(..., description="Organisationsnummer")
    foretag_namn: str = Field(..., description="Företagsnamn")
    haendelse_typ: EventType = Field(..., description="Typ av händelse")
    rubrik: str = Field(..., description="Rubrik/sammanfattning")
    beskrivning: Optional[str] = Field(None, description="Detaljerad beskrivning")
    kalla: str = Field(..., description="Källa (t.ex. 'POIT')")
    kalla_url: Optional[str] = Field(None, description="URL till källan")
    kalla_id: Optional[str] = Field(None, description="ID hos källan")
    upptackt_datum: datetime = Field(default_factory=datetime.now)
    notifierad: bool = Field(default=False, description="Om notifiering skickats")

    class Config:
        from_attributes = True


class BevakningsStatus(BaseModel):
    """Status för bevakningssystemet"""
    antal_bevakade_foretag: int
    antal_kungorelser_idag: int
    senaste_kontroll: Optional[datetime]
    nasta_kontroll: Optional[datetime]
    status: str = "OK"


class SokResultat(BaseModel):
    """Resultat från sökning"""
    kungorelser: List[KungorelseBase]
    totalt_antal: int
    sida: int = 1
    per_sida: int = 50
