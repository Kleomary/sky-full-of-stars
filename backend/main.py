import asyncio
import os
from datetime import timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from backend.queue_manager import QueueFullError, sky_queue
from backend.schemas import SkyScreenshotRequest
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


# Временное изображение-заглушка (минимальный валидный PNG 1x1).
PNG_PLACEHOLDER = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
    "53de0000000c4944415408d763f8cfc000000301010018dd8db00000000049"
    "454e44ae426082"
)


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
        # Пока имитация работы Stellarium; заменится вызовом worker'а (шаг 4.4)
        if ARTIFICIAL_DELAY_SECONDS > 0:
            await asyncio.sleep(ARTIFICIAL_DELAY_SECONDS)

        return Response(
            content=PNG_PLACEHOLDER,
            media_type="image/png",
            headers={
                "Content-Disposition": 'inline; filename="sky.png"',
                "X-Sky-Utc-DateTime": utc_dt.isoformat(),
            },
        )
    finally:
        await sky_queue.release()
