#!/usr/bin/env python3
"""
Ratsit Income Scraper med DrissionPage
Passerar Cloudflare automatiskt och hämtar inkomstdata

Användning:
  # Logga in automatiskt (med email engångskod)
  python3 ratsit-drissionpage.py --action full-login

  # Sök person
  python3 ratsit-drissionpage.py --action search --query "Jan Andersson Stockholm"

  # Hämta köphistorik (PDF-länkar)
  python3 ratsit-drissionpage.py --action history

  # Köp lönekoll för person (VARNING: kostar!)
  python3 ratsit-drissionpage.py --action buy --person-url "https://www.ratsit.se/19370108-..."

  # Testa Cloudflare bypass
  python3 ratsit-drissionpage.py --action test

Output: JSON till stdout
"""

import argparse
import json
import sys
import time
import os
import re
import requests
from datetime import datetime

# Konfiguration
RATSIT_BASE_URL = "https://www.ratsit.se"
RATSIT_LOGIN_URL = f"{RATSIT_BASE_URL}/loggain"
SCREENSHOT_DIR = "/Users/isak/Desktop/CLAUDE_CODE /Bevakningsverktyget/data/screenshots"
COOKIE_FILE = "/Users/isak/Desktop/CLAUDE_CODE /Bevakningsverktyget/data/ratsit-cookies.json"

# Resend konfiguration
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', 're_4dQhBror_5pNbW2oVUZvK4Y55FJ4GbuG4')
RESEND_BASE_URL = "https://api.resend.com"
AUTOMATION_EMAIL = os.environ.get('AUTOMATION_EMAIL', 'bevakning@graneidela.resend.app')

# =============================================================================
# RESEND EMAIL FUNKTIONER
# =============================================================================
def resend_list_received_emails(limit=20):
    """Hämta lista över MOTTAGNA e-postmeddelanden från Resend (inbound)"""
    headers = {"Authorization": f"Bearer {RESEND_API_KEY}"}
    # VIKTIGT: Använd /emails/receiving för inkommande emails!
    resp = requests.get(f"{RESEND_BASE_URL}/emails/receiving", headers=headers, params={"limit": limit})
    if resp.status_code != 200:
        print(f"[Resend] API error: {resp.status_code} - {resp.text}", file=sys.stderr)
        return []
    data = resp.json()
    return data.get("data", [])

def resend_get_email(email_id):
    """Hämta specifikt e-postmeddelande"""
    headers = {"Authorization": f"Bearer {RESEND_API_KEY}"}
    resp = requests.get(f"{RESEND_BASE_URL}/emails/{email_id}", headers=headers)
    if resp.status_code != 200:
        return None
    return resp.json()

def extract_verification_code(content):
    """Extrahera verifieringskod från e-postinnehåll"""
    if not content:
        return None

    # Ta bort HTML-taggar
    text = re.sub(r'<[^>]*>', ' ', content)
    text = re.sub(r'\s+', ' ', text)

    # Patterns för verifieringskoder
    patterns = [
        r'(?:kod|code|verifiering)[:\s]+(\d{4,8})',
        r'\b(\d{3}\s?\d{3})\b',
        r'\b(\d{6})\b',
        r'(?:inloggning|logga in)[^0-9]*(\d{4,8})',
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).replace(' ', '')

    return None

def poll_for_ratsit_code(after_timestamp, timeout_sec=90, poll_interval=10):
    """
    Polla efter Ratsit-inloggningskod i e-post.
    Enkel approach: kolla efter NYA emails från Ratsit sedan start.
    """
    start = time.time()

    # Hämta initial email-lista för att veta vad som är "gammalt"
    initial_emails = resend_list_received_emails(10)
    initial_ids = {e.get("id") for e in initial_emails}
    print(f"[Resend] Startar polling. {len(initial_ids)} emails finns redan.", file=sys.stderr)

    while time.time() - start < timeout_sec:
        time.sleep(poll_interval)
        elapsed = int(time.time() - start)

        try:
            emails = resend_list_received_emails(10)

            # Kolla efter NYA emails (som inte fanns i initial_ids)
            for email in emails:
                email_id = email.get("id")
                if email_id in initial_ids:
                    continue  # Gammalt email, skippa

                # Nytt email! Kolla om det är från Ratsit
                from_addr = email.get("from", "").lower()
                subject = email.get("subject", "")

                print(f"[Resend] 📧 Nytt email: {from_addr} - {subject}", file=sys.stderr)

                if "ratsit" in from_addr:
                    # Ratsit skickar koden i ämnesraden: "Din inloggningskod är 123456."
                    code_match = re.search(r'(\d{6})', subject)
                    if code_match:
                        code = code_match.group(1)
                        print(f"[Resend] ✅ Kod hittad: {code}", file=sys.stderr)
                        return code

                # Lägg till i initial_ids så vi inte kollar samma igen
                initial_ids.add(email_id)

            print(f"[Resend] Väntar på kod... ({elapsed}s)", file=sys.stderr)

        except Exception as e:
            print(f"[Resend] Poll error: {e}", file=sys.stderr)

    print(f"[Resend] ❌ Timeout efter {timeout_sec}s", file=sys.stderr)
    return None


