from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # GCP Settings
    gcp_project_id: str = "bedini-answer-bot"
    gcp_location: str = "us-central1"

    # Cloud Storage
    gcs_bucket: str = "spencer-knowledge-vault"
    transcripts_prefix: str = "transcripts"
    documents_prefix: str = "documents"

    # Vertex AI Search
    datastore_id: str = "spencer-transcripts"

    # YouTube Channel
    youtube_channel_handle: str = "@MadscienceLPTECH"
    youtube_channel_name: str = "Limitless Potential Technologies"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
