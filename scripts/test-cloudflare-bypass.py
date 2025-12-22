#!/usr/bin/env python3
"""
Test olika Cloudflare bypass-metoder för Ratsit.se
"""

import asyncio
import sys
import time
import os
from pathlib import Path

TARGET_URL = "https://www.ratsit.se/loggain"
# Använd relativ path
PROJECT_ROOT = Path(__file__).parent.parent
SCREENSHOT_DIR = str(PROJECT_ROOT / "data" / "screenshots")

def save_screenshot(page, name):
    """Spara screenshot"""
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    path = f"{SCREENSHOT_DIR}/bypass-test-{name}-{timestamp}.png"
    try:
        if hasattr(page, 'screenshot'):
            # Sync API
            page.screenshot(path)
        elif hasattr(page, 'save_screenshot'):
            page.save_screenshot(path)
        print(f"  Screenshot: {path}")
    except Exception as e:
        print(f"  Screenshot error: {e}")

# =============================================================================
# METOD 1: DrissionPage
# =============================================================================
def test_drissionpage():
    """Test med DrissionPage - kontrollerar browser direkt utan WebDriver"""
    print("\n" + "="*60)
    print("METOD 1: DrissionPage")
    print("="*60)

    try:
        from DrissionPage import ChromiumPage, ChromiumOptions

        # Konfigurera browser
        options = ChromiumOptions()
        options.set_argument('--no-sandbox')
        options.set_argument('--disable-dev-shm-usage')
        options.set_argument('--lang=sv-SE')
        # Använd vanlig Chrome, inte headless
        options.headless(False)

        print("  Startar ChromiumPage...")
        page = ChromiumPage(options)

        print(f"  Navigerar till {TARGET_URL}...")
        page.get(TARGET_URL)

        # Vänta och kolla efter Cloudflare
        print("  Väntar på sidan (max 60s)...")
        for i in range(12):
            time.sleep(5)
            current_url = page.url
            title = page.title
            print(f"    [{i*5}s] URL: {current_url[:50]}... | Title: {title[:30] if title else 'N/A'}...")

            # Kolla om vi passerat Cloudflare
            html = page.html
            if 'Logga in' in html or 'E-post' in html or 'Lösenord' in html:
                print("  ✅ LYCKADES! Inloggningssidan nådd!")
                save_screenshot(page, "drissionpage-success")
                page.quit()
                return True

            # Kolla om vi fortfarande är på Cloudflare
            if 'Bekräfta att du är en människa' in html or 'Verifierar' in html:
                print(f"    Cloudflare challenge aktiv...")
                save_screenshot(page, f"drissionpage-waiting-{i*5}s")

        print("  ❌ Timeout - Cloudflare passerades inte")
        save_screenshot(page, "drissionpage-timeout")
        page.quit()
        return False

    except Exception as e:
        print(f"  ❌ Fel: {e}")
        return False

# =============================================================================
# METOD 2: Camoufox
# =============================================================================
async def test_camoufox():
    """Test med Camoufox - Firefox med C++ fingerprint spoofing"""
    print("\n" + "="*60)
    print("METOD 2: Camoufox")
    print("="*60)

    try:
        from camoufox.async_api import AsyncCamoufox

        print("  Startar Camoufox browser...")
        async with AsyncCamoufox(headless=False) as browser:
            page = await browser.new_page()

            print(f"  Navigerar till {TARGET_URL}...")
            await page.goto(TARGET_URL, wait_until='domcontentloaded')

            print("  Väntar på sidan (max 90s)...")
            for i in range(18):
                await asyncio.sleep(5)
                current_url = page.url
                title = await page.title()
                print(f"    [{i*5}s] URL: {current_url[:50]}... | Title: {title[:30] if title else 'N/A'}...")

                # Kolla HTML
                html = await page.content()

                # Framgång?
                if 'Logga in' in html or 'E-post' in html:
                    print("  ✅ LYCKADES! Inloggningssidan nådd!")
                    await page.screenshot(path=f"{SCREENSHOT_DIR}/bypass-camoufox-success.png")
                    return True

                # Försök klicka på Turnstile om den finns
                if 'challenges.cloudflare.com' in html or 'Verifierar' in html:
                    print(f"    Cloudflare aktiv, försöker hitta Turnstile iframe...")

                    # Försök hitta och klicka på iframe
                    try:
                        frames = page.frames
                        for frame in frames:
                            if 'challenges.cloudflare.com' in frame.url:
                                print(f"    Hittade Turnstile frame: {frame.url[:60]}...")
                                # Hämta iframe position och klicka
                                iframe_element = await page.query_selector(f'iframe[src*="challenges.cloudflare.com"]')
                                if iframe_element:
                                    box = await iframe_element.bounding_box()
                                    if box:
                                        # Klicka i mitten av iframe (där checkbox borde vara)
                                        click_x = box['x'] + box['width'] / 4
                                        click_y = box['y'] + box['height'] / 2
                                        print(f"    Klickar på Turnstile @ ({click_x}, {click_y})")
                                        await page.mouse.click(click_x, click_y)
                                        await asyncio.sleep(3)
                    except Exception as click_err:
                        print(f"    Klick-fel: {click_err}")

            print("  ❌ Timeout - Cloudflare passerades inte")
            await page.screenshot(path=f"{SCREENSHOT_DIR}/bypass-camoufox-timeout.png")
            return False

    except Exception as e:
        print(f"  ❌ Fel: {e}")
        import traceback
        traceback.print_exc()
        return False

