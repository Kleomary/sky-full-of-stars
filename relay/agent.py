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
