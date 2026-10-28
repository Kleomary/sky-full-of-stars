# Передаточный документ: проект «Звёздное небо» — чат 3 → чат 4

Статус на 14.10.2026: **ПРОЕКТ В СПЯЩЕМ РЕЖИМЕ** (см. секцию «Спящий режим»).
Репозиторий: `Kleomary/sky-full-of-stars`, frontend в корне репо (app.js, index.html, styles.css, cities.json — НЕ в frontend/).

## Архитектура (без изменений от чата 1)

фронт → backend FastAPI (Render: sky-full-of-stars-api, статика a-sky-full-of-stars.onrender.com) → relay (Render: sky-relay) → агент на Mac (**/Users/user/bin/agent.py** — постоянный путь, НЕ /tmp) → Stellarium **26.3** → снимок 1920×1080 в `/Users/user/stellarium-output/`.

## Что сделано в чате 3 (всё проверено на живой системе)

1. **launchd-плейлисты сверены** (хвост чата 2 закрыт):
   - `com.sky.agent.plist`: `/usr/bin/python3 /Users/user/bin/agent.py`, env `RELAY_WS=wss://sky-relay.onrender.com/agent`, `SCREENSHOT_OUTPUT_DIR=/Users/user/stellarium-output`, KeepAlive+RunAtLoad=true. Скрипт живёт на ПОСТОЯННОМ пути (переживает ребут; `/tmp/agent.py` — устаревшая информация чата 2).
   - `com.sky.stellarium.plist`: `open -a Stellarium`, RunAtLoad=true, без KeepAlive (правильно: ручное закрытие не перезапускается).
2. **Найдена и устранена причина падения launchd-агента (exit 1)**: системному `/usr/bin/python3` не хватало модулей `httpx` и `websockets`. Ручной экземпляр из `/tmp` (запущен `nohup env RELAY_WS=... python3 /tmp/agent.py`, conda-питон) маскировал проблему. Фикс: `/usr/bin/python3 -m pip install --user httpx websockets` → `launchctl kickstart` → агент работает под launchd из `~/bin/agent.py` (PID живой, путь подтверждён в ps).
3. **Диагностика чёрных/битых кадров**: серия из 6 генераций показала ПРОГРЕВ рендера — файл появляется каждый раз (транспорт надёжен), качество растёт к 5–6-й попытке. Дисплей/сон Mac ни при чём (снимки приходят и при залоченном Mac). Stellarium не рестартовал (старт 13.10 23:56), в `~/Library/Logs/DiagnosticReports/` отчётов о падениях Stellarium нет.
4. **Правка пауз в `build_sky_script` (backend/stellarium_client.py): `core.wait(3)`→`core.wait(10)`, `core.wait(1)`→`core.wait(3)` — НА ПОЛПУТИ**: внесена в рабочую копию Codespaces, НЕ закоммичена, НЕ запушена, НЕ задеплоена. Render работает со старыми паузами (3/1). Серия 11:17–11:20 тестировала СТАРУЮ версию (все 6 кадров плохие) — для оценки фикса недействительна.
5. Проект переведён в спящий режим (см. ниже). Бюджет таймаутов посчитан: худший случай «спящий relay ~50 с + рендер ~15–18 с» ≈ 65–70 с — внутри `SKY_API_TIMEOUT_MS=90000`, фронт не трогать.

## Спящий режим (как уснул, 14.10.2026)

- launchd: оба джоба выгружены (`launchctl bootout`) и заблокированы (`launchctl disable`): `com.sky.agent`, `com.sky.stellarium`. Плейлисты остались на месте в `~/Library/LaunchAgents/` — удалять их не нужно.
- Stellarium закрыт (`osascript quit` вернул -128 «Отменено пользователем», но ps подтвердил: процесса нет). Агент не запущен.
- Codespace остановлен (github.com/codespaces → Stop).
- Render не трогали: free-план засыпает сам; сайт остаётся доступным, первый запрос просыпается ~50 с.
- Конфиги не тронуты: пароль в `config.ini` [RemoteControl] на Mac, `STELLARIUM_API_PASSWORD` на Render.
- Чистка `~/stellarium-output`: `t*.png`, `diag*.png` удалены. **Остались** (диагностический мусор чата 2): `asis001.png, cur1001.png, cur2001.png, fovtest001.png, lbl1001–lbl1005.png, lbl2001.png` — убрать при пробуждении (команда ниже).

