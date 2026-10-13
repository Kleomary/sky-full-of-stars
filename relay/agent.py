"""Агент на Mac: держит WebSocket к relay и исполняет запросы к Stellarium.

Запуск: RELAY_WS=wss://<relay>.onrender.com/agent python3 agent.py
"""
import asyncio
import base64
import json
import os

import httpx
import websockets

RELAY_WS = os.environ["RELAY_WS"]
STELLARIUM = os.environ.get("STELLARIUM_URL", "http://localhost:8090")


async def handle(ws, msg):
    req_id = msg.get("id", "")
    # Спец-маршрут: выдать PNG из каталога снимков Mac и удалить его
    if msg.get("path") == "/__fetch_screenshot__":
        prefix = (msg.get("headers") or {}).get("x-prefix", "")
        out_dir = os.environ.get("SCREENSHOT_OUTPUT_DIR",
                                 os.path.expanduser("~/stellarium-output"))
        import glob as _glob
        matches = sorted(_glob.glob(os.path.join(out_dir, prefix + "*.png")))
        if matches:
            with open(matches[0], "rb") as f:
                data = f.read()
            os.remove(matches[0])  # ТЗ: временный файл удаляется
            await ws.send(json.dumps({"id": req_id, "status": 200,
                "headers": {"content-type": "image/png"},
                "body_b64": base64.b64encode(data).decode()}))
        else:
            await ws.send(json.dumps({"id": req_id, "status": 404,
                "headers": {"content-type": "application/json"},
                "body_b64": base64.b64encode(b'{"not_found":true}').decode()}))
        return
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            # QtWebApp (Stellarium) требует имя заголовка Authorization
            # в точном регистре; relay/HTTP может отдавать его в любом.
            hdrs = {}
            for k, v in (msg.get("headers") or {}).items():
                if k.lower() == "authorization":
                    hdrs["Authorization"] = v
                elif k.lower() == "content-type":
                    hdrs["Content-Type"] = v
                else:
                    hdrs[k] = v
            r = await client.request(
                msg.get("method", "GET"),
                STELLARIUM + msg.get("path", "/"),
                headers=hdrs,
                content=base64.b64decode(msg.get("body", "")) or None,
            )
            await ws.send(json.dumps({
                "id": req_id,
                "status": r.status_code,
                "headers": dict(r.headers),
                "body_b64": base64.b64encode(r.content).decode(),
            }))
    except Exception as e:
        try:
            await ws.send(json.dumps({
                "id": req_id,
                "status": 502,
                "headers": {"content-type": "text/plain"},
                "body_b64": base64.b64encode(f"agent error: {e}".encode()).decode(),
            }))
        except Exception:
            pass


async def main():
    while True:
        try:
            async with websockets.connect(RELAY_WS) as ws:
                print("connected to relay")
                async for raw in ws:
                    asyncio.create_task(handle(ws, json.loads(raw)))
        except Exception as e:
            print("reconnecting:", e)
        await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(main())
