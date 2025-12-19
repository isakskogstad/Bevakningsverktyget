"""
Bevakningsservice - Koordinerar bevakning av företag
"""

import json
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from pathlib import Path

from ..models.schemas import (
    BevakatForetag,
    Kungorelse,
    Haendelse,
    EventType,
    BevakningsStatus
)
# Använd Node.js-baserad scraper med puppeteer-extra stealth
from ..scrapers.poit_node_wrapper import POITNodeScraper, Kungorelse as NodeKungorelse, SearchResult

logger = logging.getLogger(__name__)


class BevakningService:
    """
    Huvudservice för företagsbevakning

    Ansvarar för:
    - Ladda och hantera lista över bevakade företag
    - Koordinera scraping från olika källor
    - Matcha kungörelser mot bevakade företag
    - Spara och hämta händelser
    """

    def __init__(
        self,
        foretags_lista_path: str,
        headless: bool = True,
        nopecha_path: Optional[str] = None
    ):
        self.foretags_lista_path = Path(foretags_lista_path)
        self.headless = headless
        self.nopecha_path = nopecha_path

        # Ladda företagslistan
        self.bevakade_foretag: Dict[str, BevakatForetag] = {}
        self._load_foretag()

        # Håll koll på senaste kontroll
        self.senaste_kontroll: Optional[datetime] = None
        self.upptackta_haendelser: List[Haendelse] = []

    def _load_foretag(self):
        """Laddar företagslistan från JSON-fil"""
        try:
            with open(self.foretags_lista_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            skipped = 0
            for item in data:
                # Hämta orgnr och ta bort bindestreck
                raw_orgnr = str(item.get('orgnr', ''))
                orgnr = raw_orgnr.replace('-', '').replace(' ', '')

                # Säkerställ 10 siffror
                if len(orgnr) < 10:
                    orgnr = orgnr.zfill(10)
                elif len(orgnr) > 10:
                    # Ogiltigt orgnr, hoppa över
                    skipped += 1
                    continue

                namn = item.get('company_name', '')

                if orgnr and namn and len(orgnr) == 10:
                    self.bevakade_foretag[orgnr] = BevakatForetag(
                        organisationsnummer=orgnr,
                        namn=namn,
                        aktiv_bevakning=True
                    )

            logger.info(f"Laddade {len(self.bevakade_foretag)} bevakade företag (hoppade över {skipped})")

        except Exception as e:
            logger.error(f"Kunde inte ladda företagslista: {e}")

    def get_bevakade_foretag(self) -> List[BevakatForetag]:
        """Returnerar alla bevakade företag"""
        return list(self.bevakade_foretag.values())

    def is_bevakat(self, orgnr: str) -> bool:
        """Kontrollerar om ett organisationsnummer är bevakat"""
        # Normalisera orgnr
        orgnr = orgnr.replace("-", "").zfill(10)
        return orgnr in self.bevakade_foretag

    def get_foretag(self, orgnr: str) -> Optional[BevakatForetag]:
        """Hämtar ett specifikt företag"""
        orgnr = orgnr.replace("-", "").zfill(10)
        return self.bevakade_foretag.get(orgnr)

    def _classify_event_type(self, kungorelse: NodeKungorelse) -> EventType:
        """Klassificerar en kungörelse till en händelsetyp"""
        text = f"{kungorelse.typ} {kungorelse.namn}".lower()

        if any(word in text for word in ['konkurs', 'konkursbeslut']):
            return EventType.KONKURS
        elif any(word in text for word in ['likvidation', 'likvidator']):
            return EventType.LIKVIDATION
        elif any(word in text for word in ['fusion', 'sammanslagning']):
            return EventType.FUSION
        elif any(word in text for word in ['styrelse', 'styrelseledamot', 'styrelsens']):
            return EventType.STYRELSE_ANDRING
        elif any(word in text for word in ['verkställande direktör', 'vd ']):
            return EventType.VD_BYTE
        elif any(word in text for word in ['bolagsordning']):
            return EventType.BOLAGSORDNING
        elif any(word in text for word in ['nyemission', 'aktiekapital']):
            return EventType.NYEMISSION
        elif any(word in text for word in ['okända borgenärer', 'kallelse på']):
            return EventType.OKAND_BORGENAR
        elif any(word in text for word in ['årsredovisning', 'årsbokslut']):
            return EventType.ARSREDOVISNING
        else:
            return EventType.ANNAN

    def kontrollera_poit(
        self,
        max_foretag: Optional[int] = None
    ) -> List[Haendelse]:
        """
        Kontrollerar POIT efter nya kungörelser för bevakade företag.
        Använder Node.js-baserad scraper med puppeteer-extra stealth.

        Args:
            max_foretag: Begränsa antal företag att söka (för testning)

        Returns:
            Lista med nya händelser
        """
        nya_haendelser = []

        logger.info(f"Kontrollerar POIT för {len(self.bevakade_foretag)} bevakade företag")

        try:
            scraper = POITNodeScraper(headless=self.headless)

            foretag_lista = list(self.bevakade_foretag.values())
            if max_foretag:
                foretag_lista = foretag_lista[:max_foretag]

            for foretag in foretag_lista:
                logger.info(f"Söker kungörelser för {foretag.namn} ({foretag.organisationsnummer})")

                result: SearchResult = scraper.search_by_orgnr(foretag.organisationsnummer)

                if not result.success:
                    logger.warning(f"Sökning misslyckades för {foretag.organisationsnummer}: {result.error}")
                    continue

                logger.info(f"Hittade {result.antal_traffar} kungörelser för {foretag.namn}")

                for k in result.kungorelser:
                    haendelse = Haendelse(
                        foretag_orgnr=foretag.organisationsnummer,
                        foretag_namn=foretag.namn,
                        haendelse_typ=self._classify_event_type(k),
                        rubrik=k.typ,
                        beskrivning=k.namn,
                        kalla="POIT",
                        kalla_url=k.url,
                        kalla_id=k.kungorelse_id,
                        upptackt_datum=datetime.now()
                    )

                    nya_haendelser.append(haendelse)
                    logger.info(f"Ny händelse: {k.typ} - {k.namn}")

        except Exception as e:
            logger.error(f"Fel vid POIT-kontroll: {e}")

        self.senaste_kontroll = datetime.now()
        self.upptackta_haendelser.extend(nya_haendelser)

        logger.info(f"Hittade {len(nya_haendelser)} nya händelser för bevakade företag")
        return nya_haendelser

    def get_status(self) -> BevakningsStatus:
        """Returnerar aktuell status för bevakningen"""
        return BevakningsStatus(
            antal_bevakade_foretag=len(self.bevakade_foretag),
            antal_kungorelser_idag=len([
                h for h in self.upptackta_haendelser
                if h.upptackt_datum.date() == datetime.now().date()
            ]),
            senaste_kontroll=self.senaste_kontroll,
            nasta_kontroll=self.senaste_kontroll + timedelta(hours=1) if self.senaste_kontroll else None,
            status="OK"
        )

    def get_haendelser(
        self,
        orgnr: Optional[str] = None,
        haendelse_typ: Optional[EventType] = None,
        from_date: Optional[datetime] = None
    ) -> List[Haendelse]:
        """Hämtar händelser med valfria filter"""
        results = self.upptackta_haendelser

        if orgnr:
            orgnr = orgnr.replace("-", "").zfill(10)
            results = [h for h in results if h.foretag_orgnr == orgnr]

        if haendelse_typ:
            results = [h for h in results if h.haendelse_typ == haendelse_typ]

        if from_date:
            results = [h for h in results if h.upptackt_datum >= from_date]

        return results
