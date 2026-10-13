"""Client for the Stellarium RemoteControl API (tested on 24.4,
see docs/stellarium-remotecontrol-experiments.md)."""
import asyncio
import glob
import os
import time
import uuid
from datetime import datetime

import httpx

from backend import config


class StellariumError(Exception):
    """Stellarium interaction error (user-friendly Russian message)."""


def build_sky_script(latitude, longitude, utc_dt):
    """Scene code per section 14 of the spec.

    Note: setObserverLocation expects (longitude, latitude) - in that order.
    """
    parts = [
        'core.setObserverLocation(%s, %s, 0, 0, "sky-user", "Earth")' % (longitude, latitude),
        'core.setDate("%s", "utc")' % utc_dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "LandscapeMgr.setFlagAtmosphere(true)",
        "MilkyWay.setFlagShow(true)",
        "SolarSystem.setFlagPlanets(true)",
        "ConstellationMgr.setFlagLabels(false)",
        "core.setGuiVisible(false)",
        "LandscapeMgr.setFlagCardinalsPoints(false)",
        "StelMovementMgr.lookSouth()",
        "StelMovementMgr.zoomTo(180, 0)",
        "core.wait(0.5)",
    ]
    return "; ".join(parts)


class StellariumClient:
    def __init__(self, base_url, password, output_dir, timeout_seconds=None):
        self._base_url = base_url.rstrip("/")
        self._auth = ("", password)
        self._output_dir = output_dir
        self._timeout = timeout_seconds or config.STELLARIUM_REQUEST_TIMEOUT_SECONDS

    async def check_available(self):
        """Availability check; raises StellariumError (spec scenarios 13-14)."""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(
                    self._base_url + "/api/main/status", auth=self._auth
                )
            if r.status_code == 401:
                raise StellariumError("Неверный пароль Stellarium API")
            r.raise_for_status()
        except StellariumError:
            raise
        except httpx.HTTPError as e:
            raise StellariumError(
                "Сервис рендеринга недоступен, попробуйте повторить запрос позже"
            ) from e

    async def render_sky(self, latitude, longitude, utc_dt):
        """Send the script, wait for the PNG, return image bytes."""
        await self.check_available()

        prefix = "sky-" + uuid.uuid4().hex[:12]
        code = build_sky_script(latitude, longitude, utc_dt)
        code += "; core.screenshot('" + prefix + "', false)"

        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                self._base_url + "/api/scripts/direct",
                auth=self._auth,
                data={"code": code},
            )
            if r.status_code != 200:
                raise StellariumError("Stellarium отклонил сценарий")
            body = r.text.strip()
            if "already running" in body:
                raise StellariumError(
                    "Сервис рендеринга занят, попробуйте повторить позже"
                )

        data = await self._fetch_png_via_agent(prefix)
        return data

    async def _fetch_png_via_agent(self, prefix: str) -> bytes:
        """Опросить каталог снимков через агент (путь /stellarium-file) и забрать PNG."""
        import time as _time
        deadline = _time.monotonic() + self._timeout
        async with httpx.AsyncClient(timeout=10) as client:
            while _time.monotonic() < deadline:
                r = await client.get(
                    f"{self._base_url}/file",
                    params={"prefix": prefix},
                    auth=self._auth,
                )
                if r.status_code == 200:
                    return r.content
                await asyncio.sleep(0.5)
        raise StellariumError("Не удалось получить изображение за отведённое время")


# Single application-wide instance
stellarium_client = StellariumClient(
    base_url=config.STELLARIUM_API_URL,
    password=os.environ.get("STELLARIUM_API_PASSWORD", ""),
    output_dir=os.environ.get("SCREENSHOT_OUTPUT_DIR", "/tmp/stellarium-output"),
)
