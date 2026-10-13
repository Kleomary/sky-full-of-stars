import asyncio
import os
from datetime import timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from backend.queue_manager import QueueFullError, sky_queue
from backend.schemas import SkyScreenshotRequest
from backend.stellarium_client import StellariumError, stellarium_client
from backend.validation import ValidationError, validate_request_params

app = FastAPI(
    title="A Sky Full of Stars API",
    description="Backend для генерации изображения звёздного неба",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Искусственная задержка имитации рендеринга (сек).
# Нужна только для проверки очереди и автотестов.
# Обнуляется/удаляется при подключении реального Stellarium.
ARTIFICIAL_DELAY_SECONDS = float(os.environ.get("ARTIFICIAL_DELAY_SECONDS", "0"))


@app.exception_handler(ValidationError)
async def validation_error_handler(request: Request, exc: ValidationError):
    return JSONResponse(
        status_code=400,
        content={"status": "error", "code": exc.code, "message": exc.message},
    )


@app.exception_handler(StellariumError)
async def stellarium_error_handler(request: Request, exc: StellariumError):
    return JSONResponse(
        status_code=503,
        content={"status": "error", "code": "RENDER_UNAVAILABLE", "message": str(exc)},
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


@app.get("/api/queue/stats")
def queue_stats():
    s = sky_queue.stats()
    return {
        "running": s.running,
        "waiting": s.waiting,
        "maxQueueSize": s.max_queue_size,
        "totalProcessed": s.total_processed,
        "totalRejected": s.total_rejected,
    }




@app.post("/api/sky-screenshot")
async def sky_screenshot(req: SkyScreenshotRequest):
    # Повторная валидация (раздел 13 ТЗ)
    local_dt = validate_request_params(req.localDate, req.localTime, req.timeZone)
    utc_dt = local_dt.astimezone(timezone.utc)

    # Очередь: одна задача одновременно, лимит системы — MAX_QUEUE_SIZE
    try:
        await sky_queue.acquire()
    except QueueFullError:
        return JSONResponse(
            status_code=429,
            content={
                "status": "error",
                "code": "QUEUE_FULL",
                "message": "Сервер занят, попробуйте повторить запрос через минуту",
            },
        )

    await sky_queue.wait_turn()
    try:
        # Реальный рендеринг через Stellarium RemoteControl (проверено в Codespaces)
        data = await stellarium_client.render_sky(req.latitude, req.longitude, utc_dt)
        return Response(
            content=data,
            media_type="image/png",
            headers={"Content-Disposition": 'inline; filename="sky.png"'},
        )
    finally:
        await sky_queue.release()