# =============================================================================
# METOD 3: Nodriver
# =============================================================================
async def test_nodriver():
    """Test med nodriver - Efterträdare till undetected-chromedriver"""
    print("\n" + "="*60)
    print("METOD 3: Nodriver")
    print("="*60)

    try:
        import nodriver as uc

        print("  Startar nodriver browser...")
        browser = await uc.start(headless=False)

        print(f"  Navigerar till {TARGET_URL}...")
        page = await browser.get(TARGET_URL)

        print("  Väntar på sidan (max 60s)...")
        for i in range(12):
            await asyncio.sleep(5)

            # Hämta HTML
            try:
                html = await page.get_content()
                title_elem = await page.query_selector('title')
                title = await title_elem.text if title_elem else "N/A"
            except:
                html = ""
                title = "N/A"

            print(f"    [{i*5}s] Title: {title[:30] if title else 'N/A'}...")

            # Framgång?
            if 'Logga in' in html or 'E-post' in html:
                print("  ✅ LYCKADES! Inloggningssidan nådd!")
                await page.save_screenshot(f"{SCREENSHOT_DIR}/bypass-nodriver-success.png")
                browser.stop()
                return True

            # Cloudflare?
            if 'Bekräfta att du är en människa' in html or 'Verifierar' in html:
                print(f"    Cloudflare challenge aktiv...")

        print("  ❌ Timeout - Cloudflare passerades inte")
        await page.save_screenshot(f"{SCREENSHOT_DIR}/bypass-nodriver-timeout.png")
        browser.stop()
        return False

    except Exception as e:
        print(f"  ❌ Fel: {e}")
        import traceback
        traceback.print_exc()
        return False

# =============================================================================
# METOD 4: DrissionPage med CloudflareBypasser
# =============================================================================
def test_drissionpage_with_bypasser():
    """Test med DrissionPage + CloudflareBypasser logik"""
    print("\n" + "="*60)
    print("METOD 4: DrissionPage + CloudflareBypasser")
    print("="*60)

    try:
        from DrissionPage import ChromiumPage, ChromiumOptions

        options = ChromiumOptions()
        options.set_argument('--no-sandbox')
        options.set_argument('--disable-dev-shm-usage')
        options.set_argument('--disable-blink-features=AutomationControlled')
        options.headless(False)

        # Sätt random user agent
        import random
        user_agents = [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        ]
        options.set_argument(f'--user-agent={random.choice(user_agents)}')

        print("  Startar ChromiumPage med bypasser-logik...")
        page = ChromiumPage(options)

        print(f"  Navigerar till {TARGET_URL}...")
        page.get(TARGET_URL)

        # CloudflareBypasser-liknande logik
        print("  Kör CloudflareBypasser-logik...")
        max_attempts = 20

        for attempt in range(max_attempts):
            time.sleep(3)

            try:
                html = page.html
                title = page.title or ""

                # Kolla om vi är förbi Cloudflare
                if any(x in html for x in ['Logga in', 'E-post', 'Lösenord', 'login']):
                    print(f"  ✅ LYCKADES efter {attempt} försök!")
                    save_screenshot(page, "bypasser-success")
                    page.quit()
                    return True

                # Kolla efter Cloudflare challenge
                is_cloudflare = any(x in html for x in [
                    'Bekräfta att du är en människa',
                    'Verifierar',
                    'challenges.cloudflare.com',
                    'cf-turnstile',
                    'Just a moment'
                ])

                if is_cloudflare:
                    print(f"    [{attempt}] Cloudflare aktiv, försöker bypass...")

                    # Försök 1: Klicka på verify-knappen om den finns
                    try:
                        verify_btn = page.ele('xpath://input[@type="checkbox"]|//button[contains(text(),"Verify")]|//div[contains(@class,"cf-turnstile")]', timeout=2)
                        if verify_btn:
                            print(f"    Hittade element, klickar...")
                            verify_btn.click()
                            time.sleep(3)
                    except:
                        pass

                    # Försök 2: Hitta iframe och klicka
                    try:
                        iframe = page.ele('xpath://iframe[contains(@src,"challenges.cloudflare.com")]', timeout=2)
                        if iframe:
                            print(f"    Hittade Turnstile iframe, klickar...")
                            # Gå in i iframe och klicka
                            iframe.click()
                            time.sleep(3)
                    except:
                        pass
                else:
                    print(f"    [{attempt}] Väntar på sidan...")

            except Exception as e:
                print(f"    [{attempt}] Fel vid check: {e}")

        print("  ❌ Max försök nådda")
        save_screenshot(page, "bypasser-timeout")
        page.quit()
        return False

    except Exception as e:
        print(f"  ❌ Fel: {e}")
        import traceback
        traceback.print_exc()
        return False

