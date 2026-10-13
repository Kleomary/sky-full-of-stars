import asyncio
from dataclasses import dataclass, field
from datetime import datetime

from backend import config


class QueueFullError(Exception):
    """Очередь переполнена -> 429 Too Many Requests."""


@dataclass
class QueueStats:
    running: int = 0
    waiting: int = 0
    max_queue_size: int = 0
    total_processed: int = 0
    total_rejected: int = 0
    last_started_at: datetime | None = None


class SkyQueue:
    """FIFO-очередь задач Stellarium.

    Одновременно выполняется только одна задача (раздел 13 ТЗ).
    Если ожидающих уже MAX_QUEUE_SIZE — новая задача отклоняется (429).
    """

    def __init__(self, max_queue_size: int = config.MAX_QUEUE_SIZE):
        self._max_queue_size = max_queue_size
        self._running = 0
        self._waiting = 0
        self._lock = asyncio.Lock()
        self.total_processed = 0
        self.total_rejected = 0
        self.last_started_at: datetime | None = None

    async def acquire(self) -> bool:
        """Занять слот. True — задача принята, False — ждать в очереди.

        Raises QueueFullError, если места в очереди нет.
        """
        async with self._lock:
            if self._running == 0:
                self._running = 1
                self.last_started_at = datetime.now()
                return True  # выполнится сразу
            if self._waiting >= self._max_queue_size:
                self.total_rejected += 1
                raise QueueFullError()
            self._waiting += 1
            return False  # встанет в очередь

    async def wait_turn(self):
        """Дождаться своего хода (вызывается после acquire() == False)."""
        # Пока — простая модель: задачи обрабатываются последовательно,
        # поэтому ждём освобождения единственного слота.
        while True:
            async with self._lock:
                if self._running == 0:
                    self._running = 1
                    self._waiting -= 1
                    self.last_started_at = datetime.now()
                    return
            await asyncio.sleep(0.1)

    async def release(self):
        """Освободить слот после завершения задачи."""
        async with self._lock:
            self._running = 0
            self.total_processed += 1

    def stats(self) -> QueueStats:
        return QueueStats(
            running=self._running,
            waiting=self._waiting,
            max_queue_size=self._max_queue_size,
            total_processed=self.total_processed,
            total_rejected=self.total_rejected,
            last_started_at=self.last_started_at,
        )


# Единственный экземпляр на всё приложение
sky_queue = SkyQueue()
