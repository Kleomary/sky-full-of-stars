from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MIN_DATE = date(1, 1, 1)


class ValidationError(Exception):
    """Ошибка валидации с кодом и понятным сообщением на русском."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def parse_local_date(raw: str) -> date:
    """Дата в формате ДД.ММ.ГГГГ, не раньше 01.01.0000."""
    try:
        d = datetime.strptime(raw, "%d.%m.%Y").date()
    except ValueError:
        raise ValidationError(
            "INVALID_DATE",
            "Дата должна быть в формате ДД.ММ.ГГГГ и существовать в календаре",
        )
    if d < MIN_DATE:
        raise ValidationError("INVALID_DATE", "Дата раньше минимальной 01.01.0000")
    return d


def parse_local_time(raw: str):
    """Время в формате ЧЧ:ММ, 24-часовой формат."""
    try:
        return datetime.strptime(raw, "%H:%M").time()
    except ValueError:
        raise ValidationError("INVALID_TIME", "Время должно быть в формате ЧЧ:ММ")


def resolve_timezone(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, KeyError, ValueError):
        raise ValidationError("INVALID_TIMEZONE", "Некорректный часовой пояс")


def validate_not_in_future(d: date, t, tz: ZoneInfo) -> datetime:
    """Запрещает будущие даты и время позже текущего для сегодняшней даты.

    Возвращает локальное datetime с учётом пояса.
    """
    local_dt = datetime.combine(d, t, tzinfo=tz)
    now_local = datetime.now(tz)

    if local_dt > now_local:
        if d == now_local.date():
            raise ValidationError("TIME_IN_FUTURE", "Время не может быть позже текущего")
        raise ValidationError("DATE_IN_FUTURE", "Дата не может быть в будущем")
    return local_dt


def validate_request_params(localDate: str, localTime: str, timeZone: str) -> datetime:
    """Полный цикл валидации даты/времени/пояса. Возвращает локальное datetime."""
    d = parse_local_date(localDate)
    t = parse_local_time(localTime)
    tz = resolve_timezone(timeZone)
    return validate_not_in_future(d, t, tz)
