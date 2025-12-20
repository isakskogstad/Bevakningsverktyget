#!/usr/bin/env python3
"""
Cloudflare Bypass Utility - Använder cloudscraper för att bypassa Cloudflare-skydd

Användning:
    python3 cloudflare-bypass.py <url> [--cookies] [--html]

Output (JSON):
    {
        "success": true,
        "cookies": [...],
        "html": "...",
        "user_agent": "..."
    }

Används av Node.js scrapers för att få giltiga cookies/session.
"""

import sys
import json
import cloudscraper

def bypass_cloudflare(url, return_html=False):
    """
    Bypassa Cloudflare-skydd och returnera cookies + user-agent
    """
    try:
        # Skapa scraper med browser-emulering
        scraper = cloudscraper.create_scraper(
            browser={
                'browser': 'chrome',
                'platform': 'darwin',  # macOS
                'desktop': True
            },
            delay=10  # Vänta på JS-challenges
        )

        # Gör request för att lösa Cloudflare challenge
        response = scraper.get(url, timeout=30)

        # Extrahera cookies
        cookies = []
        for cookie in scraper.cookies:
            cookies.append({
                'name': cookie.name,
                'value': cookie.value,
                'domain': cookie.domain,
                'path': cookie.path,
                'secure': cookie.secure,
                'httpOnly': cookie.has_nonstandard_attr('HttpOnly'),
                'sameSite': 'Lax'
            })

        result = {
            'success': True,
            'status_code': response.status_code,
            'cookies': cookies,
            'user_agent': scraper.headers.get('User-Agent', ''),
            'url': response.url
        }

        if return_html:
            result['html'] = response.text[:50000]  # Begränsa storlek

        return result

    except cloudscraper.exceptions.CloudflareChallengeError as e:
        return {
            'success': False,
            'error': f'Cloudflare challenge failed: {str(e)}',
            'error_type': 'cloudflare_challenge'
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }

def solve_turnstile(url):
    """
    Försök lösa Cloudflare Turnstile specifikt
    """
    try:
        scraper = cloudscraper.create_scraper(
            browser={
                'browser': 'chrome',
                'platform': 'darwin',
                'desktop': True
            },
            delay=15,  # Längre delay för Turnstile
            captcha={
                'provider': 'return_response'  # Returnera challenge-info
            }
        )

        response = scraper.get(url, timeout=45)

        cookies = []
        for cookie in scraper.cookies:
            cookies.append({
                'name': cookie.name,
                'value': cookie.value,
                'domain': cookie.domain,
                'path': cookie.path,
                'secure': cookie.secure
            })

        return {
            'success': response.status_code == 200,
            'status_code': response.status_code,
            'cookies': cookies,
            'user_agent': scraper.headers.get('User-Agent', ''),
            'cf_clearance': next((c['value'] for c in cookies if c['name'] == 'cf_clearance'), None)
        }

    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({
            'success': False,
            'error': 'Usage: python3 cloudflare-bypass.py <url> [--cookies] [--html] [--turnstile]'
        }))
        sys.exit(1)

    url = sys.argv[1]
    return_html = '--html' in sys.argv
    use_turnstile = '--turnstile' in sys.argv

    if use_turnstile:
        result = solve_turnstile(url)
    else:
        result = bypass_cloudflare(url, return_html)

    print(json.dumps(result, ensure_ascii=False))
