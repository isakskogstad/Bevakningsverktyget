"""
Python wrapper för Node.js POIT-scraper
Använder puppeteer-extra med stealth plugin för att undvika bot-detection
"""

import json
import logging
import subprocess
from pathlib import Path
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

# Sökväg till Node.js-scrapern
SCRAPER_PATH = Path(__file__).parent / "poit-scraper.js"


@dataclass
class Kungorelse:
    """Representerar en kungörelse från POIT"""
    kungorelse_id: str
    uppgiftslamnare: str
    typ: str
    namn: str
    publicerad: str
    url: Optional[str] = None
    organisationsnummer: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SearchResult:
    """Resultat från en POIT-sökning"""
    success: bool
    orgnr: str
    antal_traffar: int
    kungorelser: List[Kungorelse]
    error: Optional[str] = None


class POITNodeScraper:
    """
    POIT Scraper som använder Node.js puppeteer-extra med stealth plugin.
    Mycket bättre på att undvika bot-detection än Python-alternativen.
    """

    def __init__(self, headless: bool = True, timeout: int = 60):
        self.headless = headless
        self.timeout = timeout

        if not SCRAPER_PATH.exists():
            raise FileNotFoundError(f"Node.js scraper hittades inte: {SCRAPER_PATH}")

    def search_by_orgnr(self, orgnr: str) -> SearchResult:
        """
        Söker kungörelser för ett organisationsnummer

        Args:
            orgnr: Organisationsnummer (10 siffror, med eller utan bindestreck)

        Returns:
            SearchResult med kungörelser
        """
        # Normalisera orgnr
        orgnr = orgnr.replace("-", "").replace(" ", "")

        args = ["node", str(SCRAPER_PATH), orgnr]
        if not self.headless:
            args.append("--visible")

        logger.info(f"Söker kungörelser för orgnr: {orgnr}")

        try:
            # Kör från scrapers-mappen där node_modules finns i projektroten
            project_root = SCRAPER_PATH.parent.parent.parent
            logger.debug(f"Project root: {project_root}")
            logger.debug(f"Scraper path: {SCRAPER_PATH}")
            logger.debug(f"Args: {args}")

            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                cwd=str(project_root)
            )

            logger.debug(f"Return code: {result.returncode}")
            logger.debug(f"Stdout length: {len(result.stdout) if result.stdout else 0}")
            logger.debug(f"Stderr: {result.stderr[:200] if result.stderr else '(empty)'}")

            if result.returncode != 0:
                logger.error(f"Node.js scraper fel: {result.stderr}")
                return SearchResult(
                    success=False,
                    orgnr=orgnr,
                    antal_traffar=0,
                    kungorelser=[],
                    error=result.stderr or "Unknown error"
                )

            # Parsa JSON-resultat
            data = json.loads(result.stdout)

            # Konvertera till dataklasser
            kungorelser = [
                Kungorelse(
                    kungorelse_id=k.get("kungorelse_id", ""),
                    uppgiftslamnare=k.get("uppgiftslamnare", ""),
                    typ=k.get("typ", ""),
                    namn=k.get("namn", ""),
                    publicerad=k.get("publicerad", ""),
                    url=k.get("url"),
                    organisationsnummer=orgnr
                )
                for k in data.get("kungorelser", [])
            ]

            return SearchResult(
                success=data.get("success", False),
                orgnr=orgnr,
                antal_traffar=data.get("antal_traffar", 0),
                kungorelser=kungorelser,
                error=data.get("error")
            )

        except subprocess.TimeoutExpired:
            logger.error(f"Timeout vid sökning efter {orgnr}")
            return SearchResult(
                success=False,
                orgnr=orgnr,
                antal_traffar=0,
                kungorelser=[],
                error="Timeout"
            )
        except json.JSONDecodeError as e:
            logger.error(f"Kunde inte parsa JSON: {e}")
            return SearchResult(
                success=False,
                orgnr=orgnr,
                antal_traffar=0,
                kungorelser=[],
                error=f"JSON parse error: {e}"
            )
        except Exception as e:
            logger.error(f"Oväntat fel: {e}")
            return SearchResult(
                success=False,
                orgnr=orgnr,
                antal_traffar=0,
                kungorelser=[],
                error=str(e)
            )

    def search_multiple(self, orgnr_list: List[str]) -> List[SearchResult]:
        """
        Söker kungörelser för flera organisationsnummer

        Args:
            orgnr_list: Lista med organisationsnummer

        Returns:
            Lista med SearchResult
        """
        results = []
        for orgnr in orgnr_list:
            result = self.search_by_orgnr(orgnr)
            results.append(result)
        return results


# Test
if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)

    print("=" * 60)
    print("POIT Node.js Scraper - Test")
    print("=" * 60)

    scraper = POITNodeScraper(headless=True)

    # Testa sökning
    result = scraper.search_by_orgnr("5593220048")

    print(f"\nResultat för {result.orgnr}:")
    print(f"  Success: {result.success}")
    print(f"  Antal träffar: {result.antal_traffar}")

    if result.error:
        print(f"  Error: {result.error}")

    for k in result.kungorelser:
        print(f"\n  Kungörelse: {k.kungorelse_id}")
        print(f"    Typ: {k.typ}")
        print(f"    Namn: {k.namn}")
        print(f"    Publicerad: {k.publicerad}")
        print(f"    URL: {k.url}")

    print("\n" + "=" * 60)
