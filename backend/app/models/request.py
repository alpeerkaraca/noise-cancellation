from pydantic import BaseModel
from typing import Optional, List, Dict


class NoiseRemoverRequest(BaseModel):

    input_path: str
    output_path: str
    noise_profile: Optional[str] = None
    remove_silence: bool = True
    remove_noise: bool = True
    remove_reverb: bool = False
