"""Relay: пересылает HTTP-запросы backend -> WebSocket-агент на Mac.

Схема: backend зовёт GET/POST /stellarium/api/..., relay сериализует запрос
в JSON-сообщение в WS-соединение агента, агент выполняет его против
localhost:8090 и возвращает ответ. Тело ответа — base64 (PNG бинарный).
"""
import asyncio
import base64
import uuid

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response

app = FastAPI(title="Sky Relay")

AGENT_TIMEOUT_SECONDS = 30


class Connection:
    def __init__(self):
        self.ws = None
        self.pending: dict = {}


conn: Connection | None = None


@app.get("/health")
async def health():
    return {"status": "ok", "agent_connected": conn is not None}


@app.websocket("/agent")
async def agent_endpoint(ws: WebSocket):
    global conn
    await ws.accept()
    c = Connection()
    c.ws = ws
    conn = c
    print("agent connected")
    try:
        while True:
            msg = await ws.receive_json()
            fut = c.pending.pop(msg.get("id"), None)
            if fut and not fut.done():
                fut.set_result(msg)
    except WebSocketDisconnect:
        pass
    finally:
        if conn is c:
            conn = None
        for fut in c.pending.values():
            if not fut.done():
                fut.cancel()
        print("agent disconnected")


@app.get("/stellarium/file")  # base_url клиента уже содержит /stellarium
async def fetch_file(request: Request):
    """Отдать PNG из каталога снимков Mac: агент ищет по префиксу и удаляет после чтения."""
    if conn is None or conn.ws is None:
        return JSONResponse(status_code=503, content={"error": "no agent"})
    prefix = request.query_params.get("prefix", "")
    if not prefix or not prefix.replace("-", "").isalnum():
        return JSONResponse(status_code=400, content={"error": "bad prefix"})
    req_id = uuid.uuid4().hex
    fut = asyncio.get_running_loop().create_future()
    conn.pending[req_id] = fut
    payload = {"id": req_id, "method": "GET", "path": "/__fetch_screenshot__",
               "headers": {"x-prefix": prefix}, "body": ""}
    try:
        await conn.ws.send_json(payload)
        resp = await asyncio.wait_for(fut, timeout=AGENT_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        return JSONResponse(status_code=504, content={"error": "agent timeout"})
    content = base64.b64decode(resp.get("body_b64", ""))
    if resp.get("status") != 200:
        return JSONResponse(status_code=resp.get("status", 502), content={"error": "not found"})
    return Response(content=content, media_type="image/png")
@app.api_route("/stellarium/{path:path}", methods=["GET", "POST", "PUT", "HEAD", "OPTIONS"])
async def proxy(path: str, request: Request):
    if conn is None or conn.ws is None:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "code": "RENDER_UNAVAILABLE",
                     "message": "Сервис рендеринга недоступен, попробуйте повторить запрос позже"},
        )
    req_id = uuid.uuid4().hex
    body_bytes = await request.body()
    payload = {
        "id": req_id,
        "method": request.method,
        "path": "/" + path,
        "headers": {k: v for k, v in request.headers.items()
                    if k.lower() in ("authorization", "content-type")},
        "body": base64.b64encode(body_bytes).decode() if body_bytes else "",
    }
    fut = asyncio.get_running_loop().create_future()
    conn.pending[req_id] = fut
    try:
        await conn.ws.send_json(payload)
        resp = await asyncio.wait_for(fut, timeout=AGENT_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        conn.pending.pop(req_id, None)
        return JSONResponse(
            status_code=504,
            content={"status": "error", "code": "RENDER_TIMEOUT",
                     "message": "Сервис рендеринга не ответил вовремя, попробуйте повторить"},
        )
    except asyncio.CancelledError:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "code": "RENDER_UNAVAILABLE",
                     "message": "Сервис рендеринга недоступен, попробуйте повторить позже"},
        )
    content = base64.b64decode(resp.get("body_b64", ""))
    headers = resp.get("headers", {})
    media_type = headers.get("content-type", "application/octet-stream")
    return Response(content=content, status_code=resp.get("status", 502), media_type=media_type)


