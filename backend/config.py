import os


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# Адрес локального Stellarium через туннель (шаг 4.4)
STELLARIUM_API_URL = os.environ.get("STELLARIUM_API_URL", "")

# Таймауты и очередь (раздел 13 ТЗ)
STELLARIUM_REQUEST_TIMEOUT_SECONDS = _int_env("STELLARIUM_REQUEST_TIMEOUT_SECONDS", 25)
USER_REQUEST_TIMEOUT_SECONDS = _int_env("USER_REQUEST_TIMEOUT_SECONDS", 30)
MAX_QUEUE_SIZE = _int_env("MAX_QUEUE_SIZE", 3)

# Параметры изображения (раздел 1 ТЗ)
SCREENSHOT_WIDTH = _int_env("SCREENSHOT_WIDTH", 1920)
SCREENSHOT_HEIGHT = _int_env("SCREENSHOT_HEIGHT", 1080)

# CORS: через запятую, напр. "https://site.onrender.com,https://other.example"
_cors_raw = os.environ.get(
    "CORS_ALLOWED_ORIGIN",
    "https://a-sky-full-of-stars.onrender.com",
)
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip()]
