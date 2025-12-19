"""
Konfiguration för Bevakningsverktyget
"""

from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Applikationsinställningar"""

    # API
    app_name: str = "Bevakningsverktyg"
    app_version: str = "0.1.0"
    debug: bool = False

    # Supabase (optional - för persistent lagring)
    supabase_url: Optional[str] = None
    supabase_key: Optional[str] = None

    # NopeCHA
    nopecha_api_key: Optional[str] = None
    nopecha_extension_path: Optional[str] = None

    # Browser
    headless: bool = True
    chrome_path: Optional[str] = None

    # Scheduler
    check_interval_minutes: int = Field(default=60, ge=5)

    # Paths
    companies_file: str = "companies.json"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
