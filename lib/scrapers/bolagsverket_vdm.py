"""
Bolagsverket VDM (Värdefulla Datamängder) API Client
Official free API for company data - OAuth 2.0 authenticated

API Endpoints (Production):
- Token: https://portal.api.bolagsverket.se/oauth2/token
- API:   https://gw.api.bolagsverket.se/vardefulla-datamangder/v1

Features:
- OAuth 2.0 Client Credentials authentication
- Both sync and async HTTP support
- Automatic token refresh
- Structured logging
"""

import os
import time
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List

import requests
import httpx

try:
    from ..logging_config import get_source_logger
except ImportError:
    import logging
    def get_source_logger(name):
        return logging.getLogger(name)


logger = get_source_logger("bolagsverket_vdm")


class BolagsverketVDMClient:
    """
    Client for Bolagsverket's official VDM (Värdefulla Datamängder) API

    This API provides (free, no scraping needed):
    - Basic company info (name, orgnr, type, status)
    - Addresses (from SCB)
    - SNI codes (from SCB)
    - Annual reports (digitally submitted PDFs)
    - Registration/deregistration info
    - Legal form, organizational form
    - Ad-blocking status (reklamspärr)

    Does NOT provide:
    - Board members
    - Financial data / nyckeltal
    - Corporate structure / ownership

    Token handling:
    - Tokens are valid for 3600 seconds (1 hour)
    - Proactive renewal: 5 minutes before expiration
    - Reactive renewal: On 401 response, retry with new token
    """

    # API URLs
    TOKEN_URL = "https://portal.api.bolagsverket.se/oauth2/token"
    API_BASE_URL = "https://gw.api.bolagsverket.se/vardefulla-datamangder/v1"

    # Token management
    TOKEN_MARGIN_SECONDS = 300  # Renew 5 min before expiration
    MAX_RETRIES = 1  # Max retries on 401

    # Rate limiting / backoff for 429
    MAX_429_RETRIES = 3  # Max retries on 429 Too Many Requests
    BACKOFF_BASE_SECONDS = 5  # Base wait time (exponential: 5, 10, 20)

    def __init__(
        self,
        client_id: str = None,
        client_secret: str = None,
        environment: str = "production"
    ):
        """
        Initialize Bolagsverket VDM client.

        Args:
            client_id: OAuth client ID (or use BOLAGSVERKET_CLIENT_ID env var)
            client_secret: OAuth client secret (or use BOLAGSVERKET_CLIENT_SECRET env var)
            environment: 'production' or 'test'
        """
        self.client_id = client_id or os.environ.get("BOLAGSVERKET_CLIENT_ID")
        self.client_secret = client_secret or os.environ.get("BOLAGSVERKET_CLIENT_SECRET")

        if not self.client_id or not self.client_secret:
            logger.warning("Bolagsverket VDM credentials not configured")

        # URLs based on environment
        if environment == "test":
            self.token_url = "https://portal.api-test.bolagsverket.se/oauth2/token"
            self.api_base_url = "https://gw.api-test.bolagsverket.se/vardefulla-datamangder/v1"
        else:
            self.token_url = self.TOKEN_URL
            self.api_base_url = self.API_BASE_URL

        # Token management
        self._access_token: Optional[str] = None
        self._token_expires_at: Optional[datetime] = None

        # HTTP clients
        self._sync_session: Optional[requests.Session] = None
        self._async_client: Optional[httpx.AsyncClient] = None

    @property
    def is_configured(self) -> bool:
        """Check if client has valid credentials."""
        return bool(self.client_id and self.client_secret)

    # =========================================================================
    # TOKEN MANAGEMENT
    # =========================================================================

    def _invalidate_token(self):
        """Invalidate cached token (forces refresh on next request)."""
        self._access_token = None
        self._token_expires_at = None
        logger.debug("Token invalidated")

    def _get_token_sync(self) -> Optional[str]:
        """Get or refresh OAuth token (sync)."""
        if not self.is_configured:
            return None

        # Return cached token if still valid (with margin before expiration)
        if self._access_token and self._token_expires_at:
            if datetime.now() < self._token_expires_at - timedelta(seconds=self.TOKEN_MARGIN_SECONDS):
                return self._access_token

        try:
            response = requests.post(
                self.token_url,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "scope": "vardefulla-datamangder:ping vardefulla-datamangder:read"
                },
                timeout=30
            )
            response.raise_for_status()

            token_data = response.json()
            self._access_token = token_data.get("access_token")
            expires_in = token_data.get("expires_in", 3600)
            self._token_expires_at = datetime.now() + timedelta(seconds=expires_in)

            logger.debug(
                "OAuth token refreshed",
                expires_in=expires_in
            )

            return self._access_token

        except Exception as e:
            logger.error(f"Failed to get OAuth token: {e}")
            return None

    async def _get_token_async(self) -> Optional[str]:
        """Get or refresh OAuth token (async)."""
        if not self.is_configured:
            logger.warning("Bolagsverket VDM client not configured (missing client_id or client_secret)")
            return None

        # Return cached token if still valid (with margin before expiration)
        if self._access_token and self._token_expires_at:
            if datetime.now() < self._token_expires_at - timedelta(seconds=self.TOKEN_MARGIN_SECONDS):
                return self._access_token

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.token_url,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    data={
                        "grant_type": "client_credentials",
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "scope": "vardefulla-datamangder:ping vardefulla-datamangder:read"
                    },
                    timeout=30
                )
                response.raise_for_status()

                token_data = response.json()
                self._access_token = token_data.get("access_token")
                expires_in = token_data.get("expires_in", 3600)
                self._token_expires_at = datetime.now() + timedelta(seconds=expires_in)

                return self._access_token

        except Exception as e:
            logger.error(f"Failed to get OAuth token (async): {e}")
            return None

    # =========================================================================
    # SYNC API
    # =========================================================================

    def _format_orgnr(self, orgnr: str) -> tuple[str, str]:
        """
        Format organization number for API.

        Swedish org numbers: NNNNNN-NNNN (e.g., 556012-5791)

        Returns:
            Tuple of (clean_orgnr_10_digits, formatted_orgnr_with_hyphen)
        """
        orgnr_clean = orgnr.replace("-", "").replace(" ", "")

        # Handle 12-digit personnummer format (YYYYMMDDNNNN)
        if len(orgnr_clean) == 12:
            # Keep as-is for personnummer
            return orgnr_clean, orgnr_clean

        # Standard 10-digit format
        if len(orgnr_clean) == 10:
            formatted = f"{orgnr_clean[:6]}-{orgnr_clean[6:]}"
            return orgnr_clean, formatted

        # Already has hyphen in input - use as-is
        return orgnr_clean, orgnr

    def get_company(self, orgnr: str, _retry_count: int = 0) -> Optional[Dict[str, Any]]:
        """
        Get company information from Bolagsverket VDM API (sync).

        Args:
            orgnr: Organization number (with or without hyphen)
            _retry_count: Internal retry counter (do not set manually)

        Returns:
            Standardized company data dict or None if not found
        """
        orgnr_clean, orgnr_formatted = self._format_orgnr(orgnr)

        token = self._get_token_sync()
        if not token:
            logger.warning("No OAuth token available")
            return None

        start_time = time.perf_counter()

        try:
            response = requests.post(
                f"{self.api_base_url}/organisationer",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                json={"identitetsbeteckning": orgnr_formatted},
                timeout=30
            )

            # Handle 401 with retry
            if response.status_code == 401 and _retry_count < self.MAX_RETRIES:
                logger.warning(f"Got 401 for {orgnr}, refreshing token and retrying...")
                self._invalidate_token()
                return self.get_company(orgnr, _retry_count + 1)

            if response.status_code == 404:
                logger.info(f"Company not found: {orgnr}")
                return None

            response.raise_for_status()
            data = response.json()

            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.info(
                f"Fetched {orgnr} from Bolagsverket VDM",
                orgnr=orgnr,
                duration_ms=round(duration_ms, 2)
            )

            return self._parse_response(data, orgnr_clean)

        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP error for {orgnr}: {e}")
            return None
        except Exception as e:
            logger.error(f"Error fetching {orgnr}: {e}")
            return None

    def scrape_company(self, orgnr: str) -> Optional[Dict[str, Any]]:
        """Alias for get_company (interface compatibility)."""
        return self.get_company(orgnr)

    # =========================================================================
    # ASYNC API
    # =========================================================================

    async def get_company_async(self, orgnr: str, _retry_count: int = 0) -> Optional[Dict[str, Any]]:
        """
        Get company information from Bolagsverket VDM API (async).

        Args:
            orgnr: Organization number (with or without hyphen)
            _retry_count: Internal retry counter (do not set manually)

        Returns:
            Standardized company data dict or None if not found
        """
        orgnr_clean, orgnr_formatted = self._format_orgnr(orgnr)

        token = await self._get_token_async()
        if not token:
            return None

        start_time = time.perf_counter()

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_base_url}/organisationer",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    json={"identitetsbeteckning": orgnr_formatted},
                    timeout=30
                )

                # Handle 401 with retry
                if response.status_code == 401 and _retry_count < self.MAX_RETRIES:
                    logger.warning(f"Got 401 for {orgnr}, refreshing token and retrying...")
                    self._invalidate_token()
                    return await self.get_company_async(orgnr, _retry_count + 1)

                if response.status_code == 404:
                    return None

                response.raise_for_status()
                data = response.json()

                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.info(
                    f"Async fetched {orgnr} from Bolagsverket VDM",
                    orgnr=orgnr,
                    duration_ms=round(duration_ms, 2)
                )

                return self._parse_response(data, orgnr_clean)

        except Exception as e:
            logger.error(f"Async error fetching {orgnr}: {e}")
            return None

    async def scrape_company_async(self, orgnr: str) -> Optional[Dict[str, Any]]:
        """Alias for get_company_async (interface compatibility)."""
        return await self.get_company_async(orgnr)

    # =========================================================================
    # DOCUMENT LIST (Årsredovisningar)
    # =========================================================================

    def get_document_list(self, orgnr: str, _retry_count: int = 0) -> List[Dict]:
        """
        Get list of annual reports for a company (sync).

        Returns list of document metadata with dokumentId for download.
        """
        _, orgnr_formatted = self._format_orgnr(orgnr)

        token = self._get_token_sync()
        if not token:
            return []

        try:
            response = requests.post(
                f"{self.api_base_url}/dokumentlista",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                json={"identitetsbeteckning": orgnr_formatted},
                timeout=30
            )

            # Handle 401 with retry
            if response.status_code == 401 and _retry_count < self.MAX_RETRIES:
                logger.warning(f"Got 401 for document list {orgnr}, refreshing token...")
                self._invalidate_token()
                return self.get_document_list(orgnr, _retry_count + 1)

            if response.status_code != 200:
                return []

            data = response.json()
            return data.get("dokument", [])

        except Exception as e:
            logger.error(f"Error getting document list for {orgnr}: {e}")
            return []

    async def get_document_list_async(
        self, orgnr: str, _retry_count: int = 0, _429_retry_count: int = 0
    ) -> List[Dict]:
        """Get list of annual reports for a company (async)."""
        _, orgnr_formatted = self._format_orgnr(orgnr)

        token = await self._get_token_async()
        if not token:
            logger.warning(f"No OAuth token available for document list {orgnr}")
            return []

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.api_base_url}/dokumentlista",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json"
                    },
                    json={"identitetsbeteckning": orgnr_formatted},
                    timeout=30
                )

                # Handle 401 with retry (token refresh)
                if response.status_code == 401 and _retry_count < self.MAX_RETRIES:
                    logger.warning(f"Got 401 for document list {orgnr}, refreshing token...")
                    self._invalidate_token()
                    return await self.get_document_list_async(orgnr, _retry_count + 1, _429_retry_count)

                # Handle 429 with exponential backoff
                if response.status_code == 429 and _429_retry_count < self.MAX_429_RETRIES:
                    wait_time = self.BACKOFF_BASE_SECONDS * (2 ** _429_retry_count)
                    logger.warning(
                        f"Got 429 for document list {orgnr}, waiting {wait_time}s "
                        f"(retry {_429_retry_count + 1}/{self.MAX_429_RETRIES})"
                    )
                    await asyncio.sleep(wait_time)
                    return await self.get_document_list_async(orgnr, _retry_count, _429_retry_count + 1)

                if response.status_code == 429:
                    logger.error(f"429 rate limit exceeded for {orgnr} after {self.MAX_429_RETRIES} retries")
                    return []

                if response.status_code != 200:
                    logger.warning(f"Document list failed for {orgnr}: status={response.status_code}")
                    return []

                data = response.json()
                documents = data.get("dokument", [])
                logger.info(f"Found {len(documents)} documents for {orgnr}")
                return documents

        except Exception as e:
            logger.error(f"Async error getting document list for {orgnr}: {e}")
            return []

    # =========================================================================
    # DOCUMENT DOWNLOAD (Årsredovisningar - ZIP/XBRL)
    # =========================================================================

    def download_document(self, dokument_id: str, _retry_count: int = 0) -> Optional[bytes]:
        """
        Download annual report document as ZIP (sync).

        Args:
            dokument_id: Document ID from get_document_list

        Returns:
            ZIP file content as bytes, or None on failure
        """
        token = self._get_token_sync()
        if not token:
            return None

        try:
            response = requests.get(
                f"{self.api_base_url}/dokument/{dokument_id}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/zip"
                },
                timeout=60
            )

            # Handle 401 with retry
            if response.status_code == 401 and _retry_count < self.MAX_RETRIES:
                logger.warning(f"Got 401 for document {dokument_id}, refreshing token...")
                self._invalidate_token()
                return self.download_document(dokument_id, _retry_count + 1)

            if response.status_code != 200:
                logger.warning(f"Failed to download {dokument_id}: {response.status_code}")
                return None

            content = response.content

            # Verify it's a ZIP file (starts with PK)
            if not content.startswith(b'PK'):
                logger.warning(f"Downloaded content is not a ZIP: {dokument_id}")
                return None

            return content

        except Exception as e:
            logger.error(f"Error downloading document {dokument_id}: {e}")
            return None

    async def download_document_async(
        self, dokument_id: str, _retry_count: int = 0, _429_retry_count: int = 0
    ) -> Optional[bytes]:
        """
        Download annual report document as ZIP (async).

        Args:
            dokument_id: Document ID from get_document_list_async

        Returns:
            ZIP file content as bytes, or None on failure
        """
        token = await self._get_token_async()
        if not token:
            return None

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.api_base_url}/dokument/{dokument_id}",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/zip"
                    },
                    timeout=60
                )

                # Handle 401 with retry (token refresh)
                if response.status_code == 401 and _retry_count < self.MAX_RETRIES:
                    logger.warning(f"Got 401 for document {dokument_id}, refreshing token...")
                    self._invalidate_token()
                    return await self.download_document_async(dokument_id, _retry_count + 1, _429_retry_count)

                # Handle 429 with exponential backoff
                if response.status_code == 429 and _429_retry_count < self.MAX_429_RETRIES:
                    wait_time = self.BACKOFF_BASE_SECONDS * (2 ** _429_retry_count)
                    logger.warning(
                        f"Got 429 for document {dokument_id}, waiting {wait_time}s "
                        f"(retry {_429_retry_count + 1}/{self.MAX_429_RETRIES})"
                    )
                    await asyncio.sleep(wait_time)
                    return await self.download_document_async(dokument_id, _retry_count, _429_retry_count + 1)

                if response.status_code == 429:
                    logger.error(f"429 rate limit exceeded for document {dokument_id} after {self.MAX_429_RETRIES} retries")
                    return None

                if response.status_code != 200:
                    logger.warning(f"Failed to download {dokument_id}: {response.status_code}")
                    return None

                content = response.content

                # Verify it's a ZIP file (starts with PK)
                if not content.startswith(b'PK'):
                    logger.warning(f"Downloaded content is not a ZIP: {dokument_id}")
                    return None

                return content

        except Exception as e:
            logger.error(f"Async error downloading document {dokument_id}: {e}")
            return None

    # =========================================================================
    # DATA PARSING
    # =========================================================================

    def _parse_response(self, data: Dict, orgnr: str) -> Dict[str, Any]:
        """
        Parse Bolagsverket VDM response to standardized format.

        The API returns:
        {
            "organisationer": [{
                "organisationsidentitet": {...},
                "organisationsnamn": {...},
                "organisationsform": {...},
                "juridiskForm": {...},
                "postadressOrganisation": {...},
                "naringsgrenOrganisation": {...},
                "organisationsdatum": {...},
                "verksamOrganisation": {...},
                "verksamhetsbeskrivning": {...},
                ...
            }]
        }
        """
        orgs = data.get("organisationer", [])
        if not orgs:
            return None

        # Get first organization (usually only one)
        org = orgs[0]

        result = {
            "orgnr": orgnr
        }

        # Organization name
        namn_obj = org.get("organisationsnamn", {})
        namn_lista = namn_obj.get("organisationsnamnLista", [])
        if namn_lista:
            # Get primary name (FORETAGSNAMN)
            for namn in namn_lista:
                if namn.get("organisationsnamntyp", {}).get("kod") == "FORETAGSNAMN":
                    result["name"] = namn.get("namn")
                    break
            if "name" not in result and namn_lista:
                result["name"] = namn_lista[0].get("namn")

        # Organization form (AB, HB, etc.)
        org_form = org.get("organisationsform", {})
        if org_form and not org_form.get("fel"):
            result["company_type"] = org_form.get("klartext")
            # Note: company_type_code not in DB schema

        # Legal form (from SCB) - stored as purpose for now
        juridisk_form = org.get("juridiskForm", {})
        if juridisk_form and not juridisk_form.get("fel"):
            result["purpose"] = juridisk_form.get("klartext")
            # Note: legal_form_code not in DB schema

        # Status (active/inactive)
        verksam = org.get("verksamOrganisation", {})
        if verksam and not verksam.get("fel"):
            is_active = verksam.get("kod") == "JA"
            result["status"] = "ACTIVE" if is_active else "INACTIVE"

        # Deregistration info
        avreg = org.get("avregistreradOrganisation", {})
        if avreg and avreg.get("avregistreringsdatum"):
            result["status"] = "DEREGISTERED"
            # Note: deregistration_date not in DB schema

        # Note: avregistreringsorsak not in DB schema

        # Ongoing procedures (konkurs, likvidation, etc.) - update status only
        forfarande = org.get("pagaendeAvvecklingsEllerOmstruktureringsforfarande", {})
        if forfarande:
            lista = forfarande.get("pagaendeAvvecklingsEllerOmstruktureringsforfarandeLista", [])
            if lista:
                # Update status based on procedures
                codes = [p.get("kod") for p in lista]
                if "KK" in codes:
                    result["status"] = "BANKRUPTCY"
                elif "LI" in codes:
                    result["status"] = "LIQUIDATION"
                # Note: ongoing_procedures list not in DB schema

        # Registration date
        org_datum = org.get("organisationsdatum", {})
        if org_datum and not org_datum.get("fel"):
            result["registered_date"] = org_datum.get("registreringsdatum")
            # Note: scb_registered_date not in DB schema

        # Postal address
        postadress_obj = org.get("postadressOrganisation", {})
        if postadress_obj and not postadress_obj.get("fel"):
            postadress = postadress_obj.get("postadress", {})
            result["postal_street"] = postadress.get("utdelningsadress")
            result["postal_code"] = postadress.get("postnummer")
            result["postal_city"] = postadress.get("postort")
            # Note: postal_country, postal_co not in DB schema

        # SNI codes (industry classification)
        naringsgren = org.get("naringsgrenOrganisation", {})
        if naringsgren and not naringsgren.get("fel"):
            sni_list = naringsgren.get("sni", [])
            if sni_list:
                result["industries"] = []
                for i, sni in enumerate(sni_list):
                    result["industries"].append({
                        "sni_code": sni.get("kod"),
                        "sni_description": sni.get("klartext"),
                        "is_primary": 1 if i == 0 else 0,
                        "source": "bolagsverket_vdm"
                    })

        # Note: business_description (verksamhetsbeskrivning) not in DB schema
        # Note: ad_block (reklamspärr) not in DB schema

        return result

    # =========================================================================
    # HEALTH CHECK
    # =========================================================================

    def is_available(self) -> bool:
        """Check if API is available and credentials work (sync)."""
        if not self.is_configured:
            return False

        token = self._get_token_sync()
        if not token:
            return False

        try:
            response = requests.get(
                f"{self.api_base_url}/isalive",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )
            return response.status_code == 200 and response.text.strip() == "OK"
        except Exception:
            return False

    async def is_available_async(self) -> bool:
        """Check if API is available and credentials work (async)."""
        if not self.is_configured:
            return False

        token = await self._get_token_async()
        if not token:
            return False

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.api_base_url}/isalive",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10
                )
                return response.status_code == 200 and response.text.strip() == "OK"
        except Exception:
            return False


def get_bolagsverket_vdm_client(
    client_id: str = None,
    client_secret: str = None,
    environment: str = "production"
) -> BolagsverketVDMClient:
    """Factory function to create Bolagsverket VDM client."""
    return BolagsverketVDMClient(
        client_id=client_id,
        client_secret=client_secret,
        environment=environment
    )
