from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = "sk-placeholder"
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

    anthropic_api_key: str = "sk-ant-placeholder"
    anthropic_model: str = "claude-3-5-haiku-20241022"
    anthropic_base_url: str = "https://api.anthropic.com/v1"

    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = True

    database_url: str = "sqlite:///./openclaw.db"

    # JWT / Auth
    auth_enabled: bool = False
    jwt_secret_key: str = "CHANGE-ME-to-a-random-secret-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    log_level: str = "INFO"
    max_short_term_memory: int = 10

    # OAuth — Google
    google_client_id: str = ""
    google_client_secret: str = ""
    google_oauth_enabled: bool = False

    # Base URL of the app as seen by end-users (used to build OAuth redirect_uri)
    # In dev: http://localhost:3000 (Vite dev server, which proxies /api to backend)
    # In prod: set to your actual domain, e.g. https://app.example.com
    app_base_url: str = "http://localhost:3000"

    serpapi_key: str = ""
    serpapi_enabled: bool = True

    tavily_api_key: str = ""
    tavily_enabled: bool = True

    crawleo_api_key: str = ""
    crawleo_enabled: bool = True

    baidu_ai_search_api_key: str = ""
    baidu_ai_search_api_keys: str = ""
    baidu_ai_search_enabled: bool = True
    baidu_ai_search_model: str = "ernie-4.5-turbo-32k"

    amap_api_key: str = ""
    amap_enabled: bool = True

    # Search strategy: "serpapi_first" (default), "tavily_first", "all" (legacy triple-source)
    search_strategy: str = "serpapi_first"
    # Max concurrent LLM agent calls (avoid 429 from provider)
    agent_concurrency: int = 1
    # Max concurrent day-batch generation calls in ItineraryAgent
    itinerary_day_concurrency: int = 2

    @property
    def llm_config(self) -> dict:
        return {
            "config_list": [
                {
                    "model": self.openai_model,
                    "api_key": self.openai_api_key,
                    "base_url": self.openai_base_url,
                }
            ],
            "temperature": 0.3,
            "timeout": 120,
        }


@lru_cache()
def get_settings() -> Settings:
    return Settings()
