"""
Konfiguration för Bevakningsverktyget
"""

from typing import Optional, List
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator


class Settings(BaseSettings):
    """Applikationsinställningar"""

    # API
    app_name: str = "Bevakningsverktyg"
    app_version: str = "0.1.0"
    debug: bool = False

    # CORS - säkerhetsinställning
    allowed_origins: List[str] = Field(
        default=["http://localhost:3000"],
        description="Kommaseparerad lista över tillåtna CORS-origins"
    )

    # Supabase (optional - för persistent lagring)
    supabase_url: Optional[str] = None
    supabase_key: Optional[str] = None

    # DI.se credentials (obligatorisk om DI-scraper används)
    di_email: Optional[str] = Field(default=None, alias="DI_EMAIL")
    di_password: Optional[str] = Field(default=None, alias="DI_PASSWORD")

    # 3D Secure (för kortbetalningar)
    secure_3d_password: Optional[str] = Field(default=None, alias="SECURE_3D_PASSWORD")

    # Resend API (för e-posthantering)
    resend_api_key: Optional[str] = Field(default=None, alias="RESEND_API_KEY")

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
    companies_path_override: Optional[str] = Field(
        default=None,
        description="Överskriv path till företagslista (om inte i projektrot)"
    )

    @field_validator('allowed_origins', mode='before')
    @classmethod
    def parse_allowed_origins(cls, v):
        """Parsar kommaseparerad sträng till lista"""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(',') if origin.strip()]
        return v

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        populate_by_name = True


settings = Settings()