# =============================================================================
# METOD 5: Playwright med Stealth
# =============================================================================
async def test_playwright_stealth():
    """Test med playwright-stealth"""
    print("\n" + "="*60)
    print("METOD 5: Playwright + Stealth")
    print("="*60)

    try:
        from playwright.async_api import async_playwright

        print("  Startar Playwright...")
        async with async_playwright() as p:
            # Starta browser med stealth-liknande settings
            browser = await p.chromium.launch(
                headless=False,
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--lang=sv-SE',
                ]
            )

            context = await browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                locale='sv-SE',
            )

            page = await context.new_page()

            # Injicera stealth-script
            await page.add_init_script("""
                // Mask webdriver
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

                // Mock plugins
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });

                // Mock languages
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['sv-SE', 'sv', 'en-US', 'en']
                });

                // Hide automation
                window.chrome = { runtime: {} };
            """)

            print(f"  Navigerar till {TARGET_URL}...")
            await page.goto(TARGET_URL, wait_until='domcontentloaded')

            print("  Väntar på sidan (max 60s)...")
            for i in range(12):
                await asyncio.sleep(5)

                html = await page.content()
                title = await page.title()
                print(f"    [{i*5}s] Title: {title[:30] if title else 'N/A'}...")

                if 'Logga in' in html or 'E-post' in html:
                    print("  ✅ LYCKADES!")
                    await page.screenshot(path=f"{SCREENSHOT_DIR}/bypass-playwright-success.png")
                    await browser.close()
                    return True

                if 'challenges.cloudflare.com' in html:
                    print("    Försöker klicka på Turnstile...")
                    try:
                        iframe = page.frame_locator('iframe[src*="challenges.cloudflare.com"]')
                        checkbox = iframe.locator('input[type="checkbox"]')
                        if await checkbox.count() > 0:
                            await checkbox.click()
                            await asyncio.sleep(3)
                    except:
                        pass

            print("  ❌ Timeout")
            await page.screenshot(path=f"{SCREENSHOT_DIR}/bypass-playwright-timeout.png")
            await browser.close()
            return False

    except Exception as e:
        print(f"  ❌ Fel: {e}")
        import traceback
        traceback.print_exc()
        return False

# =============================================================================
# HUVUDPROGRAM
# =============================================================================
async def main():
    print("="*60)
    print("  CLOUDFLARE BYPASS TEST FÖR RATSIT.SE")
    print("="*60)
    print(f"  Mål: {TARGET_URL}")
    print(f"  Tid: {time.strftime('%Y-%m-%d %H:%M:%S')}")

    results = {}

    # Test alla metoder
    methods = [
        ("DrissionPage", lambda: test_drissionpage()),
        ("Camoufox", lambda: asyncio.get_event_loop().run_until_complete(test_camoufox())),
        ("Nodriver", lambda: asyncio.get_event_loop().run_until_complete(test_nodriver())),
        ("DrissionPage+Bypasser", lambda: test_drissionpage_with_bypasser()),
        ("Playwright+Stealth", lambda: asyncio.get_event_loop().run_until_complete(test_playwright_stealth())),
    ]

    for name, test_func in methods:
        try:
            result = test_func()
            results[name] = result
            if result:
                print(f"\n🎉 {name} FUNGERADE! Stoppar övriga tester.")
                break
        except Exception as e:
            print(f"\n❌ {name} kraschade: {e}")
            results[name] = False

    # Sammanfattning
    print("\n" + "="*60)
    print("  SAMMANFATTNING")
    print("="*60)
    for name, success in results.items():
        status = "✅ LYCKADES" if success else "❌ Misslyckades"
        print(f"  {name}: {status}")

    return any(results.values())

if __name__ == "__main__":
    # Kör async main
    if sys.version_info >= (3, 10):
        success = asyncio.run(main())
    else:
        loop = asyncio.get_event_loop()
        success = loop.run_until_complete(main())

    sys.exit(0 if success else 1)
