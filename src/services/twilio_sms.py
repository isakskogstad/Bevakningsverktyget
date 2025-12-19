"""
Twilio SMS Service - Läser inkommande SMS för OTP-koder (3D Secure)

Användning:
    sms_service = TwilioSMSService()
    otp = sms_service.wait_for_otp(timeout=120)  # Väntar på OTP i 2 min
"""

import os
import re
import time
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from dataclasses import dataclass

from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException

logger = logging.getLogger(__name__)

# Twilio credentials - läses från miljövariabler
TWILIO_CONFIG = {
    "account_sid": os.environ.get("TWILIO_ACCOUNT_SID", ""),
    "auth_token": os.environ.get("TWILIO_AUTH_TOKEN", ""),
    "phone_number": os.environ.get("TWILIO_PHONE_NUMBER", ""),
    # API Key (alternativ auth)
    "api_key_sid": os.environ.get("TWILIO_API_KEY_SID", ""),
    "api_key_secret": os.environ.get("TWILIO_API_KEY_SECRET", ""),
}

if not TWILIO_CONFIG["account_sid"]:
    logger.warning("TWILIO_ACCOUNT_SID saknas - sätt miljövariabel eller använd admin-panelen")


@dataclass
class SMSMessage:
    """Representerar ett SMS-meddelande"""
    sid: str
    from_number: str
    to_number: str
    body: str
    date_sent: datetime
    status: str


