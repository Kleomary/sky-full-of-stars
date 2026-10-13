/* Звёздное небо — этап 1 (статическая страница, генерация .ssc для Stellarium). */
"use strict";

/* ================== Константы ================== */

var CITIES_URL = "cities.json";
var SKY_API_URL = "https://sky-full-of-stars-api.onrender.com/api/sky-screenshot";
var SKY_API_TIMEOUT_MS = 90000;
var CUSTOM_OPTION = "__custom__";
var YANDEX_MAPS_URL = "https://yandex.ru/maps";

var MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];

var MSG = {
  placeEmpty: "Укажите место наблюдения",
  placeUnrecognized: "Не удалось распознать координаты. Вставьте координаты в формате 56.858398, 35.910746 или ссылку Яндекс Карт",
  dateInvalid: "Введите дату в формате ДД.ММ.ГГГГ",
  dateNotReal: "Такой даты не существует в григорианском календаре",
  dateFuture: "Дата не может быть в будущем",
  timeInvalid: "Введите время в формате ЧЧ:ММ",
  timeFuture: "Время не может быть позже текущего",
  citiesLoadError: "Не удалось загрузить список городов. Обновите страницу."
};

/* ================== Состояние ================== */

var CITIES = [];
var state = {
  mode: "city",                 // "city" | "custom"
  city: null,                   // объект города из справочника
  coords: null,                 // {lat, lon} для режима координат
  lastFile: null,
  lastPngUrl: null,
  lastSlug: null,
  lastFileBase: null                // {name, text} последнего .ssc
};

var el = {};

/* ================== Чистая логика (доступна для тестов через window.SkyService) ================== */

function roundCoord(v) {
  return Math.round(v * 1e6) / 1e6;
}

function coordToString(v) {
  return String(parseFloat(v.toFixed(6)));
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

function matchParam(str, name) {
  var m = str.match(new RegExp("[?&]" + name + "=([^&]+)"));
  return m ? m[1] : null;
}

var NUM = "-?\\d{1,3}(?:\\.\\d+)?";

/**
 * Распознавание места: десятичные координаты, ссылки Яндекс Карт (ll=, pt=),
 * ссылки Google Maps (@lat,lon; !3d!4d; q=/query=).
 * Порядок координат: «56.858398, 35.910746» — широта, долгота;
 * в параметрах ll/pt Яндекс Карт — долгота, широта.
 */
function parsePlace(input) {
  var raw = (input == null ? "" : String(input)).trim();
  if (!raw) return { ok: false, reason: "empty" };
  var s = decodeSafe(raw);

  function check(lat, lon) {
    lat = Number(lat); lon = Number(lon);
    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { ok: false, reason: "range" };
    }
    return { ok: true, lat: roundCoord(lat), lon: roundCoord(lon) };
  }

  // 1) Яндекс Карты: pt=долгота,широта (при наличии pt используем его)
  // 2) Яндекс Карты: ll=долгота,широта
  if (/yandex/i.test(s)) {
    var pt = matchParam(s, "pt");
    var ll = matchParam(s, "ll");
    var pair = pt || ll;
    if (pair) {
      var m = decodeSafe(pair).split("~")[0].match("^(" + NUM + ")[,;\\s]+(" + NUM + ")");
      if (m) return check(m[2], m[1]); // меняем порядок: долгота,широта -> широта,долгота
    }
    return { ok: false, reason: "unrecognized" };
  }

  // 3) Google Maps: метка !3dширота !4dдолгота (порядок токенов в ссылках бывает любым)
  var g3 = s.match(new RegExp("!3d(" + NUM + ")"));
  var g4 = s.match(new RegExp("!4d(" + NUM + ")"));
  if (g3 && g4) return check(g3[1], g4[1]);

  // 4) Google Maps: @широта,долгота
  var g = s.match(new RegExp("@(" + NUM + "),(" + NUM + ")"));
  if (g) return check(g[1], g[2]);

  // 5) Google Maps: q= или query= с широтой,долготой
  var q = matchParam(s, "query") || matchParam(s, "q");
  if (q) {
    var qm = decodeSafe(q).match("^(" + NUM + ")[,;\\s]+(" + NUM + ")$");
    if (qm) return check(qm[1], qm[2]);
  }

  // 6) Координаты в формате «широта, долгота»
  var p = s.match(new RegExp("^(" + NUM + ")\\s*[,;]\\s*(" + NUM + ")$"));
  if (p) return check(p[1], p[2]);

  return { ok: false, reason: "unrecognized" };
}

