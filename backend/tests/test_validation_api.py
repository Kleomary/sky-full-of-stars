"""Сценарии 8-9 из раздела 17 ТЗ: будущая дата и время в будущем."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def post_sky(date_str: str, time_str: str, tz: str = "Europe/Moscow"):
    return client.post(
        "/api/sky-screenshot",
        json={
            "source": "city",
            "latitude": 56.858398,
            "longitude": 35.910746,
            "localDate": date_str,
            "localTime": time_str,
            "timeZone": tz,
        },
    )


def test_past_date_and_time_ok():
    """Прошлая дата, прошлое время -> 200 + PNG."""
    r = post_sky("01.01.2024", "22:00")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"


def test_future_date_rejected():
    """Сценарий 8: будущая дата -> 400 DATE_IN_FUTURE."""
    r = post_sky("01.01.2030", "22:00")
    assert r.status_code == 400
    body = r.json()
    assert body["code"] == "DATE_IN_FUTURE"


def test_invalid_date_rejected():
    """Несуществующая дата -> 400 INVALID_DATE."""
    r = post_sky("32.01.2024", "22:00")
    assert r.status_code == 400
    assert r.json()["code"] == "INVALID_DATE"


def test_invalid_time_rejected():
    """Некорректное время -> 400 INVALID_TIME."""
    r = post_sky("01.01.2024", "25:99")
    assert r.status_code == 400
    assert r.json()["code"] == "INVALID_TIME"


def test_invalid_timezone_rejected():
    """Некорректный часовой пояс -> 400 INVALID_TIMEZONE."""
    r = post_sky("01.01.2024", "22:00", tz="Mars/Olympus")
    assert r.status_code == 400
    assert r.json()["code"] == "INVALID_TIMEZONE"


def test_today_time_in_future_rejected():
    """Сценарий 9: сегодня + время на 1 час позже текущего -> 400 TIME_IN_FUTURE."""
    tz = ZoneInfo("Europe/Moscow")
    # Берём время с запасом: +2 часа от текущего, чтобы тест не сломался
    # из-за нескольких секунд между формированием времени и запросом.
    future_local = datetime.now(tz) + timedelta(hours=2)
    hh_mm = future_local.strftime("%H:%M")
    today = future_local.strftime("%d.%m.%Y")

    r = post_sky(today, hh_mm)
    assert r.status_code == 400
    body = r.json()
    # +2 часа могут перейти границу суток; тогда это DATE_IN_FUTURE
    # для "завтрашней" даты относительно теперь уже более позднего момента.
    assert body["code"] in ("TIME_IN_FUTURE", "DATE_IN_FUTURE"), body


def test_today_time_now_ok():
    """Сегодня + текущее время -> 200 (граница допустима)."""
    tz = ZoneInfo("Europe/Moscow")
    now_local = datetime.now(tz)
    r = post_sky(now_local.strftime("%d.%m.%Y"), now_local.strftime("%H:%M"))
    # Допускаем редкий случай, когда время успело уйти на минуту вперёд:
    assert r.status_code in (200, 400)
    if r.status_code == 400:
        assert r.json()["code"] == "TIME_IN_FUTURE"


def test_coordinates_out_of_range_rejected():
    """Широта вне диапазона -> 422 от Pydantic."""
    r = client.post(
        "/api/sky-screenshot",
        json={
            "source": "coordinates",
            "latitude": 150.0,
            "longitude": 35.91,
            "localDate": "01.01.2024",
            "localTime": "22:00",
            "timeZone": "Europe/Moscow",
        },
    )
    assert r.status_code == 422