class TwilioSMSService:
    """
    Twilio SMS Service för att läsa inkommande SMS.
    Används för att hämta OTP-koder vid 3D Secure-betalningar.
    """

    def __init__(self):
        self.account_sid = TWILIO_CONFIG["account_sid"]
        self.auth_token = TWILIO_CONFIG["auth_token"]
        self.phone_number = TWILIO_CONFIG["phone_number"]

        # Skapa Twilio-klient
        self.client = Client(self.account_sid, self.auth_token)

        logger.info(f"TwilioSMSService initialiserad för {self.phone_number}")

    def list_messages(
        self,
        limit: int = 10,
        since: Optional[datetime] = None
    ) -> List[SMSMessage]:
        """
        Listar inkommande SMS-meddelanden till vårt Twilio-nummer.

        Args:
            limit: Max antal meddelanden att hämta
            since: Endast meddelanden efter detta datum

        Returns:
            Lista med SMSMessage-objekt
        """
        try:
            # Filtrera på meddelanden TO vårt nummer (inkommande)
            params = {
                "to": self.phone_number,
                "limit": limit,
            }

            if since:
                params["date_sent_after"] = since

            messages = self.client.messages.list(**params)

            result = []
            for msg in messages:
                sms = SMSMessage(
                    sid=msg.sid,
                    from_number=msg.from_,
                    to_number=msg.to,
                    body=msg.body,
                    date_sent=msg.date_sent,
                    status=msg.status
                )
                result.append(sms)

            logger.debug(f"Hämtade {len(result)} SMS-meddelanden")
            return result

        except TwilioRestException as e:
            logger.error(f"Twilio API-fel: {e}")
            return []

    def extract_otp(self, text: str) -> Optional[str]:
        """
        Extraherar OTP-kod från SMS-text.

        Letar efter:
        - 4-8 siffror som står ensamma
        - "kod: 123456" eller "code: 123456"
        - "OTP: 123456"
        - "engångskod: 123456"

        Args:
            text: SMS-meddelandetext

        Returns:
            OTP-kod som sträng, eller None
        """
        if not text:
            return None

        text_lower = text.lower()

        # Mönster för OTP-koder
        patterns = [
            # "kod: 123456" eller "code: 123456"
            r'(?:kod|code|otp|engångskod|verifieringskod|säkerhetskod)[:\s]+(\d{4,8})',
            # "din kod är 123456"
            r'(?:din|your)\s+(?:kod|code)\s+(?:är|is)[:\s]+(\d{4,8})',
            # Fristående 6-siffrig kod (vanligast)
            r'\b(\d{6})\b',
            # Fristående 4-8 siffrig kod
            r'\b(\d{4,8})\b',
        ]

        for pattern in patterns:
            match = re.search(pattern, text_lower)
            if match:
                otp = match.group(1)
                logger.info(f"Extraherade OTP: {otp} från mönster: {pattern}")
                return otp

        return None

    def get_latest_otp(
        self,
        since: Optional[datetime] = None,
        from_number: Optional[str] = None
    ) -> Optional[str]:
        """
        Hämtar senaste OTP-kod från inkommande SMS.

        Args:
            since: Endast SMS efter detta datum (default: senaste 5 min)
            from_number: Filtrera på avsändarnummer

        Returns:
            OTP-kod som sträng, eller None
        """
        if since is None:
            # Default: senaste 5 minuter
            since = datetime.now(timezone.utc) - timedelta(minutes=5)

        messages = self.list_messages(limit=20, since=since)

        for msg in messages:
            # Filtrera på avsändare om angivet
            if from_number and msg.from_number != from_number:
                continue

            otp = self.extract_otp(msg.body)
            if otp:
                logger.info(f"Hittade OTP: {otp} från {msg.from_number}")
                return otp

        return None

    def wait_for_otp(
        self,
        timeout: int = 120,
        poll_interval: int = 5,
        since: Optional[datetime] = None
    ) -> Optional[str]:
        """
        Väntar på inkommande OTP-kod.
        Pollar Twilio API tills OTP hittas eller timeout.

        Args:
            timeout: Max väntetid i sekunder (default: 120s = 2 min)
            poll_interval: Sekunder mellan varje kontroll (default: 5s)
            since: Startpunkt för sökning (default: nu)

        Returns:
            OTP-kod som sträng, eller None vid timeout
        """
        if since is None:
            since = datetime.now(timezone.utc)

        start_time = time.time()
        attempt = 0

        logger.info(f"Väntar på OTP (timeout: {timeout}s, intervall: {poll_interval}s)")

        while (time.time() - start_time) < timeout:
            attempt += 1

            otp = self.get_latest_otp(since=since)
            if otp:
                elapsed = time.time() - start_time
                logger.info(f"OTP mottagen efter {elapsed:.1f}s ({attempt} försök)")
                return otp

            # Vänta innan nästa kontroll
            remaining = timeout - (time.time() - start_time)
            if remaining > poll_interval:
                logger.debug(f"Ingen OTP ännu, väntar {poll_interval}s... ({remaining:.0f}s kvar)")
                time.sleep(poll_interval)
            else:
                break

        logger.warning(f"Timeout ({timeout}s) - ingen OTP mottagen")
        return None

    def get_account_info(self) -> dict:
        """Hämtar kontoinformation för debugging"""
        try:
            account = self.client.api.accounts(self.account_sid).fetch()
            return {
                "sid": account.sid,
                "friendly_name": account.friendly_name,
                "status": account.status,
                "type": account.type,
            }
        except TwilioRestException as e:
            return {"error": str(e)}


# CLI-test
if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    print("=" * 60)
    print("Twilio SMS Service - Test")
    print("=" * 60)

    service = TwilioSMSService()

    # Visa kontoinformation
    print("\n1. Kontoinformation:")
    info = service.get_account_info()
    for key, value in info.items():
        print(f"   {key}: {value}")

    # Lista senaste SMS
    print("\n2. Senaste SMS (max 5):")
    messages = service.list_messages(limit=5)

    if not messages:
        print("   Inga meddelanden hittade")
    else:
        for msg in messages:
            print(f"   [{msg.date_sent}] Från: {msg.from_number}")
            print(f"   Text: {msg.body[:100]}...")
            otp = service.extract_otp(msg.body)
            if otp:
                print(f"   -> OTP: {otp}")
            print()

    # Test OTP-extraktion
    print("\n3. OTP-extraktion test:")
    test_messages = [
        "Din säkerhetskod är 123456",
        "Your verification code: 789012",
        "OTP: 456789 - giltig i 5 minuter",
        "Använd kod 112233 för att verifiera",
        "Random text utan kod",
    ]

    for text in test_messages:
        otp = service.extract_otp(text)
        print(f"   '{text}' -> OTP: {otp}")

    print("\n" + "=" * 60)
