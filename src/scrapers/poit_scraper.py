"""
POIT Scraper - Hämtar kungörelser från Post- och Inrikes Tidningar
Använder undetected-chromedriver för att kringgå bot-detection
"""

import os
import time
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

logger = logging.getLogger(__name__)


@dataclass
class Kungorelse:
    """Representerar en kungörelse från POIT"""
    kungorelse_id: str
    rubrik: str
    amnesomrade: str
    publiceringsdatum: str
    organisationsnummer: Optional[str] = None
    foretag: Optional[str] = None
    innehall: Optional[str] = None
    url: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class POITScraper:
    """
    Scraper för Post- och Inrikes Tidningar (POIT)

    Ämnesområden som är relevanta för företagsbevakning:
    - Aktiebolag (nybildning, ändring, likvidation)
    - Konkurser och företagsrekonstruktion
    - Fusion och delning
    - Kallelse på okända borgenärer
    """

    BASE_URL = "https://poit.bolagsverket.se/poit-app"
    SEARCH_URL = f"{BASE_URL}/sok"

    # Relevanta ämnesområden för företagsbevakning
    RELEVANTA_AMNESOMRADEN = [
        "Aktiebolag",
        "Konkurs",
        "Företagsrekonstruktion",
        "Fusion",
        "Delning av aktiebolag",
        "Likvidation",
        "Kallelse på okända borgenärer",
        "Ändring av bolagsordning",
    ]

    def __init__(
        self,
        headless: bool = True,
        nopecha_extension_path: Optional[str] = None,
        chrome_path: Optional[str] = None,
        timeout: int = 30
    ):
        self.headless = headless
        self.nopecha_extension_path = nopecha_extension_path
        self.chrome_path = chrome_path
        self.timeout = timeout
        self.driver: Optional[uc.Chrome] = None

    def _create_driver(self) -> uc.Chrome:
        """Skapar en undetected Chrome-instans"""
        options = uc.ChromeOptions()

        if self.headless:
            options.add_argument('--headless=new')

        # Standard options för stabilitet
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-gpu')
        options.add_argument('--window-size=1920,1080')
        options.add_argument('--lang=sv-SE')

        # Lägg till NopeCHA extension om tillgänglig
        if self.nopecha_extension_path and os.path.exists(self.nopecha_extension_path):
            options.add_extension(self.nopecha_extension_path)
            logger.info(f"Laddar NopeCHA extension från: {self.nopecha_extension_path}")

        driver_kwargs = {
            'options': options,
            'use_subprocess': True,
        }

        if self.chrome_path:
            driver_kwargs['browser_executable_path'] = self.chrome_path

        return uc.Chrome(**driver_kwargs)

    def start(self):
        """Startar browser-sessionen"""
        if self.driver is None:
            logger.info("Startar undetected Chrome...")
            self.driver = self._create_driver()
            logger.info("Chrome startad")

    def stop(self):
        """Stänger browser-sessionen"""
        if self.driver:
            logger.info("Stänger Chrome...")
            self.driver.quit()
            self.driver = None

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop()

    def _accept_cookies(self, max_wait: int = 15):
        """
        Accepterar cookie-dialogen om den visas.
        Väntar flexibelt upp till max_wait sekunder på att dialogen dyker upp.
        """
        wait = WebDriverWait(self.driver, max_wait)

        # Cookie-knapp selectors att försöka
        cookie_selectors = [
            "//button[contains(text(), 'OK, fortsätt')]",
            "//button[contains(text(), 'OK')]",
            "//button[contains(text(), 'Acceptera')]",
            "//button[contains(text(), 'Godkänn')]",
        ]

        # Vänta och leta efter cookie-knappen i upp till max_wait sekunder
        for attempt in range(max_wait):
            for selector in cookie_selectors:
                try:
                    cookie_btn = self.driver.find_element(By.XPATH, selector)
                    if cookie_btn.is_displayed():
                        # Använd JavaScript-klick för att undvika intercept-problem
                        self.driver.execute_script("arguments[0].click();", cookie_btn)
                        logger.info("Accepterade cookies")
                        time.sleep(1)
                        return True
                except NoSuchElementException:
                    continue

            # Vänta 1 sekund innan nästa försök
            time.sleep(1)

            # Kolla om vi redan är förbi cookie-dialogen
            try:
                page_text = self.driver.find_element(By.TAG_NAME, "body").text
                if "OK, fortsätt" not in page_text and "Vi använder cookies" not in page_text:
                    logger.debug("Cookie-dialog finns inte längre")
                    return True
            except:
                pass

        logger.debug(f"Ingen cookie-dialog hittades efter {max_wait} sekunder")
        return False

    def _wait_for_page_load(self, max_wait: int = 30):
        """Väntar på att sidan laddas och eventuell CAPTCHA löses"""
        wait = WebDriverWait(self.driver, max_wait)

        # Acceptera cookies först
        time.sleep(2)
        self._accept_cookies()

        # Vänta på att CAPTCHA försvinner (om den finns)
        captcha_selectors = [
            "//div[contains(@class, 'captcha')]",
            "//iframe[contains(@src, 'captcha')]",
            "//*[contains(text(), 'robot')]",
            "//*[contains(text(), 'What code is in the image')]",
        ]

        # Ge NopeCHA tid att lösa CAPTCHA
        time.sleep(2)

        # Kolla om vi fortfarande är på CAPTCHA-sidan
        for _ in range(max_wait // 3):
            page_text = self.driver.find_element(By.TAG_NAME, "body").text.lower()
            if "captcha" not in page_text and "robot" not in page_text:
                logger.info("Ingen CAPTCHA detekterad eller redan löst")
                return True
            logger.info("Väntar på CAPTCHA-lösning...")
            time.sleep(3)

        logger.warning("Timeout vid väntan på CAPTCHA")
        return False

    def search_by_orgnr(self, orgnr: str) -> List[Kungorelse]:
        """
        Söker kungörelser för ett specifikt organisationsnummer

        Args:
            orgnr: Organisationsnummer (10 siffror)

        Returns:
            Lista med kungörelser
        """
        self.start()
        results = []

        try:
            logger.info(f"Söker kungörelser för orgnr: {orgnr}")
            self.driver.get(self.SEARCH_URL)

            if not self._wait_for_page_load():
                logger.error("Kunde inte ladda söksidan")
                return results

            # Vänta på sökformuläret
            wait = WebDriverWait(self.driver, self.timeout)

            # Försök hitta och fylla i organisationsnummer
            try:
                # POIT har olika fältnamn beroende på söktyp
                orgnr_field = wait.until(
                    EC.presence_of_element_located((By.CSS_SELECTOR,
                        "input[name*='orgnr'], input[name*='organisationsnummer'], input[id*='orgnr']"))
                )
                orgnr_field.clear()
                orgnr_field.send_keys(orgnr)

                # Klicka på sök
                search_btn = self.driver.find_element(By.CSS_SELECTOR,
                    "button[type='submit'], input[type='submit'], button:contains('Sök')")
                search_btn.click()

                # Vänta på resultat
                time.sleep(2)

                # Parsa resultat
                results = self._parse_search_results()

            except TimeoutException:
                logger.warning(f"Kunde inte hitta sökfält för orgnr: {orgnr}")
            except NoSuchElementException as e:
                logger.warning(f"Element saknas: {e}")

        except Exception as e:
            logger.error(f"Fel vid sökning: {e}")

        return results

    def search_by_date_range(
        self,
        from_date: datetime,
        to_date: datetime,
        amnesomrade: Optional[str] = None
    ) -> List[Kungorelse]:
        """
        Söker kungörelser inom ett datumintervall

        Args:
            from_date: Startdatum
            to_date: Slutdatum
            amnesomrade: Filtrera på ämnesområde (optional)

        Returns:
            Lista med kungörelser
        """
        self.start()
        results = []

        try:
            logger.info(f"Söker kungörelser {from_date.date()} - {to_date.date()}")
            self.driver.get(self.SEARCH_URL)

            if not self._wait_for_page_load():
                logger.error("Kunde inte ladda söksidan")
                return results

            wait = WebDriverWait(self.driver, self.timeout)

            # Försök fylla i datumfält
            try:
                # Formatera datum för POIT (YYYY-MM-DD)
                from_str = from_date.strftime("%Y-%m-%d")
                to_str = to_date.strftime("%Y-%m-%d")

                # Hitta datumfält
                from_field = wait.until(
                    EC.presence_of_element_located((By.CSS_SELECTOR,
                        "input[name*='from'], input[name*='datum_fran'], input[id*='fromDate']"))
                )
                from_field.clear()
                from_field.send_keys(from_str)

                to_field = self.driver.find_element(By.CSS_SELECTOR,
                    "input[name*='to'], input[name*='datum_till'], input[id*='toDate']")
                to_field.clear()
                to_field.send_keys(to_str)

                # Välj ämnesområde om angivet
                if amnesomrade:
                    try:
                        select_elem = self.driver.find_element(By.CSS_SELECTOR,
                            "select[name*='amne'], select[id*='amnesomrade']")
                        select = Select(select_elem)
                        select.select_by_visible_text(amnesomrade)
                    except NoSuchElementException:
                        logger.warning(f"Kunde inte välja ämnesområde: {amnesomrade}")

                # Sök
                search_btn = self.driver.find_element(By.CSS_SELECTOR,
                    "button[type='submit'], input[type='submit']")
                search_btn.click()

                time.sleep(2)
                results = self._parse_search_results()

            except TimeoutException:
                logger.warning("Kunde inte hitta datumfält")
            except NoSuchElementException as e:
                logger.warning(f"Element saknas: {e}")

        except Exception as e:
            logger.error(f"Fel vid datumsökning: {e}")

        return results

    def _parse_search_results(self) -> List[Kungorelse]:
        """Parsar sökresultat från POIT"""
        results = []

        try:
            # Vänta på resultatlista
            wait = WebDriverWait(self.driver, 10)

            # POIT visar resultat i en tabell eller lista
            # Försök hitta resultatrader
            result_rows = self.driver.find_elements(By.CSS_SELECTOR,
                "table.results tr, .result-item, .kungorelse-item, ul.results li")

            for row in result_rows:
                try:
                    kungorelse = self._parse_result_row(row)
                    if kungorelse:
                        results.append(kungorelse)
                except Exception as e:
                    logger.debug(f"Kunde inte parsa rad: {e}")

            logger.info(f"Hittade {len(results)} kungörelser")

        except TimeoutException:
            logger.info("Inga resultat hittades")
        except Exception as e:
            logger.error(f"Fel vid parsing av resultat: {e}")

        return results

    def _parse_result_row(self, row) -> Optional[Kungorelse]:
        """Parsar en enskild resultatrad"""
        try:
            # Försök extrahera data från raden
            # OBS: Exakta selektorer behöver anpassas efter POIT:s faktiska HTML

            text = row.text.strip()
            if not text:
                return None

            # Försök hitta länk till kungörelsen
            link = None
            try:
                link_elem = row.find_element(By.TAG_NAME, "a")
                link = link_elem.get_attribute("href")
            except NoSuchElementException:
                pass

            # Extrahera kungörelse-ID från länk eller text
            kungorelse_id = ""
            if link and "kungorelse" in link.lower():
                # Extrahera ID från URL
                parts = link.split("/")
                kungorelse_id = parts[-1] if parts else ""

            # Skapa kungörelse-objekt
            return Kungorelse(
                kungorelse_id=kungorelse_id or f"temp_{hash(text)}",
                rubrik=text[:200],  # Första 200 tecken som rubrik
                amnesomrade="Okänt",
                publiceringsdatum=datetime.now().strftime("%Y-%m-%d"),
                url=link
            )

        except Exception as e:
            logger.debug(f"Fel vid parsing av rad: {e}")
            return None

    def get_kungorelse_details(self, kungorelse_url: str) -> Optional[Dict[str, Any]]:
        """Hämtar detaljerad information om en kungörelse"""
        self.start()

        try:
            self.driver.get(kungorelse_url)

            if not self._wait_for_page_load():
                return None

            # Extrahera all text från sidan
            content = self.driver.find_element(By.TAG_NAME, "body").text

            # Försök extrahera strukturerad data
            details = {
                "url": kungorelse_url,
                "content": content,
                "fetched_at": datetime.now().isoformat()
            }

            # Sök efter organisationsnummer i texten
            import re
            orgnr_match = re.search(r'\b(\d{6}-?\d{4})\b', content)
            if orgnr_match:
                details["organisationsnummer"] = orgnr_match.group(1).replace("-", "")

            return details

        except Exception as e:
            logger.error(f"Fel vid hämtning av detaljer: {e}")
            return None


# Enkel test
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    with POITScraper(headless=False) as scraper:
        # Testa sökning
        from_date = datetime.now() - timedelta(days=7)
        to_date = datetime.now()

        results = scraper.search_by_date_range(from_date, to_date)

        for r in results[:5]:
            print(f"- {r.rubrik[:50]}...")
