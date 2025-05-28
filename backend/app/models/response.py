from typing import Optional
from pydantic import BaseModel


class NoiseRemoverResponse(BaseModel):
    status: str
    message: str
    input_file: Optional[str] = None
    output_file: Optional[str] = None
    plot_urls: Optional[dict[str, str]] = None
    processed_audio_url: Optional[str] = None
    session_id: Optional[str] = None