/** Дата ДД.ММ.ГГГГ; проверяется существование в пролептическом григорианском календаре. */
function parseDateStr(str) {
  var m = String(str == null ? "" : str).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  var d = +m[1], mo = +m[2], y = +m[3];
  if (mo < 1 || mo > 12) return null;
  var dt = new Date(Date.UTC(2000, mo - 1, d, 12, 0, 0));
  dt.setUTCFullYear(y); // корректно поддерживает год 0000
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1 || dt.getUTCFullYear() !== y) return null;
  return { d: d, mo: mo, y: y };
}

/** Время ЧЧ:ММ, 24-часовой формат. */
function parseTimeStr(str) {
  var m = String(str == null ? "" : str).trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  var h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return { h: h, mi: mi };
}

function todayParts() {
  var now = new Date();
  return { d: now.getDate(), mo: now.getMonth() + 1, y: now.getFullYear(), h: now.getHours(), mi: now.getMinutes() };
}

function cmpDate(a, b) {
  return (a.y - b.y) || (a.mo - b.mo) || (a.d - b.d);
}

/** Локальные дата/время (как если бы они были UTC) в миллисекунды; поддерживает год 0000. */
function wallAsUtcMs(y, mo, d, h, mi) {
  var dt = new Date(Date.UTC(2000, mo - 1, d, h, mi, 0));
  dt.setUTCFullYear(y);
  return dt.getTime();
}

var formatterCache = {};
function tzParts(ms, tz) {
  var fmt = formatterCache[tz];
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    });
    formatterCache[tz] = fmt;
  }
  var parts = fmt.formatToParts(new Date(ms));
  var out = {};
  for (var i = 0; i < parts.length; i++) out[parts[i].type] = parts[i].value;
  return {
    y: parseInt(out.year, 10), mo: parseInt(out.month, 10), d: parseInt(out.day, 10),
    h: parseInt(out.hour, 10) % 24, mi: parseInt(out.minute, 10)
  };
}

function tzOffsetMs(ms, tz) {
  var p = tzParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0) - ms;
}

/**
 * Местное время -> UTC.
 * tzInfo: {kind:"iana", tz, lon} для городов справочника
 *         {kind:"fixed", offsetMin} для произвольных координат (пояс оценён по долготе).
 * Для года < 1000 (если Intl не справляется) используется местное среднее время по долготе.
 */
function localToUtcMs(y, mo, d, h, mi, tzInfo) {
  var wall = wallAsUtcMs(y, mo, d, h, mi);
  if (tzInfo.kind === "fixed") return wall - tzInfo.offsetMin * 60000;

  function lmt() {
    return wall - Math.round(tzInfo.lon * 4) * 60000;
  }
  try {
    var probes = [wall, wall - 12 * 3600e3, wall + 12 * 3600e3];
    var fallback = null;
    for (var i = 0; i < probes.length; i++) {
      var utc = wall - tzOffsetMs(probes[i], tzInfo.tz);
      var p = tzParts(utc, tzInfo.tz);
      if (p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi) return utc;
      if (i === 0) fallback = utc;
    }
    if (y < 1000) return lmt();          // Intl дал сбой на древней дате
    return fallback;                      // несуществующее локальное время (переход часов)
  } catch (e) {
    return lmt();
  }
}