## Пробуждение (выполнять по порядку)

1. **Mac — включить launchd-джобы:**
   ```bash
   launchctl enable gui/$(id -u)/com.sky.agent
   launchctl enable gui/$(id -u)/com.sky.stellarium
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sky.agent.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sky.stellarium.plist
   open -a Stellarium
   ```
   Проверка: `launchctl list | grep sky` → оба джоба с PID; `ps aux | grep agent.py | grep -v grep` → путь `/Users/user/bin/agent.py`.
2. **Убрать диагностический мусор** (архив, не удаление):
   ```bash
   cd ~/stellarium-output && mkdir -p _archive
   mv asis001.png cur1001.png cur2001.png fovtest001.png lbl1001.png lbl1002.png lbl1003.png lbl1004.png lbl1005.png lbl2001.png _archive/
   ```
3. **Доделать висящий коммит пауз**: в Codespaces проверить, что в `build_sky_script` стоят `core.wait(10)` и `core.wait(3)` (рабочая копия могла быть откачена — при пробуждении сначала `git diff` и `grep -n core.wait backend/stellarium_client.py`; если откатилась — внести заново) → commit `Increase render waits in sky script (fix partial renders)` → push → Render: дождаться «Deploy live».
4. **Ретест**: серия из 6 генераций с одного устройства, фиксировать каждый кадр. Ключевой — кадр №1. Если №1 всё ещё чёрный → следующий эшелон: прогревочный кадр в `agent.py` (первый снимок после простоя отбрасывается) + добавить логирование в `/tmp/agent.log` (закрывает хвост «пустой лог мешал диагностике»).
5. **Дальше по очередности остатка**: rate limiting (раздел 16 ТЗ) → e2e-сценарии 1–16 (раздел 17) → обновление документации (`docs/technical-specification.md`: Stellarium 24.4→26.3, туннели→relay, факты ниже) → чистка мёртвых .ssc-функций в app.js (buildSsc, buildFileName).

## Критичные факты (не потерять!)

- **Stellarium 26.3 (НЕ 24.4!)**: Basic Auth требует ПУСТОЕ имя пользователя — backend делает `self._auth = ("", password)` в `backend/stellarium_client.py`; с `user:` — 401.
- **«ok» от POST /api/scripts/direct НЕ доказательство** — ответ приходит до выполнения; проверять появлением файла: `ls ~/stellarium-output/`.
- `LandscapeMgr.setFlagCardinalsPoints(...)` в 26.3 не существует и молча роняет весь скрипт.
- Stellarium дописывает счётчик `(001)` к имени снимка → агент матчит `glob(prefix + "*.png")`.
- Пароль: `config.ini` секция [RemoteControl] (~строки 42–45) — править ТОЛЬКО при закрытом Stellarium; дубль — `STELLARIUM_API_PASSWORD` на Render.
- **Новые python-зависимости агента ставить только так**: `/usr/bin/python3 -m pip install --user <pkg>` — launchd использует системный питон, conda-окружение ему недоступно.
- relay/backend на free-плане просыпаются до ~50 с; фронтовой таймаут `SKY_API_TIMEOUT_MS=90000` в app.js.
- Диагностика руками: `curl -u ":$P" --data-urlencode 'code=...' https://sky-relay.onrender.com/stellarium/api/scripts/direct` + появление файла в `~/stellarium-output/`. Агент глух к 404; `/tmp/agent.log` пуст (логирование не добавлено).
- Подписи звёзд/планет/метеорных потоков на снимке ПРИСУТСТВУЮТ — решение «фиксируем как есть» (подтверждено пользователем).
