import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
load_dotenv(env_path, override=True)

class Settings(BaseSettings):
    SUPABASE_URL: str = "https://tczrxkmdhbsfbjxzlvav.supabase.co"
    SUPABASE_ANON_KEY: str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjenJ4a21kaGJzZmJqeHpsdmF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5NzU0ODUsImV4cCI6MjEwMDU1MTQ4NX0.Gxb7KsxtkRI8pBx_v1mOS0hP0d-cTIJ_bROJXOcmTnc"
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk3NTQ4NSwiZXhwIjoyMTAwNTUxNDg1fQ.3G5TECkLuCCq2JluYYZZW36hwK-K-7DkcneU87i7zwk"
    SUPABASE_JWT_SECRET: Optional[str] = "gYjop+/HGNc/YEMBpwT55Yo8KhD7r98rE4x/IrEFM1zM7c+oLme+m5rxlqtCtcIin9scHqn18SClrCsAX2WSHg=="
    ENVIRONMENT: str = "development"
    PORT: int = 8000

    model_config = SettingsConfigDict(
        env_file=env_path,
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
