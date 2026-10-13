# Эксперименты с Stellarium RemoteControl API (версия 24.4)

Проверено в Codespaces (Xvfb, software rendering), октябрь 2026.

## Подтверждённые факты

1. Плагин RemoteControl встроен в бинарник (не отдельный .so).
2. Ключи секции [RemoteControl] в config.ini (из исходников v24.4):
   - `autostart` (по умолчанию false, "for security reason") — ОБЯЗАТЕЛЕН true
   - `use_password` (НЕ require_password!)
   - `password`, `port` (8090), `enable_cors`, `cors_origin`
   - Ключ `enable_at_startup` из старой документации игнорируется.
   - Включение плагина: секция [plugins_load_at_startup], ключ `RemoteControl = true`.
3. Авторизация: HTTP Basic, пустой пользователь, пароль в поле. Без пароля — 401.
4. Endpoints:
   - GET /api/main/status — статус
   - GET /api/scripts/list, GET /api/scripts/status
   - POST /api/scripts/direct?code=... — выполнение кода напрямую (ключевое)
   - POST /api/scripts/stop
5. direct возвращает "ok" сразу; выполнение асинхронное, статус через GET status.
   Если скрипт уже выполняется — "error: a script is already running".
6. Скриншот: core.screenshot('имя', false). Каталог — ключ screenshot_dir
   в секции [main]. Автонумерация: {имя}001.png, {имя}002.png...
7. Stellarium перезаписывает config.ini при выходе — править только при
   остановленном процессе.
8. Рабочие команды сценария (проверены по отдельности):
   core.setObserverLocation(долгота, широта, 0, 0, "имя", "Earth") — долгота ПЕРВАЯ
   core.setDate("YYYY-MM-DDTHH:MM:SS", "utc")
   LandscapeMgr.setFlagAtmosphere(true)
   MilkyWay.setFlagShow(true)   — НЕ LandscapeMgr.setFlagMilkyWay
   SolarSystem.setFlagPlanets(true)  — отдельного флага Луны в 24.4 нет
   ConstellationMgr.setFlagLabels(false)  — НЕ setFlagNames
   StelMovementMgr.lookSouth()  — НЕ core.setView
   StelMovementMgr.zoomTo(180, 0)  — НЕ core.zoomTo (не экспонирован)
9. Размер снимка = размеру окна: screen_w/screen_h в config.ini
   (1920x1080 подтверждено), fullscreen = false.
10. Рендеринг под Xvfb работает без GPU; e2e через HTTP-эндпоинт
    возвращает PNG 1920x1080 (~200-700 КБ).
