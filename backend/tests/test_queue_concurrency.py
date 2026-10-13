"""Сценарии 11-12 из раздела 17 ТЗ: одновременные запросы и очередь."""
import asyncio

import httpx
import pytest

from backend import main as backend_main
from backend.queue_manager import SkyQueue


@pytest.fixture
def fresh_queue(monkeypatch):
    """Чистая очередь (лимит 3) и задержка обработки 0.3 с на каждый тест."""
    q = SkyQueue(max_queue_size=3)
    monkeypatch.setattr(backend_main, "sky_queue", q)
    monkeypatch.setattr(backend_main, "ARTIFICIAL_DELAY_SECONDS", 0.3)
    return q


def _make_payload() -> dict:
    return {
        "source": "city",
        "latitude": 56.858398,
        "longitude": 35.910746,
        "localDate": "01.01.2024",
        "localTime": "22:00",
        "timeZone": "Europe/Moscow",
    }


async def _run_concurrent(n: int) -> list[int]:
    """Запустить n POST-запросов одновременно и вернуть их статусы."""
    transport = httpx.ASGITransport(app=backend_main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        async def one() -> int:
            r = await client.post("/api/sky-screenshot", json=_make_payload())
            return r.status_code

        return list(await asyncio.gather(*(one() for _ in range(n))))


def test_two_concurrent_both_ok(fresh_queue):
    """Сценарий 11: два одновременных запроса — оба успешны."""
    statuses = asyncio.run(_run_concurrent(2))
    assert sorted(statuses) == [200, 200]


def test_four_concurrent_three_ok_one_429(fresh_queue):
    """Сценарий 12: четыре одновременных запроса — 3 проходят, 4-й получает 429."""
    statuses = asyncio.run(_run_concurrent(4))
    assert sorted(statuses) == [200, 200, 200, 429]


def test_429_body_has_friendly_message(fresh_queue):
    """Тело 429 содержит понятное сообщение (без технических деталей)."""
    transport = httpx.ASGITransport(app=backend_main.app)
    async def flow():
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            async def one():
                return await client.post("/api/sky-screenshot", json=_make_payload())
            responses = await asyncio.gather(*(one() for _ in range(4)))
        rejected = [r for r in responses if r.status_code == 429]
        assert len(rejected) == 1
        body = rejected[0].json()
        assert body["code"] == "QUEUE_FULL"
        assert "попробуйте" in body["message"].lower()

    asyncio.run(flow())


def test_queue_stats_after_processing(fresh_queue):
    """После 2 успешных задач статистика отражает обработку."""
    asyncio.run(_run_concurrent(2))
    s = fresh_queue.stats()
    assert s.total_processed == 2
    assert s.total_rejected == 0
    assert s.running == 0
    assert s.waiting == 0