function formatOffset(min) {
  var sign = min < 0 ? "-" : "+";
  var a = Math.abs(min);
  var h = Math.floor(a / 60), m = a % 60;
  return "UTC" + sign + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function pad(n, len) {
  var neg = n < 0;
  var s = String(Math.abs(n)).padStart(len || 2, "0");
  return (neg ? "-" : "") + s;
}

function utcPartsOf(ms) {
  var dt = new Date(ms);
  return {
    y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
    h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds()
  };
}

/**
 * Построение .ssc-сценария для Stellarium.
 * params: {placeName, lat, lon, date:{d,mo,y}, time:{h,mi}, utcMs, tzLabel}
 */
function buildSsc(params) {
  var u = utcPartsOf(params.utcMs);
  var utcIso = pad(u.y, 4) + "-" + pad(u.mo) + "-" + pad(u.d) + "T" +
    pad(u.h) + ":" + pad(u.mi) + ":" + pad(u.s);
  var jd = (params.utcMs / 86400000 + 2440587.5).toFixed(6);
  var local = pad(params.date.d) + "." + pad(params.date.mo) + "." + pad(params.date.y, 4) +
    " " + pad(params.time.h) + ":" + pad(params.time.mi);
  var baseName = buildFileName(params.slug, params.date, params.time).replace(/\.ssc$/, "");

  var dateCmd;
  if (u.y >= 1) {
    dateCmd = 'core.setDate("' + utcIso + '", "utc");';
  } else {
    // QDateTime в некоторых сборках не принимает год 0000 в ISO-строке — задаём юлианскую дату
    // (в актуальном Stellarium метод называется setJDay; старое имя setJDate больше не существует)
    dateCmd = 'core.setJDay(' + jd + '); // ' + utcIso + ' UTC';
  }

  return [
    "//",
    '// Name: Карта звёздного неба — ' + params.placeName + ", " + local,
    "// Description: Панорама южной стороны неба (взгляд на юг, FOV 180).",
    "// Место: " + params.placeName + " (" + coordToString(params.lat) + ", " + coordToString(params.lon) + ").",
    "// Местное время: " + local + " (" + params.tzLabel + ") = " + utcIso + " UTC, JD " + jd,
    '// Author: Сервис «Звёздное небо»',
    "// Version: 1.0",
    "// License: MIT",
    "//",
    "",
    "// ----- Наблюдатель: долгота " + coordToString(params.lon) + ", широта " +
      coordToString(params.lat) + ", высота 30 м (порядок аргументов Stellarium: долгота, широта) -----",
    'core.setObserverLocation(' + coordToString(params.lon) + ", " + coordToString(params.lat) +
      ', 30, 0, "' + params.placeName.replace(/"/g, "'") + '", "Earth");',
    "",
    "// ----- Дата и время UTC: " + utcIso + " -----",
    dateCmd,
    "",
    "// ----- Оформление: атмосфера, Млечный Путь, Луна и планеты — вкл; названия созвездий — выкл -----",
    "try { LandscapeMgr.setFlagAtmosphere(true); } catch (e) {}",
    "try { MilkyWay.setFlagShow(true); } catch (e) {}",
    "try { SolarSystem.setFlagPlanets(true); } catch (e) {} // планеты и Луна — единый флаг SolarSystem",
    "try { ConstellationMgr.setFlagLabels(false); } catch (e) {}",
    "",
    "// ----- Взгляд на юг (азимут 180), на 30° выше горизонта; FOV 180° -----",
    'try { core.setProjectionMode("ProjectionStereographic"); } catch (e) {} // стереографическая проекция показывает все 180°',
    "core.moveToAltAzi(30, 180, 1);",
    "try { StelMovementMgr.zoomTo(180, 1); } catch (e) {}",
    "core.wait(2);",
    "",
    "// ----- Сохранение PNG (размер снимка равен размеру окна) -----",
    "// Разверните окно Stellarium на весь экран и нажмите Ctrl+S (в macOS — Cmd+S).",
    "// Либо снимите комментарий со следующей строки (перезапишет существующий файл):",
    '// core.screenshot("' + baseName + '", false, "", true);',
    ""
  ].join("\n");
}

/** Имя файла: sky-{city-or-coordinates}-{YYYY-MM-DD}-{HH-MM}.ssc */
function buildFileName(slug, date, time) {
  return "sky-" + slug + "-" + pad(date.y, 4) + "-" + pad(date.mo) + "-" + pad(date.d) +
    "-" + pad(time.h) + "-" + pad(time.mi) + ".ssc";
}

function coordsSlug(lat, lon) {
  return (coordToString(lat) + "_" + coordToString(lon)).replace(/-/g, "m");
}

/* ================== DOM ================== */

function $(id) { return document.getElementById(id); }

function initDomRefs() {
  el = {
    form: $("sky-form"),
    citySelect: $("place-city"),
    cityPill: $("place-city-pill"),
    customPill: $("place-custom-pill"),
    coordsInput: $("place-coords"),
    placeExtra: $("place-extra"),
    btnYandex: $("btn-yandex"),
    btnBackCity: $("btn-back-city"),
    placeHint: $("place-hint"),
    placeError: $("place-error"),
    dateInput: $("date-input"),
    dateError: $("date-error"),
    timeInput: $("time-input"),
    timeError: $("time-error"),
    btnShow: $("btn-show"),
    result: $("result"),
    resultFile: $("result-file"),
    resultSummary: $("result-summary"),
    skyImage: $("sky-image"),
  downloadPng: $("btn-download-png"),
    notifications: $("notifications"),
    metaDate: $("meta-date"),
    metaPlace: $("meta-place"),
    metaCoords: $("meta-coords"),
    skyCircle: document.querySelector(".sky__circle"),
    skyCanvas: $("sky-canvas"),
    bgCanvas: $("bg-stars")
  };
}

/* ================== Вспомогательное UI ================== */

function notify(message, type, timeout) {
  if (!el.notifications) return;
  var n = document.createElement("div");
  n.className = "notification" + (type ? " notification--" + type : "");
  n.textContent = message;
  el.notifications.appendChild(n);
  setTimeout(function () {
    n.classList.add("notification--hidden");
    setTimeout(function () { n.remove(); }, 450);
  }, timeout || 5000);
}

function setError(pill, errorEl, message) {
  if (message) {
    pill.classList.add("invalid");
    errorEl.textContent = message;
    errorEl.hidden = false;
  } else {
    pill.classList.remove("invalid");
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
}

function currentTzInfo() {
  if (state.mode === "city" && state.city) {
    return { kind: "iana", tz: state.city.tz, lon: state.city.lon };
  }
  if (state.coords) {
    var h = Math.max(-12, Math.min(14, Math.round(state.coords.lon / 15)));
    return { kind: "fixed", offsetMin: h * 60 };
  }
  return null;
}

function tzLabelFor(utcMs) {
  var info = currentTzInfo();
  if (!info) return "";
  if (info.kind === "fixed") return formatOffset(info.offsetMin) + " (по долготе, приблизительно)";
  return formatOffset(Math.round(tzOffsetMs(utcMs, info.tz) / 60000)) + " (" + info.tz + ")";
}

/* ================== Мета-блок под кругом ================== */

function updateMeta() {
  var dp = parseDateStr(el.dateInput.value);
  el.metaDate.textContent = dp
    ? dp.d + " " + MONTHS_GENITIVE[dp.mo - 1] + " " + pad(dp.y, 4)
    : "—";

  if (state.mode === "city" && state.city) {
    el.metaPlace.textContent = state.city.name;
    el.metaCoords.textContent = formatDegree(state.city.lat, "N", "S") + ", " +
      formatDegree(state.city.lon, "E", "W");
  } else if (state.coords) {
    el.metaPlace.textContent = "Место по координатам";
    el.metaCoords.textContent = formatDegree(state.coords.lat, "N", "S") + ", " +
      formatDegree(state.coords.lon, "E", "W");
  } else {
    el.metaPlace.textContent = "Укажите место";
    el.metaCoords.textContent = "—";
  }
}

function formatDegree(v, pos, neg) {
  return coordToString(v) + "° " + (v >= 0 ? pos : neg);
}

function updatePlaceHint() {
  if (state.mode === "city" && state.city) {
    var utc = localToUtcMs(2026, 1, 1, 12, 0, { kind: "iana", tz: state.city.tz, lon: state.city.lon });
    el.placeHint.textContent = coordToString(state.city.lat) + ", " + coordToString(state.city.lon) +
      " · " + tzLabelFor(utc);
  } else if (state.coords) {
    el.placeHint.textContent = "Широта " + coordToString(state.coords.lat) +
      ", долгота " + coordToString(state.coords.lon) + " · UTC" +
      formatOffset(Math.max(-12, Math.min(14, Math.round(state.coords.lon / 15))) * 60) +
      " (пояс оценён по долготе)";
  } else {
    el.placeHint.textContent = "Вставьте координаты вида 56.858398, 35.910746 или ссылку Яндекс/Google Карт";
  }
}

/* ================== Режимы поля «Место» ================== */

function switchMode(mode) {
  state.mode = mode;
  var custom = mode === "custom";
  el.cityPill.classList.toggle("hidden", custom);
  el.customPill.classList.toggle("hidden", !custom);
  el.placeExtra.classList.toggle("hidden", !custom);
  if (custom) {
    state.city = null;
    el.coordsInput.focus();
  } else {
    state.coords = null;
    var slug = el.citySelect.value;
    state.city = CITIES.find(function (c) { return c.slug === slug; }) || null;
  }
  setError(el.customPill, el.placeError, null);
  setError(el.cityPill, el.placeError, null);
  updatePlaceHint();
  updateMeta();
}

function onCityChange() {
  if (el.citySelect.value === CUSTOM_OPTION) {
    switchMode("custom");
    return;
  }
  state.city = CITIES.find(function (c) { return c.slug === el.citySelect.value; }) || null;
  setError(el.cityPill, el.placeError, null);
  updatePlaceHint();
  updateMeta();
}

function tryParseCoordsInput(replaceValue) {
  var res = parsePlace(el.coordsInput.value);
  if (res.ok) {
    state.coords = { lat: res.lat, lon: res.lon };
    if (replaceValue !== false) {
      el.coordsInput.value = coordToString(res.lat) + ", " + coordToString(res.lon);
    }
    setError(el.customPill, el.placeError, null);
  } else {
    state.coords = null;
  }
  updatePlaceHint();
  updateMeta();
  return res;
}

/* ================== Маски ввода ================== */

function maskDate() {
  var v = el.dateInput.value.replace(/\D/g, "").slice(0, 8);
  if (v.length > 2) v = v.slice(0, 2) + "." + v.slice(2);
  if (v.length > 5) v = v.slice(0, 5) + "." + v.slice(5);
  el.dateInput.value = v;
  setError(el.dateInput.closest(".pill"), el.dateError, null);
  updateMeta();
}

function maskTime() {
  var v = el.timeInput.value.replace(/\D/g, "").slice(0, 4);
  if (v.length > 2) v = v.slice(0, 2) + ":" + v.slice(2);
  el.timeInput.value = v;
  setError(el.timeInput.closest(".pill"), el.timeError, null);
}

/* ================== Валидация ================== */

function validatePlace() {
  if (state.mode === "city") {
    if (!state.city) return MSG.placeEmpty;
    return null;
  }
  var raw = el.coordsInput.value.trim();
  if (!raw) return MSG.placeEmpty;
  var res = parsePlace(raw);
  if (!res.ok) return MSG.placeUnrecognized;
  state.coords = { lat: res.lat, lon: res.lon };
  return null;
}

function validateDate() {
  var dp = parseDateStr(el.dateInput.value);
  if (!dp) return MSG.dateInvalid;
  // parseDateStr уже отвергает несуществующие даты, различаем сообщения
  var m = el.dateInput.value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return MSG.dateInvalid;
  var probe = new Date(Date.UTC(2000, +m[2] - 1, +m[1], 12));
  probe.setUTCFullYear(+m[3]);
  if (probe.getUTCDate() !== +m[1] || probe.getUTCMonth() !== +m[2] - 1 || probe.getUTCFullYear() !== +m[3]) {
    return MSG.dateNotReal;
  }
  if (cmpDate(dp, todayParts()) > 0) return MSG.dateFuture;
  return null;
}

function validateTime(dateParts) {
  var tp = parseTimeStr(el.timeInput.value);
  if (!tp) return MSG.timeInvalid;
  var today = todayParts();
  if (dateParts && cmpDate(dateParts, today) === 0) {
    if (tp.h * 60 + tp.mi > today.h * 60 + today.mi) return MSG.timeFuture;
  }
  return null;
}

/* ================== Отправка формы ================== */

function onSubmit(evt) {
  evt.preventDefault();

  var placeErr, dateErr, timeErr;
  var dp = parseDateStr(el.dateInput.value);

  placeErr = validatePlace();
  dateErr = validateDate();
  timeErr = validateTime(dp);

  setError(el.mode === "custom" ? el.customPill : el.cityPill, el.placeError, placeErr);
  setError(el.dateInput.closest(".pill"), el.dateError, dateErr);
  setError(el.timeInput.closest(".pill"), el.timeError, timeErr);

  if (placeErr || dateErr || timeErr) {
    var first = placeErr ? (state.mode === "custom" ? el.coordsInput : el.citySelect)
      : dateErr ? el.dateInput : el.timeInput;
    first.focus();
    return;
  }

  var tp = parseTimeStr(el.timeInput.value);
  var lat, lon, placeName, slug;

  if (state.mode === "city") {
    lat = state.city.lat; lon = state.city.lon;
    placeName = state.city.name; slug = state.city.slug;
  } else {
    var parsed = parsePlace(el.coordsInput.value);
    lat = parsed.lat; lon = parsed.lon;
    placeName = "Наблюдатель " + coordToString(lat) + ", " + coordToString(lon);
    slug = coordsSlug(lat, lon);
  }

  var utcMs = localToUtcMs(dp.y, dp.mo, dp.d, tp.h, tp.mi, currentTzInfo());
  var tzLabel = tzLabelFor(utcMs);

  var req = {
    source: state.mode === "city" ? "city" : "coordinates",
    cityId: state.mode === "city" && state.city ? state.city.slug : null,
    latitude: lat,
    longitude: lon,
    localDate: pad(dp.d) + "." + pad(dp.mo) + "." + pad(dp.y, 4),
    localTime: pad(tp.h) + ":" + pad(tp.mi),
    timeZone: getTimeZoneIana()
  };

  showResult({ placeName: placeName, lat: lat, lon: lon, date: dp, time: tp, utcMs: utcMs, tzLabel: tzLabel });

  state.lastSlug = slug;
  state.lastFileBase = "sky-" + slug + "-" + pad(dp.y, 4) + "-" + pad(dp.mo) + "-" + pad(dp.d) +
    "-" + pad(tp.h) + "-" + pad(tp.mi);

  requestSky(req);

}

function showResult(r) {
  var u = utcPartsOf(r.utcMs);
  el.resultSummary.innerHTML = "";
  var rows = [
    ["Место", r.placeName],
    ["Координаты", coordToString(r.lat) + ", " + coordToString(r.lon)],
    ["Местное время", pad(r.date.d) + "." + pad(r.date.mo) + "." + pad(r.date.y, 4) + " " +
      pad(r.time.h) + ":" + pad(r.time.mi) + " (" + r.tzLabel + ")"],
    ["UTC", pad(u.y, 4) + "-" + pad(u.mo) + "-" + pad(u.d) + " " + pad(u.h) + ":" + pad(u.mi) + ":" + pad(u.s)]
  ];
  rows.forEach(function (row) {
    var dt = document.createElement("dt");
    dt.textContent = row[0];
    var dd = document.createElement("dd");
    dd.textContent = row[1];
    el.resultSummary.appendChild(dt);
    el.resultSummary.appendChild(dd);
  });
  el.result.hidden = false;
}

/* ================== Запрос к API рендеринга ================== */

function getTimeZoneIana() {
  var info = currentTzInfo();
  if (!info) return "Etc/GMT-0";
  if (info.kind === "iana") return info.tz;
  var h = Math.round(info.offsetMin / 60);
  if (h === 0) return "Etc/GMT-0";
  return "Etc/GMT" + (h > 0 ? "-" + h : "+" + (-h));
}

function setSubmitBusy(busy) {
  var btn = el.form.querySelector('button[type="submit"]');
  if (btn) {
    btn.disabled = busy;
    btn.textContent = busy ? "Рендерим небо… ждите" : "Показать небо";
  }
}

function requestSky(req) {
  setSubmitBusy(true);
  notify("Рендерим небо… первый запрос после паузы может занять до минуты", "success");

  var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, SKY_API_TIMEOUT_MS) : null;

  fetch(SKY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: ctrl ? ctrl.signal : undefined
  })
    .then(function (res) {
      if (res.status === 200) {
        return res.blob().then(function (b) { showSkyImage(b); });
      }
      return res.json().catch(function () { return null; })
        .then(function (body) { handleApiError(res.status, body); });
    })
    .catch(function () {
      notify("Сервер не ответил за отведённое время или недоступен. Попробуйте повторить запрос позже.", "error");
    })
    .finally(function () {
      if (timer) clearTimeout(timer);
      setSubmitBusy(false);
    });
}

function handleApiError(status, body) {
  if (body && body.message) { notify(body.message, "error"); return; }
  if (status === 400 || status === 422) {
    notify("Проверьте правильность даты, времени и координат.", "error");
  } else if (status === 429) {
    notify("Сервер занят: в очереди уже максимум запросов. Повторите примерно через минуту.", "error");
  } else if (status === 503) {
    notify("Сервис рендеринга сейчас недоступен. Попробуйте позже.", "error");
  } else {
    notify("Не удалось получить изображение (код " + status + "). Попробуйте позже.", "error");
  }
}

function showSkyImage(blob) {
  if (state.lastPngUrl) URL.revokeObjectURL(state.lastPngUrl);
  state.lastPngUrl = URL.createObjectURL(blob);

  el.skyImage.src = state.lastPngUrl;
  el.skyImage.hidden = false;
  el.downloadPng.hidden = false;
  el.downloadPng.onclick = function () {
    var a = document.createElement("a");
    a.href = state.lastPngUrl;
    a.download = (state.lastFileBase || "sky") + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  notify("Снимок неба готов", "success");
  el.skyImage.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function downloadFile(name, text) {
  var blob = new Blob([text], { type: "application/octet-stream" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

/* ================== Геолокация ================== */

function requestGeolocation() {
  if (!("geolocation" in navigator)) {
    notify("Геолокация не поддерживается — выбран город Москва");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      var lat = roundCoord(pos.coords.latitude);
      var lon = roundCoord(pos.coords.longitude);
      var near = null, best = Infinity;
      CITIES.forEach(function (c) {
        var d = Math.hypot(c.lat - lat, (c.lon - lon) * Math.cos(lat * Math.PI / 180));
        if (d < best) { best = d; near = c; }
      });
      if (near && best < 0.35) {
        el.citySelect.value = near.slug;
        state.city = near;
        notify("Определено ваше местоположение: " + near.name, "success");
      } else {
        switchMode("custom");
        el.coordsInput.value = coordToString(lat) + ", " + coordToString(lon);
        tryParseCoordsInput(false);
        notify("Определено ваше местоположение: " + coordToString(lat) + ", " + coordToString(lon), "success");
      }
      updatePlaceHint();
      updateMeta();
    },
    function () {
      notify("Геолокация недоступна — выбран город Москва");
    },
    { timeout: 8000, maximumAge: 300000 }
  );
}

/* ================== Отрисовка звёздного неба ================== */

function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawSkyMap(canvas, sizePx) {
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(sizePx * dpr);
  canvas.height = Math.round(sizePx * dpr);
  var ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, sizePx, sizePx);

  var R = sizePx / 2;
  var rnd = mulberry32(20261011);

  // фон
  var bg = ctx.createRadialGradient(R, R * 0.9, R * 0.1, R, R, R);
  bg.addColorStop(0, "#0e1330");
  bg.addColorStop(0.55, "#080b1c");
  bg.addColorStop(1, "#04050c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, sizePx, sizePx);

  // Млечный Путь — размытая полоса под углом
  ctx.save();
  ctx.translate(R, R);
  ctx.rotate(-0.55);
  var band = ctx.createLinearGradient(0, -R * 0.26, 0, R * 0.26);
  band.addColorStop(0, "rgba(150,165,225,0)");
  band.addColorStop(0.5, "rgba(165,178,235,0.20)");
  band.addColorStop(1, "rgba(150,165,225,0)");
  ctx.fillStyle = band;
  ctx.fillRect(-R, -R * 0.26, 2 * R, R * 0.52);
  for (var g = 0; g < 240; g++) {
    var gx = (rnd() * 2 - 1) * R;
    var gy = (rnd() + rnd() + rnd() - 1.5) / 1.5 * R * 0.22;
    ctx.fillStyle = "rgba(200,210,250," + (0.03 + rnd() * 0.09).toFixed(3) + ")";
    ctx.beginPath();
    ctx.arc(gx, gy, 0.5 + rnd() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // звёзды
  var starColors = ["#ffffff", "#ffffff", "#ffffff", "#d7e4ff", "#ffeccf"];
  for (var i = 0; i < 340; i++) {
    var rr = Math.sqrt(rnd()) * R * 0.985;
    var ang = rnd() * Math.PI * 2;
    var x = R + rr * Math.cos(ang);
    var y = R + rr * Math.sin(ang);
    var s = 0.35 + Math.pow(rnd(), 2.4) * 1.5;
    ctx.globalAlpha = 0.3 + rnd() * 0.65;
    ctx.fillStyle = starColors[Math.floor(rnd() * starColors.length)];
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // яркие звёзды с лучиками
  var bright = [];
  for (var b = 0; b < 7; b++) {
    var br = Math.sqrt(rnd()) * R * 0.85;
    var ba = rnd() * Math.PI * 2;
    var bx = R + br * Math.cos(ba);
    var by = R + br * Math.sin(ba);
    bright.push([bx, by]);
    var glow = ctx.createRadialGradient(bx, by, 0, bx, by, 10);
    glow.addColorStop(0, "rgba(255,255,255,0.95)");
    glow.addColorStop(0.25, "rgba(220,230,255,0.35)");
    glow.addColorStop(1, "rgba(220,230,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bx, by, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 0.7;
    var spike = 7 + rnd() * 7;
    ctx.beginPath();
    ctx.moveTo(bx - spike, by); ctx.lineTo(bx + spike, by);
    ctx.moveTo(bx, by - spike); ctx.lineTo(bx, by + spike);
    ctx.stroke();
  }

  // «созвездия» — ломаные между яркими звёздами
  ctx.strokeStyle = "rgba(180,200,255,0.18)";
  ctx.lineWidth = 0.8;
  [0, 3].forEach(function (start) {
    ctx.beginPath();
    var pts = bright.slice(start, start + 4);
    if (pts.length < 2) return;
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.stroke();
  });

  // Луна (серп)
  var mx = R * 0.70, my = R * 0.30, mr = R * 0.065;
  var mGlow = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 3.2);
  mGlow.addColorStop(0, "rgba(245,242,230,0.5)");
  mGlow.addColorStop(1, "rgba(245,242,230,0)");
  ctx.fillStyle = mGlow;
  ctx.beginPath(); ctx.arc(mx, my, mr * 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f3f0e4";
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#0a0d1d";
  ctx.beginPath(); ctx.arc(mx - mr * 0.42, my - mr * 0.22, mr * 0.92, 0, Math.PI * 2); ctx.fill();

  // планеты
  [[R * 0.32, R * 0.64, R * 0.018, "#ffb27a"], [R * 0.56, R * 0.74, R * 0.012, "#ffd9a0"]].forEach(function (p) {
    var pGlow = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], p[2] * 5);
    pGlow.addColorStop(0, p[3]);
    pGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = pGlow;
    ctx.beginPath(); ctx.arc(p[0], p[1], p[2] * 5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = p[3];
    ctx.beginPath(); ctx.arc(p[0], p[1], p[2], 0, Math.PI * 2); ctx.fill();
  });
}

function drawBgStars(canvas) {
  var w = window.innerWidth, h = window.innerHeight;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  var ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  var rnd = mulberry32(777);
  for (var i = 0; i < 130; i++) {
    var x = rnd() * w, y = rnd() * h;
    ctx.globalAlpha = 0.12 + rnd() * 0.4;
    ctx.fillStyle = rnd() > 0.85 ? "#cdd8ff" : "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, 0.4 + Math.pow(rnd(), 2) * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function renderSky() {
  var size = el.skyCircle.clientWidth;
  if (size > 0) drawSkyMap(el.skyCanvas, size);
}

/* ================== Инициализация ================== */

function loadCities() {
  return fetch(CITIES_URL)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      CITIES = (data && data.cities) || [];
      return CITIES;
    });
}

function populateCitySelect() {
  el.citySelect.innerHTML = "";
  CITIES.forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c.slug;
    opt.textContent = c.name;
    el.citySelect.appendChild(opt);
  });
  var custom = document.createElement("option");
  custom.value = CUSTOM_OPTION;
  custom.textContent = "Другое место / координаты…";
  el.citySelect.appendChild(custom);

  var moscow = CITIES.find(function (c) { return c.slug === "moscow"; }) || CITIES[0];
  if (moscow) {
    el.citySelect.value = moscow.slug;
    state.city = moscow;
  }
}

function setDefaults() {
  var now = new Date();
  el.dateInput.value = pad(now.getDate()) + "." + pad(now.getMonth() + 1) + "." + pad(now.getFullYear(), 4);
  el.timeInput.value = pad(now.getHours()) + ":" + pad(now.getMinutes());
}

function bindEvents() {
  el.form.addEventListener("submit", onSubmit);

  el.citySelect.addEventListener("change", onCityChange);

  el.btnYandex.addEventListener("click", function () {
    window.open(YANDEX_MAPS_URL, "_blank", "noopener");
  });

  el.btnBackCity.addEventListener("click", function () {
    if (!el.citySelect.value || el.citySelect.value === CUSTOM_OPTION) {
      var moscow = CITIES.find(function (c) { return c.slug === "moscow"; }) || (CITIES[0] && CITIES[0].slug);
      if (moscow) el.citySelect.value = moscow.slug;
    }
    switchMode("city");
  });

  el.coordsInput.addEventListener("blur", function () {
    if (!el.coordsInput.value.trim()) { state.coords = null; updatePlaceHint(); updateMeta(); return; }
    var res = tryParseCoordsInput(true);
    if (!res.ok) setError(el.customPill, el.placeError, MSG.placeUnrecognized);
  });

  el.coordsInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var res = tryParseCoordsInput(true);
      if (!res.ok) setError(el.customPill, el.placeError, el.coordsInput.value.trim() ? MSG.placeUnrecognized : MSG.placeEmpty);
      else el.coordsInput.blur();
    }
  });

  el.coordsInput.addEventListener("input", function () {
    setError(el.customPill, el.placeError, null);
    state.coords = null;
    updatePlaceHint();
    updateMeta();
  });

  el.dateInput.addEventListener("input", maskDate);
  el.timeInput.addEventListener("input", maskTime);


  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      renderSky();
      drawBgStars(el.bgCanvas);
    }, 150);
  });
}

