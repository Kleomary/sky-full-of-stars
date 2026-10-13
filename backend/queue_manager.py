import asyncio
from dataclasses import dataclass
from datetime import datetime

from backend import config


class QueueFullError(Exception):
    """Система занята (running + waiting >= MAX_QUEUE_SIZE) -> 429."""


@dataclass
class QueueStats:
    running: int
    waiting: int
    max_queue_size: int
    total_processed: int
    total_rejected: int
    last_started_at: datetime | None


class SkyQueue:
    """FIFO-очередь задач Stellarium.

    Семантика по разделам 13/17/19 ТЗ: MAX_QUEUE_SIZE — общее число задач
    в системе (выполняющаяся + ожидающие). 4-я одновременная задача -> 429.
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
        """Записаться в очередь. Всегда False — слот берётся в wait_turn().

        Raises QueueFullError, если задач в системе уже MAX_QUEUE_SIZE.
        """
        async with self._lock:
            total = self._running + self._waiting
            if total >= self._max_queue_size:
                self.total_rejected += 1
                raise QueueFullError()
            self._waiting += 1
            return False

    async def wait_turn(self):
        """Дождаться своего хода и занять единственный слот выполнения."""
        while True:
            async with self._lock:
                if self._running == 0:
                    self._running = 1
                    self._waiting -= 1
                    self.last_started_at = datetime.now()
                    return
            await asyncio.sleep(0.05)

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
