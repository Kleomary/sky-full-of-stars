"""Общие фикстуры: подменяем реальный клиент Stellarium заглушкой,
чтобы автотесты не зависели от запущенного Stellarium."""
import asyncio

import pytest

from backend import main as backend_main


class FakeStellariumClient:
    """Возвращает фиксированный PNG, имитируя время рендеринга задержкой.
    Задержка нужна тестам очереди: без неё запросы не пересекаются."""

    PNG = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
        "53de0000000c4944415408d763f8cfc000000301010018dd8db00000000049"
        "454e44ae426082"
    )

    async def render_sky(self, latitude, longitude, utc_dt):
        await asyncio.sleep(0.3)
        return self.PNG


@pytest.fixture(autouse=True)
def fake_stellarium_client(monkeypatch):
    monkeypatch.setattr(
        backend_main, "stellarium_client", FakeStellariumClient()
    )