function init() {
  initDomRefs();

  loadCities()
    .then(function () {
      populateCitySelect();
      setDefaults();
      updatePlaceHint();
      updateMeta();
      requestGeolocation();
    })
    .catch(function () {
      setDefaults();
      notify(MSG.citiesLoadError, "error", 9000);
      updatePlaceHint();
      updateMeta();
    });

  bindEvents();
  renderSky();
  drawBgStars(el.bgCanvas);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/* Публичное API для отладки и тестов */
window.SkyService = {
  parsePlace: parsePlace,
  parseDateStr: parseDateStr,
  parseTimeStr: parseTimeStr,
  localToUtcMs: localToUtcMs,
  buildSsc: buildSsc,
  buildFileName: buildFileName,
  coordsSlug: coordsSlug,
  validate: function (place, date, time) {
    return {
      place: (function () { var r = parsePlace(place); return r.ok ? null : (place && place.trim() ? MSG.placeUnrecognized : MSG.placeEmpty); })(),
      date: (function () {
        var dp = parseDateStr(date);
        if (!dp) return MSG.dateInvalid;
        if (cmpDate(dp, todayParts()) > 0) return MSG.dateFuture;
        return null;
      })(),
      time: (function () {
        var tp = parseTimeStr(time);
        if (!tp) return MSG.timeInvalid;
        var dp = parseDateStr(date);
        var t = todayParts();
        if (dp && cmpDate(dp, t) === 0 && tp.h * 60 + tp.mi > t.h * 60 + t.mi) return MSG.timeFuture;
        return null;
      })()
    };
  },
  cities: function () { return CITIES; },
  state: function () { return state; }
};
