"""
Python wrapper för Node.js Protokoll-scraper
Hämtar bolagsstämmoprotokoll från Bolagsverket

SÄKERHETSFUNKTIONER:
- Daglig gräns på 100 SEK
- Loggning av alla köp
- Validering innan betalning
"""

import json
import logging
import subprocess
from pathlib import Path
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, asdict, field

logger = logging.getLogger(__name__)

# Sökväg till Node.js-scrapern
SCRAPER_PATH = Path(__file__).parent / "protokoll-scraper.js"


@dataclass
class CardDetails:
    """Kortuppgifter för betalning"""
    number: str  # 16 siffror
    exp_month: str  # 01-12
    exp_year: str  # YYYY
    cvv: str  # 3 siffror


@dataclass
class ProtokollStep:
    """Representerar ett steg i protokollhämtningen"""
    step: int
    status: str
    message: str


@dataclass
class ProtokollResult:
    """Resultat från protokollhämtning"""
    success: bool
    orgnr: str
    email: str
    steps: List[ProtokollStep]
    final_url: Optional[str] = None
    page_content: Optional[str] = None
    error: Optional[str] = None
    amount: Optional[float] = None
    ordernummer: Optional[str] = None
    payment_completed: bool = False
    payment_skipped: bool = False
    awaiting_payment: bool = False
    daily_total: Optional[float] = None
    daily_limit: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class ProtokollScraper:
    """
    Protokoll Scraper som använder Node.js puppeteer-extra med stealth plugin.
    Hämtar bolagsstämmoprotokoll från Bolagsverket.
    """

    def __init__(self, headless: bool = True, timeout: int = 120):
        self.headless = headless
        self.timeout = timeout

        if not SCRAPER_PATH.exists():
            raise FileNotFoundError(f"Node.js scraper hittades inte: {SCRAPER_PATH}")

    def fetch_protokoll(
        self,
        orgnr: str,
        email: str,
        card_details: Optional[CardDetails] = None,
        skip_payment: bool = False
    ) -> ProtokollResult:
        """
        Hämtar senaste bolagsstämmoprotokollet för ett organisationsnummer

        Args:
            orgnr: Organisationsnummer (10 siffror, med eller utan bindestreck)
            email: E-postadress för leverans av protokollet
            card_details: Kortuppgifter för automatisk betalning (valfritt)
            skip_payment: Hoppa över betalning, stoppa vid kassan

        Returns:
            ProtokollResult med steg och status
        """
        # Normalisera orgnr
        orgnr = orgnr.replace("-", "").replace(" ", "")

        args = ["node", str(SCRAPER_PATH), orgnr, email]
        if not self.headless:
            args.append("--visible")
        if skip_payment:
            args.append("--skip-payment")
        if card_details:
            args.append(f"--card-number={card_details.number}")
            args.append(f"--card-month={card_details.exp_month}")
            args.append(f"--card-year={card_details.exp_year}")
            args.append(f"--card-cvv={card_details.cvv}")

        logger.info(f"Hämtar protokoll för orgnr: {orgnr}, email: {email}")

        try:
            project_root = SCRAPER_PATH.parent.parent.parent
            logger.debug(f"Project root: {project_root}")
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

            if result.returncode != 0:
                logger.error(f"Node.js scraper fel: {result.stderr}")
                return ProtokollResult(
                    success=False,
                    orgnr=orgnr,
                    email=email,
                    steps=[],
                    error=result.stderr or "Unknown error"
                )

            # Parsa JSON-resultat
            data = json.loads(result.stdout)

            # Konvertera steg till dataklasser
            steps = [
                ProtokollStep(
                    step=s.get("step", 0),
                    status=s.get("status", "unknown"),
                    message=s.get("message", "")
                )
                for s in data.get("steps", [])
            ]

            return ProtokollResult(
                success=data.get("success", False),
                orgnr=orgnr,
                email=email,
                steps=steps,
                final_url=data.get("finalUrl"),
                page_content=data.get("pageContent"),
                error=data.get("error"),
                amount=data.get("amount"),
                ordernummer=data.get("ordernummer"),
                payment_completed=data.get("paymentCompleted", False),
                payment_skipped=data.get("paymentSkipped", False),
                awaiting_payment=data.get("awaitingPayment", False),
                daily_total=data.get("dailyTotal"),
                daily_limit=data.get("dailyLimit")
            )

        except subprocess.TimeoutExpired:
            logger.error(f"Timeout vid hämtning av protokoll för {orgnr}")
            return ProtokollResult(
                success=False,
                orgnr=orgnr,
                email=email,
                steps=[],
                error="Timeout"
            )
        except json.JSONDecodeError as e:
            logger.error(f"Kunde inte parsa JSON: {e}")
            return ProtokollResult(
                success=False,
                orgnr=orgnr,
                email=email,
                steps=[],
                error=f"JSON parse error: {e}"
            )
        except Exception as e:
            logger.error(f"Oväntat fel: {e}")
            return ProtokollResult(
                success=False,
                orgnr=orgnr,
                email=email,
                steps=[],
                error=str(e)
            )


# Test
if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)

    print("=" * 60)
    print("Protokoll Scraper - Test")
    print("=" * 60)

    scraper = ProtokollScraper(headless=False)

    # Testa hämtning - använd egen e-post
    test_email = os.environ.get('TEST_EMAIL', 'din@epost.se')
    result = scraper.fetch_protokoll("5593220048", test_email)

    print(f"\nResultat för {result.orgnr}:")
    print(f"  Success: {result.success}")
    print(f"  Email: {result.email}")
    print(f"  Final URL: {result.final_url}")

    if result.error:
        print(f"  Error: {result.error}")

    print("\n  Steg:")
    for s in result.steps:
        print(f"    {s.step}. [{s.status}] {s.message}")

    print("\n" + "=" * 60)
