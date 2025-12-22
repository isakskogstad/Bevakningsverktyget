#!/usr/bin/env python3
"""
Test DrissionPage för Cloudflare bypass på Ratsit.se
"""

import time
import sys
from pathlib import Path

TARGET_URL = "https://www.ratsit.se/loggain"
# Använd relativ path
PROJECT_ROOT = Path(__file__).parent.parent
SCREENSHOT_DIR = str(PROJECT_ROOT / "data" / "screenshots")

def main():
    print("="*60)
    print("  DRISSIONPAGE CLOUDFLARE BYPASS TEST")
    print("="*60)
    print(f"  Target: {TARGET_URL}")
    print(f"  Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")

    try:
        from DrissionPage import ChromiumPage, ChromiumOptions

        # Konfigurera browser
        print("\n[1] Konfigurerar browser...")
        options = ChromiumOptions()
        options.set_argument('--no-sandbox')
        options.set_argument('--disable-dev-shm-usage')
        options.set_argument('--disable-blink-features=AutomationControlled')
        options.set_argument('--lang=sv-SE')
        options.set_argument('--window-size=1920,1080')

        # Inte headless - behövs för Cloudflare
        options.headless(False)

        print("[2] Startar browser...")
        page = ChromiumPage(options)

        print(f"[3] Navigerar till {TARGET_URL}...")
        page.get(TARGET_URL)

        # Vänta och kolla efter Cloudflare
        print("[4] Väntar på Cloudflare bypass (max 120s)...")

        start_time = time.time()
        max_wait = 120
        check_interval = 3

        while time.time() - start_time < max_wait:
            elapsed = int(time.time() - start_time)

            try:
                html = page.html or ""
                title = page.title or ""
                url = page.url or ""

                # Kolla om vi lyckades komma förbi Cloudflare
                success_indicators = [
                    'Logga in' in html,
                    'E-post' in html,
                    'Lösenord' in html,
                    'BankID' in html,
                    'engångskod' in html,
                    'input' in html and 'email' in html.lower(),
                ]

                if any(success_indicators):
                    print(f"\n✅ FRAMGÅNG efter {elapsed}s!")
                    print(f"   URL: {url}")
                    print(f"   Title: {title}")

                    # Spara screenshot
                    screenshot_path = f"{SCREENSHOT_DIR}/drissionpage-success-{time.strftime('%Y%m%d-%H%M%S')}.png"
                    page.get_screenshot(screenshot_path)
                    print(f"   Screenshot: {screenshot_path}")

                    # Skriv lite av HTML för verifiering
                    print("\n   HTML-snippet (första 500 tecken):")
                    print("   " + html[:500].replace('\n', ' ')[:200] + "...")

                    page.quit()
                    return True

                # Kolla Cloudflare-status
                cloudflare_indicators = [
                    'Bekräfta att du är en människa' in html,
                    'Verifierar' in html,
                    'challenges.cloudflare.com' in html,
                    'cf-turnstile' in html,
                    'Just a moment' in html,
                    '__cf_chl' in url,
                ]

                is_cloudflare = any(cloudflare_indicators)

                if is_cloudflare:
                    print(f"   [{elapsed}s] Cloudflare aktiv, väntar...")

                    # Försök hitta och klicka på Turnstile checkbox
                    try:
                        # Leta efter iframe med Turnstile
                        turnstile_iframe = page.ele('xpath://iframe[contains(@src,"challenges.cloudflare.com")]', timeout=1)
                        if turnstile_iframe:
                            print(f"   [{elapsed}s] Hittade Turnstile iframe, försöker interagera...")
                            # Klicka på iframe-elementet
                            turnstile_iframe.click()
                            time.sleep(2)
                    except:
                        pass

                    # Försök hitta verify-knapp
                    try:
                        verify_elements = [
                            'xpath://input[@type="checkbox"]',
                            'xpath://div[contains(@class,"cf-turnstile")]',
                            'xpath://*[contains(@class,"turnstile")]',
                        ]
                        for selector in verify_elements:
                            try:
                                elem = page.ele(selector, timeout=0.5)
                                if elem:
                                    print(f"   [{elapsed}s] Hittade element: {selector}, klickar...")
                                    elem.click()
                                    time.sleep(2)
                                    break
                            except:
                                pass
                    except:
                        pass
                else:
                    print(f"   [{elapsed}s] Laddar... (Title: {title[:40] if title else 'N/A'})")

                # Spara screenshot var 30:e sekund
                if elapsed > 0 and elapsed % 30 == 0:
                    screenshot_path = f"{SCREENSHOT_DIR}/drissionpage-{elapsed}s-{time.strftime('%Y%m%d-%H%M%S')}.png"
                    try:
                        page.get_screenshot(screenshot_path)
                        print(f"   Screenshot: {screenshot_path}")
                    except:
                        pass

            except Exception as e:
                print(f"   [{elapsed}s] Fel vid check: {e}")

            time.sleep(check_interval)

        # Timeout
        print(f"\n❌ TIMEOUT efter {max_wait}s")
        screenshot_path = f"{SCREENSHOT_DIR}/drissionpage-timeout-{time.strftime('%Y%m%d-%H%M%S')}.png"
        try:
            page.get_screenshot(screenshot_path)
            print(f"   Screenshot: {screenshot_path}")
        except:
            pass

        page.quit()
        return False

    except Exception as e:
        print(f"\n❌ FEL: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = main()
    print("\n" + "="*60)
    print(f"  RESULTAT: {'LYCKADES' if success else 'MISSLYCKADES'}")
    print("="*60)
    sys.exit(0 if success else 1)
