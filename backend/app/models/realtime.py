from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any


class RealtimeInitialConfig(BaseModel):
    sampleRate: int = Field(
        ..., gt=0, description="İstemcinin kullandığı örnekleme hızı (Hz)"
    )


class RealtimeProcessingParams(BaseModel):
    humFrequenciesStr: Optional[str] = Field(
        None,
        description="Uğultu frekansları (virgülle ayrılmış string). Örn: '60,120,180'",
    )
    humBandwidthHz: Optional[float] = Field(
        None, ge=0, description="Uğultu bant genişliği (Hz)."
    )
    humAttenuationFactor: Optional[float] = Field(
        None,
        ge=0,
        le=1,
        description="Uğultu zayıflatma faktörü (0=tamamen kaldır, 1=dokunma).",
    )

    spectralGateThresholdFactor: Optional[float] = Field(
        None, ge=0.1, description="Spektral kapı eşik faktörü."
    )
    noiseAttenuationFactor: Optional[float] = Field(
        None, ge=0, le=1, description="Genel gürültü zayıflatma faktörü."
    )

    frameSize: Optional[int] = Field(
        None,
        ge=256,
        description="STFT için çerçeve (FFT) boyutu (n_fft). 2'nin kuvveti olması önerilir.",
    )
    hopLengthDivisor: Optional[int] = Field(
        None,
        ge=1,
        description="Hop uzunluğu böleni (hop_length = frameSize / hopLengthDivisor).",
    )

    @field_validator("frameSize")
    def frame_size_power_of_two(cls, v):
        if v is not None and (v & (v - 1) != 0):
            print(
                f"Uyarı: frameSize ({v}) 2'nin bir kuvveti değil. Performans etkilenebilir."
            )
        return v
