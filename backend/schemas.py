from typing import Optional, Literal

from pydantic import BaseModel, Field


class SkyScreenshotRequest(BaseModel):
    """Тело запроса POST /api/sky-screenshot."""

    source: Literal["city", "coordinates"]
    cityId: Optional[str] = None
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    localDate: str  # формат ДД.ММ.ГГГГ (по разделу 7 ТЗ)
    localTime: str  # формат ЧЧ:ММ
    timeZone: str   # IANA-имя, например "Europe/Moscow"
    utcDateTime: Optional[str] = None  # ISO 8601, опционально