class RatsitScraper:
    def __init__(self, headless=False, debug=False):
        self.headless = headless
        self.debug = debug
        self.page = None

    def log(self, msg):
        """Logga meddelande till stderr (så stdout förblir ren JSON)"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[RatsitPy] {timestamp} {msg}", file=sys.stderr)

    def init_browser(self):
        """Initiera DrissionPage browser"""
        from DrissionPage import ChromiumPage, ChromiumOptions

        self.log("Startar browser...")

        options = ChromiumOptions()
        options.set_argument('--no-sandbox')
        options.set_argument('--disable-dev-shm-usage')
        options.set_argument('--disable-blink-features=AutomationControlled')
        options.set_argument('--lang=sv-SE')
        options.set_argument('--window-size=1920,1080')

        # Headless eller inte
        options.headless(self.headless)

        self.page = ChromiumPage(options)
        self.log("Browser startad!")

    def save_screenshot(self, name):
        """Spara screenshot"""
        if not self.page:
            return
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = f"{SCREENSHOT_DIR}/ratsit-py-{name}-{timestamp}.png"
        try:
            self.page.get_screenshot(path)
            self.log(f"Screenshot: {path}")
        except Exception as e:
            self.log(f"Screenshot error: {e}")

    def wait_for_cloudflare(self, max_wait=60):
        """Vänta tills Cloudflare-skyddet passeras"""
        self.log("Kollar Cloudflare...")
        start = time.time()

        while time.time() - start < max_wait:
            try:
                html = self.page.html or ""
                title = self.page.title or ""

                # Cloudflare aktiv?
                cloudflare_indicators = [
                    'Bekräfta att du är en människa',
                    'Verifierar',
                    'Just a moment',
                    'challenges.cloudflare.com'
                ]
                if any(x in html for x in cloudflare_indicators):
                    elapsed = int(time.time() - start)
                    self.log(f"Cloudflare aktiv, väntar... ({elapsed}s)")
                    time.sleep(3)
                    continue

                # Kolla om vi är förbi Cloudflare - olika sidtyper
                success_indicators = [
                    # Inloggningssidan
                    'Logga in' in html and 'E-post' in html,
                    'BankID' in html,
                    'engångskod' in html,
                    # Personprofil
                    'Kolla lön' in title,
                    'Ratsit' in title and len(html) > 5000,
                    # Söksidan
                    'Se lön direkt' in html,
                    # Lönesidan
                    'lonekollen' in html.lower(),
                    # Allmänt - sidan har laddat riktigt innehåll
                    'ratsit' in html.lower() and len(html) > 10000,
                ]

                if any(success_indicators):
                    self.log("✅ Cloudflare passerad!")
                    return True

                # Vänta lite och försök igen
                time.sleep(1)

            except Exception as e:
                self.log(f"Cloudflare check error: {e}")
                time.sleep(2)

        self.log("❌ Cloudflare timeout!")
        return False

    def dismiss_cookie_dialog(self):
        """Stäng cookie-dialogen om den visas"""
        try:
            # Leta efter "Endast nödvändiga cookies" knappen
            cookie_btn = self.page.ele('xpath://button[contains(text(),"Endast nödvändiga")]', timeout=3)
            if cookie_btn:
                self.log("Stänger cookie-dialog...")
                cookie_btn.click()
                time.sleep(1)
                return True
        except:
            pass

        try:
            # Alternativ: "Tillåt alla cookies"
            allow_btn = self.page.ele('xpath://button[contains(text(),"Tillåt alla")]', timeout=1)
            if allow_btn:
                allow_btn.click()
                time.sleep(1)
                return True
        except:
            pass

        return False

    def login_with_email_code(self, email):
        """
        Logga in med engångskod via email.
        Returnerar status och eventuellt vilken kod som behövs hämtas.
        """
        self.log(f"Påbörjar inloggning med email: {email}")

        # Navigera till inloggningssidan
        self.page.get(RATSIT_LOGIN_URL)

        if not self.wait_for_cloudflare():
            return {"success": False, "error": "Cloudflare timeout"}

        self.dismiss_cookie_dialog()
        self.save_screenshot("login-page-1")

        # Först: Expandera "Skicka en inloggningskod" sektionen om den finns
        try:
            expand_section = self.page.ele('xpath://*[contains(text(),"Skicka en inloggningskod")]', timeout=3)
            if expand_section:
                self.log("Expanderar 'Skicka en inloggningskod' sektion...")
                expand_section.click()
                time.sleep(1)
                self.save_screenshot("login-page-expanded")
        except Exception as e:
            self.log(f"Expand section note: {e}")

        # Hitta email-fältet (kan ha placeholder "E-postadress")
        try:
            # Försök olika selektorer
            email_selectors = [
                'xpath://input[@placeholder="E-postadress"]',
                'xpath://input[contains(@placeholder,"E-post")]',
                'xpath://input[contains(@placeholder,"postadress")]',
                'xpath://input[@type="email"]',
                'xpath://input[@name="email"]',
                'xpath://input[contains(@id,"email")]',
            ]

            email_input = None
            for selector in email_selectors:
                try:
                    email_input = self.page.ele(selector, timeout=1)
                    if email_input:
                        self.log(f"Hittade email-fält med: {selector}")
                        break
                except:
                    pass

            if email_input:
                self.log(f"Fyller i email: {email}")
                email_input.clear()
                email_input.input(email)
                time.sleep(0.5)
                self.save_screenshot("email-filled")
            else:
                self.log("Kunde inte hitta email-fältet")
                self.save_screenshot("no-email-field")
                return {"success": False, "error": "Email field not found"}

        except Exception as e:
            self.log(f"Email input error: {e}")
            return {"success": False, "error": str(e)}

        # Klicka på "Skicka inloggningskod" knappen
        try:
            # Försök olika selektorer för knappen
            btn_selectors = [
                'xpath://button[contains(text(),"Skicka inloggningskod")]',
                'xpath://button[text()="Skicka inloggningskod"]',
                'xpath://*[contains(text(),"Skicka inloggningskod") and (self::button or self::a)]',
                'xpath://button[contains(@class,"btn") and contains(text(),"Skicka")]',
                'xpath://input[@type="submit"]',
                'xpath://button[@type="submit"]',
            ]

            send_btn = None
            for selector in btn_selectors:
                try:
                    send_btn = self.page.ele(selector, timeout=1)
                    if send_btn:
                        self.log(f"Hittade knapp med: {selector}")
                        break
                except:
                    pass

            if send_btn:
                self.log("Klickar på 'Skicka inloggningskod'...")
                send_btn.click()
                time.sleep(3)
                self.save_screenshot("code-sent")
            else:
                # Fallback: klicka via JavaScript
                self.log("Försöker hitta knapp via JavaScript...")
                try:
                    result = self.page.run_js('''
                        const btns = document.querySelectorAll('button');
                        for (let btn of btns) {
                            if (btn.textContent.includes('Skicka inloggningskod')) {
                                btn.click();
                                return 'clicked';
                            }
                        }
                        return 'not found';
                    ''')
                    if result == 'clicked':
                        self.log("Klickade via JavaScript")
                        time.sleep(3)
                        self.save_screenshot("code-sent-js")
                    else:
                        self.log("Kunde inte hitta skicka-knappen")
                        return {"success": False, "error": "Submit button not found"}
                except Exception as js_err:
                    self.log(f"JavaScript click error: {js_err}")
                    return {"success": False, "error": "Submit button not found"}

        except Exception as e:
            self.log(f"Submit error: {e}")
            return {"success": False, "error": str(e)}

        # Kolla om kod-fältet visas
        try:
            code_selectors = [
                'xpath://input[contains(@placeholder,"inloggningskod")]',
                'xpath://input[contains(@placeholder,"kod")]',
                'xpath://input[contains(@name,"code")]',
            ]
            code_input = None
            for sel in code_selectors:
                try:
                    code_input = self.page.ele(sel, timeout=2)
                    if code_input:
                        break
                except:
                    pass

            if code_input:
                self.log("✅ Kodfält visas - väntar på kod från email")
                return {
                    "success": True,
                    "status": "awaiting_code",
                    "message": "Engångskod skickad till email. Hämta koden och anropa med --code"
                }
        except:
            pass

        return {"success": False, "error": "Could not verify code field appeared"}

    def full_login(self, email=None):
        """
        Komplett inloggningsflöde:
        1. Navigera till inloggningssidan
        2. Begär engångskod
        3. Polla Resend efter koden
        4. Fyll i koden och slutför inloggningen

        Returnerar status och eventuell session-info
        """
        if not email:
            email = AUTOMATION_EMAIL

        self.log(f"🚀 Startar komplett inloggning med: {email}")

        # Steg 1: Navigera och begär kod
        code_request_time = time.time()

        self.page.get(RATSIT_LOGIN_URL)
        if not self.wait_for_cloudflare():
            return {"success": False, "error": "Cloudflare timeout"}

        self.dismiss_cookie_dialog()

        # Expandera kod-sektionen
        try:
            expand_section = self.page.ele('xpath://*[contains(text(),"Skicka en inloggningskod")]', timeout=3)
            if expand_section:
                self.log("Expanderar kod-sektion...")
                expand_section.click()
                time.sleep(1)
        except:
            pass

        # Fyll i email
        email_input = None
        for sel in ['xpath://input[@placeholder="E-postadress"]', 'xpath://input[@type="email"]']:
            try:
                email_input = self.page.ele(sel, timeout=2)
                if email_input:
                    break
            except:
                pass

        if not email_input:
            return {"success": False, "error": "Email field not found"}

        self.log(f"Fyller i email: {email}")
        email_input.clear()
        email_input.input(email)
        time.sleep(0.5)

        # Klicka på skicka-knappen
        self.log("Klickar 'Skicka inloggningskod'...")
        try:
            self.page.run_js('''
                const btns = document.querySelectorAll('button');
                for (let btn of btns) {
                    if (btn.textContent.includes('Skicka inloggningskod')) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            ''')
        except Exception as e:
            return {"success": False, "error": f"Click error: {e}"}

        time.sleep(3)
        self.save_screenshot("code-requested")

        # Steg 2: Polla efter kod från Resend
        self.log("📧 Pollar efter verifieringskod från email...")
        code = poll_for_ratsit_code(code_request_time, timeout_sec=90)

        if not code:
            self.save_screenshot("no-code-received")
            return {"success": False, "error": "No verification code received in email"}

        self.log(f"✅ Kod mottagen: {code}")

        # Steg 3: Fyll i koden
        time.sleep(1)
        code_input = None
        for sel in ['xpath://input[contains(@placeholder,"inloggningskod")]', 'xpath://input[contains(@placeholder,"kod")]']:
            try:
                code_input = self.page.ele(sel, timeout=2)
                if code_input:
                    break
            except:
                pass

        if not code_input:
            return {"success": False, "error": "Code input field not found"}

        self.log(f"Fyller i kod: {code}")
        code_input.clear()
        code_input.input(code)
        time.sleep(0.5)
        self.save_screenshot("code-filled")

        # Steg 4: Klicka på "Bekräfta kod och logga in"
        self.log("Klickar 'Bekräfta kod och logga in'...")
        try:
            self.page.run_js('''
                const btns = document.querySelectorAll('button');
                for (let btn of btns) {
                    if (btn.textContent.includes('Bekräfta kod') || btn.textContent.includes('Logga in')) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            ''')
        except:
            pass

        time.sleep(5)
        self.save_screenshot("after-login")

        # Verifiera inloggning
        html = self.page.html or ""
        if any(x in html for x in ['Logga ut', 'Mitt konto', 'Min sida', 'Mina bevakningar']):
            self.log("🎉 Inloggning lyckades!")
            self.save_cookies()
            return {
                "success": True,
                "status": "logged_in",
                "message": "Successfully logged in to Ratsit"
            }
        else:
            self.log("❌ Inloggning verifiering misslyckades")
            self.save_screenshot("login-verification-failed")
            return {"success": False, "error": "Login verification failed - not logged in"}

    def submit_login_code(self, code):
        """Fyll i engångskoden och slutför inloggningen"""
        self.log(f"Fyller i engångskod: {code}")

        try:
            # Hitta kodfältet
            code_input = self.page.ele('xpath://input[contains(@placeholder,"kod") or contains(@name,"code")]', timeout=5)
            if not code_input:
                code_input = self.page.ele('xpath://input[@type="text"]', timeout=2)

            if code_input:
                code_input.clear()
                code_input.input(code)
                time.sleep(0.5)
            else:
                return {"success": False, "error": "Code input not found"}

            # Klicka på "Logga in" eller liknande
            login_btn = self.page.ele('xpath://button[contains(text(),"Logga in") or contains(text(),"Verifiera")]', timeout=3)
            if login_btn:
                login_btn.click()
                time.sleep(3)

            # Verifiera inloggning
            html = self.page.html
            if 'Logga ut' in html or 'Mitt konto' in html or 'Min sida' in html:
                self.log("✅ Inloggning lyckades!")
                self.save_cookies()
                return {"success": True, "status": "logged_in"}
            else:
                self.save_screenshot("login-failed")
                return {"success": False, "error": "Login verification failed"}

        except Exception as e:
            self.log(f"Code submit error: {e}")
            return {"success": False, "error": str(e)}

    def save_cookies(self):
        """Spara cookies för framtida användning"""
        try:
            cookies = self.page.cookies()
            with open(COOKIE_FILE, 'w') as f:
                json.dump(cookies, f)
            self.log(f"Cookies sparade till {COOKIE_FILE}")
        except Exception as e:
            self.log(f"Cookie save error: {e}")

    def load_cookies(self):
        """Ladda sparade cookies"""
        try:
            if os.path.exists(COOKIE_FILE):
                with open(COOKIE_FILE, 'r') as f:
                    cookies = json.load(f)
                for cookie in cookies:
                    self.page.set_cookies(cookie)
                self.log("Cookies laddade")
                return True
        except Exception as e:
            self.log(f"Cookie load error: {e}")
        return False

    def search_person(self, query):
        """Sök efter person på Ratsit"""
        self.log(f"Söker efter: {query}")

        search_url = f"{RATSIT_BASE_URL}/sok/person?vem={query.replace(' ', '+')}"
        self.page.get(search_url)

        if not self.wait_for_cloudflare():
            return {"success": False, "error": "Cloudflare timeout"}

        self.dismiss_cookie_dialog()
        time.sleep(2)

        # Parsa sökresultat
        results = []
        try:
            # Ratsit personprofil-länkar har format: /19XXXXXX-Namn_Efternamn
            # Hitta alla länkar i resultatlistan
            result_links = self.page.eles('xpath://div[contains(@class,"result")]//a')

            seen_urls = set()
            for link_elem in result_links:
                try:
                    href = link_elem.attr('href')
                    if not href:
                        continue

                    # Filtrera bort köp-länkar och behåll personprofiler
                    # Personprofiler matchar: /19XXXXXX-Namn eller ratsit.se/19XXXXXX-Namn
                    if '/kop/' in href or '/kassa/' in href:
                        continue

                    # Kolla om det är en personprofil (börjar med födelsedatum)
                    import re
                    if not re.search(r'/\d{8}-', href):
                        continue

                    # Undvik dubbletter
                    if href in seen_urls:
                        continue
                    seen_urls.add(href)

                    name = link_elem.text.strip()
                    # Ta bara första raden (namnet, inte adressen)
                    name = name.split('\n')[0].strip()

                    if not name or len(name) < 3:
                        continue

                    full_url = href if href.startswith('http') else f"{RATSIT_BASE_URL}{href}"

                    results.append({
                        "name": name,
                        "url": full_url
                    })

                    if len(results) >= 10:  # Max 10 resultat
                        break
                except Exception as e:
                    pass

        except Exception as e:
            self.log(f"Search parse error: {e}")

        self.save_screenshot("search-results")

        return {
            "success": True,
            "query": query,
            "results": results,
            "count": len(results)
        }

    def person_url_to_income_url(self, person_url):
        """
        Konvertera person-URL till direkt köp-URL för inkomstuppgifter.

        Person-URL format: https://www.ratsit.se/19370108-Jan_Artur_Andersson_Stockholm/kAu-1wkDXgyQenLm1v-2UbEfAeOhZn9zzSo5qmibDBk
        Köp-URL format:    https://www.ratsit.se/kop/plus/lonekollen/{id}#:~:text=Ta-,L%C3%B6nekoll
        """
        # Extrahera ID-koden från slutet av URL:en
        parts = person_url.rstrip('/').split('/')
        if len(parts) >= 2:
            person_id = parts[-1]  # Sista delen är ID-koden
            # Direkt till köpsidan med anchor för att hoppa till Lönekoll
            return f"{RATSIT_BASE_URL}/kop/plus/lonekollen/{person_id}#:~:text=Ta-,L%C3%B6nekoll"
        return None

    def fetch_person_income(self, person_url=None, person_name=None, person_ssn=None):
        """Hämta inkomstdata för en person"""
        self.log(f"Hämtar inkomst för: {person_name or person_url}")

        # Om vi har person-URL, konvertera direkt till löne-URL
        if person_url:
            income_url = self.person_url_to_income_url(person_url)
            if income_url:
                self.log(f"Löne-URL: {income_url}")
                self.page.get(income_url)
            else:
                self.page.get(person_url)
        elif person_name:
            # Sök och hitta personen först
            search_result = self.search_person(person_name)
            if not search_result.get('results'):
                return {"success": False, "error": "Person not found in search"}

            # Gå till första resultatet
            first_result = search_result['results'][0]
            if first_result.get('url'):
                self.page.get(first_result['url'])
            else:
                return {"success": False, "error": "No URL in search result"}
        else:
            return {"success": False, "error": "Need person_url or person_name"}

        if not self.wait_for_cloudflare():
            return {"success": False, "error": "Cloudflare timeout"}

        self.dismiss_cookie_dialog()
        time.sleep(2)

        # Parsa persondata
        income_data = {
            "success": True,
            "person": {},
            "income": {}
        }

        try:
            html = self.page.html

            # Personinfo
            name_elem = self.page.ele('xpath://h1', timeout=3)
            if name_elem:
                income_data["person"]["name"] = name_elem.text

            # Leta efter inkomstsektion
            income_section = self.page.ele('xpath://*[contains(text(),"Inkomst") or contains(text(),"inkomst")]', timeout=3)
            if income_section:
                # Försök hitta inkomstbelopp
                income_matches = re.findall(r'(\d[\d\s]*)\s*kr', html)
                if income_matches:
                    # Ta det största beloppet som troligen är årsinkomst
                    amounts = [int(m.replace(' ', '')) for m in income_matches]
                    income_data["income"]["annual"] = max(amounts)

            # Leta efter taxerad inkomst
            tax_match = re.search(r'[Tt]axerad\s+inkomst[:\s]+(\d[\d\s]*)\s*kr', html)
            if tax_match:
                income_data["income"]["taxed"] = int(tax_match.group(1).replace(' ', ''))

            self.save_screenshot("person-income")

        except Exception as e:
            self.log(f"Income parse error: {e}")
            income_data["error"] = str(e)

        return income_data

    def get_purchase_history(self):
        """Hämta köphistorik med PDF-länkar från Mina sidor"""
        self.log("Hämtar köphistorik...")

        self.page.get(f"{RATSIT_BASE_URL}/minasidor/historikaktivitet")

        if not self.wait_for_cloudflare():
            return {"success": False, "error": "Cloudflare timeout"}

        time.sleep(2)

        purchases = []
        try:
            # Hitta alla nedladdningslänkar
            download_links = self.page.eles('xpath://a[contains(@href,"/download/")]')

            for link in download_links:
                href = link.attr('href')
                text = link.text.strip()

                if href and '/download/' in href:
                    # Extrahera order-ID från URL
                    order_id_match = re.search(r'/download/([a-f0-9-]+)', href)
                    order_id = order_id_match.group(1) if order_id_match else None

                    # Extrahera personnamnfrån texten
                    name_match = re.search(r'inkl\.\s*(.+)$', text)
                    person_name = name_match.group(1).strip() if name_match else None

                    purchases.append({
                        "order_id": order_id,
                        "product": text,
                        "person_name": person_name,
                        "download_url": href if href.startswith('http') else f"{RATSIT_BASE_URL}{href}"
                    })

        except Exception as e:
            self.log(f"History parse error: {e}")

        self.save_screenshot("purchase-history")

        return {
            "success": True,
            "purchases": purchases,
            "count": len(purchases)
        }

    def buy_income_report(self, person_url):
        """
        Köp lönekoll för en person.
        VARNING: Detta kostar pengar/pott! Kolla historik först.
        """
        self.log(f"Köper lönekoll för: {person_url}")

        # Konvertera person-URL till köp-URL
        income_url = self.person_url_to_income_url(person_url)
        if not income_url:
            return {"success": False, "error": "Could not create income URL"}

        self.log(f"Köp-URL: {income_url}")
        self.page.get(income_url)

        if not self.wait_for_cloudflare():
            return {"success": False, "error": "Cloudflare timeout"}

        time.sleep(2)

        # Klicka på "Ta Lönekoll"
        try:
            ta_lonekoll_btn = self.page.ele('xpath://button[contains(text(),"Ta Lönekoll")]', timeout=5)
            if ta_lonekoll_btn:
                self.log("Klickar 'Ta Lönekoll'...")
                ta_lonekoll_btn.click()
                time.sleep(3)

                self.save_screenshot("after-buy")

                # Hämta order-ID från URL
                current_url = self.page.url
                order_id_match = re.search(r'/orderbekraftelse/([a-f0-9-]+)', current_url)
                order_id = order_id_match.group(1) if order_id_match else None

                return {
                    "success": True,
                    "order_id": order_id,
                    "message": "Lönekoll purchased successfully",
                    "download_url": f"{RATSIT_BASE_URL}/kop/order/internt/download/{order_id}" if order_id else None
                }
            else:
                return {"success": False, "error": "Could not find 'Ta Lönekoll' button"}

        except Exception as e:
            self.log(f"Buy error: {e}")
            return {"success": False, "error": str(e)}

    def close(self):
        """Stäng browser"""
        if self.page:
            self.page.quit()
            self.log("Browser stängd")


def main():
    parser = argparse.ArgumentParser(description='Ratsit Scraper med DrissionPage')
    parser.add_argument('--action', required=True,
                        choices=['login', 'full-login', 'code', 'search', 'fetch', 'history', 'buy', 'test'],
                        help='Åtgärd att utföra')
    parser.add_argument('--email', help='Email för inloggning')
    parser.add_argument('--code', help='Engångskod från email')
    parser.add_argument('--query', help='Sökterm för personsökning')
    parser.add_argument('--person-name', help='Personnamn för inkomsthämtning')
    parser.add_argument('--person-url', help='Direkt URL till personprofil')
    parser.add_argument('--headless', action='store_true', help='Kör headless (ingen GUI)')
    parser.add_argument('--debug', action='store_true', help='Debug-läge')

    args = parser.parse_args()

    scraper = RatsitScraper(headless=args.headless, debug=args.debug)

    try:
        scraper.init_browser()

        if args.action == 'test':
            # Bara testa att vi kan nå Ratsit
            scraper.page.get(RATSIT_LOGIN_URL)
            if scraper.wait_for_cloudflare():
                result = {"success": True, "message": "Cloudflare bypass successful!"}
            else:
                result = {"success": False, "error": "Cloudflare bypass failed"}

        elif args.action == 'full-login':
            # Komplett automatisk inloggning med email-kod
            email = args.email or AUTOMATION_EMAIL
            result = scraper.full_login(email)

        elif args.action == 'login':
            if not args.email:
                result = {"success": False, "error": "Email required for login"}
            else:
                result = scraper.login_with_email_code(args.email)

        elif args.action == 'code':
            if not args.code:
                result = {"success": False, "error": "Code required"}
            else:
                result = scraper.submit_login_code(args.code)

        elif args.action == 'search':
            if not args.query:
                result = {"success": False, "error": "Query required for search"}
            else:
                result = scraper.search_person(args.query)

        elif args.action == 'fetch':
            result = scraper.fetch_person_income(
                person_url=args.person_url,
                person_name=args.person_name
            )

        elif args.action == 'history':
            # Hämta köphistorik (kräver inloggning)
            result = scraper.get_purchase_history()

        elif args.action == 'buy':
            # Köp lönekoll (VARNING: kostar!)
            if not args.person_url:
                result = {"success": False, "error": "person-url required for buy"}
            else:
                result = scraper.buy_income_report(args.person_url)

        else:
            result = {"success": False, "error": f"Unknown action: {args.action}"}

        # Output JSON
        print(json.dumps(result, ensure_ascii=False, indent=2))

    except Exception as e:
        error_result = {"success": False, "error": str(e)}
        print(json.dumps(error_result, ensure_ascii=False, indent=2))
        sys.exit(1)

    finally:
        scraper.close()


if __name__ == "__main__":
    main()
