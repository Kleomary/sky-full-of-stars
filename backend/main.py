from datetime import timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from backend.schemas import SkyScreenshotRequest
from backend.validation import ValidationError, validate_request_params

app = FastAPI(
    title="A Sky Full of Stars API",
    description="Backend для генерации изображения звёздного неба",
    version="0.2.0",
)

# CORS: пока разрешаем и Codespaces-превью, и сам сайт на Render.
# На проде список сузим до фактического адреса фронтенда.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(ValidationError)
async def validation_error_handler(request: Request, exc: ValidationError):
    return JSONResponse(
        status_code=400,
        content={"status": "error", "code": exc.code, "message": exc.message},
    )


@app.get("/")
def root():
    return {
        "status": "ok",
        "service": "A Sky Full of Stars API",
        "message": "Backend работает",
    }


@app.get("/health")
def health():
    return {"status": "ok"}


# Временное изображение-заглушка (минимальный валидный PNG 1x1).
# Заменим на реальный рендеринг Stellarium на шаге 4.4.
PNG_PLACEHOLDER = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
    "53de0000000c4944415408d763f8cfc000000301010018dd8db00000000049"
    "454e44ae426082"
)


@app.post("/api/sky-screenshot")
def sky_screenshot(req: SkyScreenshotRequest):
    # Повторная валидация (раздел 13 ТЗ) — фронтенду доверять нельзя
    local_dt = validate_request_params(req.localDate, req.localTime, req.timeZone)
    utc_dt = local_dt.astimezone(timezone.utc)

    # Пока игнорируем координаты — они понадобятся на шаге 4.4
    return Response(
        content=PNG_PLACEHOLDER,
        media_type="image/png",
        headers={
            "Content-Disposition": 'inline; filename="sky.png"',
            "X-Sky-Utc-DateTime": utc_dt.isoformat(),
        },
    )
