/* ============================================================
   Fahrtenbuch PWA – Anwendungslogik
   Keine externen Abhängigkeiten.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Konstanten ---------- */
  var STORAGE_KEYS = {
    SETTINGS: "settings",
    TRIPS: "trips"
  };
  var SETTINGS_VERSION = 1;
  var DEFAULT_TARIFF = 0.30;
  var SW_PATH = "sw.js";
  var CACHE_NAME = "fahrtenbuch-v1";

  /* ---------- Storage-Helfer ---------- */
  function storageAvailable() {
    try {
      var k = "__fahrtenbuch_test__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }
  var HAS_STORAGE = storageAvailable();

  function readJson(key, fallback) {
    if (!HAS_STORAGE) return fallback;
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Konnte", key, "nicht lesen:", e);
      return fallback;
    }
  }
  function writeJson(key, value) {
    if (!HAS_STORAGE) {
      throw new Error("localStorage ist nicht verfügbar.");
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // QuotaExceededError oder ähnliches
      throw e;
    }
  }

  /* ---------- Zahlenformatierung ---------- */
  function parseDeNumber(input) {
    if (input === null || input === undefined) return NaN;
    var s = String(input).trim();
    if (s === "") return NaN;
    // Erlaube Komma oder Punkt als Dezimaltrennzeichen
    s = s.replace(/\s+/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function fmtEur(n) {
    if (!isFinite(n)) n = 0;
    return n.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + "\u00A0€";
  }
  function fmtKm(n) {
    if (!isFinite(n)) n = 0;
    // Eine Nachkommastelle, Tausender-Punkt
    return n.toLocaleString("de-DE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    });
  }
  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /* ---------- Datum-Helfer ---------- */
  function todayIso() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function monthIso(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    return y + "-" + m;
  }
  function currentMonthIso() {
    return monthIso(new Date());
  }
  function parseIsoDate(s) {
    // "YYYY-MM-DD" – als lokales Datum parsen
    var parts = String(s).split("-");
    if (parts.length !== 3) return new Date(NaN);
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  function fmtDateDe(iso) {
    var d = parseIsoDate(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric"
    });
  }
  function fmtMonthDe(yyyymm) {
    var parts = String(yyyymm).split("-");
    if (parts.length !== 2) return yyyymm;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    if (isNaN(d.getTime())) return yyyymm;
    return d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  }

  /* ---------- ID-Generator ---------- */
  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      try { return window.crypto.randomUUID(); } catch (e) { /* fall through */ }
    }
    return "t_" + Date.now().toString(36) + "_" +
           Math.random().toString(36).slice(2, 10);
  }

  /* ---------- State ---------- */
  var state = {
    settings: null,
    trips: []
  };

  function loadSettings() {
    var raw = readJson(STORAGE_KEYS.SETTINGS, null);
    if (raw && typeof raw === "object" && raw.version === SETTINGS_VERSION) {
      state.settings = {
        tariffEurPerKm: Number(raw.tariffEurPerKm) || DEFAULT_TARIFF,
        forwardKm: Number(raw.forwardKm) || 0,
        returnKm: Number(raw.returnKm) || 0,
        version: SETTINGS_VERSION
      };
    } else {
      // Frischer Start – Defaults anlegen, aber Strecken leer
      state.settings = {
        tariffEurPerKm: DEFAULT_TARIFF,
        forwardKm: 0,
        returnKm: 0,
        version: SETTINGS_VERSION
      };
    }
  }
  function loadTrips() {
    var raw = readJson(STORAGE_KEYS.TRIPS, []);
    if (Array.isArray(raw)) {
      state.trips = raw.filter(function (t) {
        return t && t.id && t.date && t.direction && isFinite(Number(t.km));
      });
    } else {
      state.trips = [];
    }
    // Sicherstellen, dass createdAt gesetzt ist
    state.trips.forEach(function (t) {
      if (!t.createdAt) t.createdAt = new Date().toISOString();
    });
  }

  function saveSettings() {
    return writeJson(STORAGE_KEYS.SETTINGS, state.settings);
  }
  function saveTrips() {
    return writeJson(STORAGE_KEYS.TRIPS, state.trips);
  }

  function settingsComplete() {
    var s = state.settings;
    return !!s && s.forwardKm > 0 && s.returnKm > 0 && s.tariffEurPerKm > 0;
  }

  /* ---------- DOM-Helfer ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") e.className = attrs[k];
        else if (k === "text") e.textContent = attrs[k];
        else if (k === "html") e.innerHTML = attrs[k];
        else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") {
          e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] === true) e.setAttribute(k, "");
        else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return e;
  }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(msg, kind) {
    var t = $("#toast");
    if (!t) return;
    t.className = "toast" + (kind ? " toast-" + kind : "");
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }

  /* ---------- Navigation ---------- */
  function showView(name) {
    var map = {
      capture: "#view-capture",
      overview: "#view-overview",
      settings: "#view-settings",
      bulk: "#view-bulk"
    };
    Object.keys(map).forEach(function (k) {
      var sec = $(map[k]);
      if (sec) {
        if (k === name) {
          sec.hidden = false;
          sec.classList.add("view-active");
        } else {
          sec.hidden = true;
          sec.classList.remove("view-active");
        }
      }
    });
    $$(".nav-btn").forEach(function (b) {
      var active = b.getAttribute("data-go") === name;
      b.classList.toggle("nav-btn-active", active);
      if (active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (name === "overview") renderOverview();
    if (name === "settings") renderSettingsForm();
    if (name === "capture") renderCapture();
    if (name === "bulk") renderBulk();
    // Beim View-Wechsel nach oben scrollen
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  /* ---------- Capture (Erfassen) ---------- */
  function renderCapture() {
    var blocker = $("#captureBlocker");
    var form = $("#captureForm");
    if (!settingsComplete()) {
      blocker.hidden = false;
      form.hidden = true;
      return;
    }
    blocker.hidden = true;
    form.hidden = false;

    var dateInput = $("#tripDate");
    if (!dateInput.value) dateInput.value = todayIso();

    updateCaptureHint();
  }
  function updateCaptureHint() {
    var s = state.settings;
    var dir = (document.querySelector('input[name="direction"]:checked') || {}).value || "both";
    var hint = "";
    if (dir === "forward") {
      hint = "Es wird " + fmtKm(s.forwardKm) + " km (Hin) erfasst – " +
             fmtEur(round2(s.forwardKm * s.tariffEurPerKm));
    } else if (dir === "return") {
      hint = "Es wird " + fmtKm(s.returnKm) + " km (Rück) erfasst – " +
             fmtEur(round2(s.returnKm * s.tariffEurPerKm));
    } else {
      var totalKm = s.forwardKm + s.returnKm;
      var totalEur = round2(totalKm * s.tariffEurPerKm);
      hint = "Es werden zwei Fahrten erfasst: " +
             fmtKm(s.forwardKm) + " km (Hin) + " + fmtKm(s.returnKm) + " km (Rück) = " +
             fmtKm(totalKm) + " km, " + fmtEur(totalEur);
    }
    $("#captureHint").textContent = hint;
  }
  function onCaptureSubmit(ev) {
    ev.preventDefault();
    if (!settingsComplete()) {
      toast("Bitte zuerst Einstellungen ausfüllen.", "err");
      return;
    }
    var date = $("#tripDate").value;
    if (!date) { toast("Bitte Datum wählen.", "err"); return; }
    if (date > todayIso()) {
      toast("Hinweis: Datum liegt in der Zukunft – gespeichert.", "ok");
    }
    var dirChecked = document.querySelector('input[name="direction"]:checked');
    var dir = dirChecked ? dirChecked.value : "both";
    var note = ($("#tripNote").value || "").trim();
    var s = state.settings;

    var newTrips = [];
    var now = new Date().toISOString();
    function makeTrip(direction, km) {
      return {
        id: makeId(),
        date: date,
        direction: direction,
        km: km,
        tariffEurPerKm: s.tariffEurPerKm,
        amountEur: round2(km * s.tariffEurPerKm),
        note: note,
        createdAt: now
      };
    }
    if (dir === "forward" || dir === "return") {
      var km2 = dir === "forward" ? s.forwardKm : s.returnKm;
      newTrips.push(makeTrip(dir, km2));
    } else { // both
      newTrips.push(makeTrip("forward", s.forwardKm));
      newTrips.push(makeTrip("return", s.returnKm));
    }
    try {
      Array.prototype.push.apply(state.trips, newTrips);
      saveTrips();
    } catch (e) {
      state.trips = state.trips.slice(0, state.trips.length - newTrips.length);
      toast("Speichern fehlgeschlagen – möglicherweise Speicher voll.", "err");
      console.error(e);
      return;
    }
    var msg = newTrips.length === 1
      ? "Fahrt gespeichert."
      : "Hin- und Rückfahrt gespeichert.";
    toast(msg, "ok");
    $("#tripNote").value = "";
  }

  /* ---------- Settings (Einstellungen) ---------- */
  function renderSettingsForm() {
    var s = state.settings;
    $("#tariff").value = s.tariffEurPerKm.toLocaleString("de-DE", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    $("#forwardKm").value = s.forwardKm > 0
      ? s.forwardKm.toLocaleString("de-DE", { maximumFractionDigits: 2 })
      : "";
    $("#returnKm").value = s.returnKm > 0
      ? s.returnKm.toLocaleString("de-DE", { maximumFractionDigits: 2 })
      : "";
    $("#settingsMsg").textContent = "";
    $("#settingsMsg").className = "form-msg";
  }
  function onSettingsSubmit(ev) {
    ev.preventDefault();
    var tariff = parseDeNumber($("#tariff").value);
    var fwd = parseDeNumber($("#forwardKm").value);
    var ret = parseDeNumber($("#returnKm").value);
    var msg = $("#settingsMsg");
    msg.className = "form-msg";
    if (!isFinite(tariff) || tariff <= 0) {
      msg.textContent = "Bitte einen gültigen, positiven Tarif eingeben (z. B. 0,30).";
      msg.classList.add("err");
      return;
    }
    if (!isFinite(fwd) || fwd <= 0) {
      msg.textContent = "Bitte eine gültige, positive Hin-Strecke in km eingeben.";
      msg.classList.add("err");
      return;
    }
    if (!isFinite(ret) || ret <= 0) {
      msg.textContent = "Bitte eine gültige, positive Rück-Strecke in km eingeben.";
      msg.classList.add("err");
      return;
    }
    state.settings.tariffEurPerKm = tariff;
    state.settings.forwardKm = fwd;
    state.settings.returnKm = ret;
    state.settings.version = SETTINGS_VERSION;
    try {
      saveSettings();
    } catch (e) {
      msg.textContent = "Speichern fehlgeschlagen – möglicherweise Speicher voll.";
      msg.classList.add("err");
      console.error(e);
      return;
    }
    msg.textContent = "Einstellungen gespeichert.";
    msg.classList.add("ok");
    toast("Einstellungen gespeichert.", "ok");
  }
  function onClearTrips() {
    if (state.trips.length === 0) {
      toast("Es sind keine Fahrten vorhanden.");
      return;
    }
    showConfirm(
      "Alle Fahrten löschen?",
      "Es werden " + state.trips.length + " Fahrten dauerhaft entfernt. Die Einstellungen bleiben erhalten.",
      function () {
        state.trips = [];
        try {
          saveTrips();
          toast("Alle Fahrten gelöscht.", "ok");
          renderOverview();
        } catch (e) {
          toast("Löschen fehlgeschlagen.", "err");
        }
      }
    );
  }

  /* ---------- Overview (Übersicht) ---------- */
  function getFilteredTrips() {
    var f = $("#filterMonth").value || currentMonthIso();
    return state.trips
      .filter(function (t) { return t.date.indexOf(f) === 0; })
      .sort(function (a, b) {
        if (a.date < b.date) return 1;
        if (a.date > b.date) return -1;
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      });
  }
  function renderOverview() {
    var filterInput = $("#filterMonth");
    if (!filterInput.value) filterInput.value = currentMonthIso();

    var trips = getFilteredTrips();
    var sumKm = 0, sumEur = 0;
    trips.forEach(function (t) {
      sumKm += Number(t.km) || 0;
      sumEur += Number(t.amountEur) || 0;
    });
    $("#sumCount").textContent = String(trips.length);
    $("#sumKm").textContent = fmtKm(sumKm);
    $("#sumEur").textContent = fmtEur(round2(sumEur));

    var list = $("#tripList");
    list.innerHTML = "";
    if (trips.length === 0) {
      list.appendChild(el("p", { class: "empty-msg", text: "Keine Fahrten im gewählten Monat." }));
      return;
    }
    trips.forEach(function (t) {
      list.appendChild(buildTripRow(t));
    });
  }
  function buildTripRow(t) {
    var dirLabel = t.direction === "forward" ? "Hin" : "Rück";
    var arrow = t.direction === "forward" ? "↑" : "↓";
    var amount = fmtEur(round2(Number(t.amountEur) || 0));
    var note = t.note ? t.note : "";

    var main = el("div", { class: "trip-main" }, [
      el("div", { class: "trip-date", text: fmtDateDe(t.date) + "  " + arrow + "  " + dirLabel }),
      el("div", { class: "trip-sub" }, [
        document.createTextNode(fmtKm(Number(t.km) || 0) + " km  ·  " + (Number(t.tariffEurPerKm).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €/km")),
        note ? el("span", { class: "note", text: "  ·  " + note }) : null
      ])
    ]);
    var amountEl = el("div", { class: "trip-amount" }, [
      document.createTextNode(amount),
      el("small", { text: dirLabel })
    ]);

    var editBtn = el("button", {
      type: "button", class: "btn btn-secondary",
      "aria-label": "Fahrt bearbeiten",
      onclick: function () { openEditModal(t.id); }
    }, "Bearbeiten");

    var delBtn = el("button", {
      type: "button", class: "btn btn-danger",
      "aria-label": "Fahrt löschen",
      onclick: function () { confirmDelete(t.id); }
    }, "Löschen");

    var actions = el("div", { class: "trip-actions" }, [editBtn, delBtn]);

    return el("div", {
      class: "trip direction-" + t.direction, "data-id": t.id
    }, [main, amountEl, actions]);
  }

  /* ---------- Edit-Modal ---------- */
  var editModalListenersBound = false;
  function bindEditModal() {
    if (editModalListenersBound) return;
    editModalListenersBound = true;
    $("#editForm").addEventListener("submit", onEditSubmit);
    $$('#editModal [data-modal-close]').forEach(function (n) {
      n.addEventListener("click", closeEditModal);
    });
  }
  function openEditModal(id) {
    var t = state.trips.find(function (x) { return x.id === id; });
    if (!t) return;
    bindEditModal();
    $("#editId").value = t.id;
    $("#editDate").value = t.date;
    $("#editDirection").value = t.direction;
    $("#editKm").value = (Number(t.km) || 0).toLocaleString("de-DE", { maximumFractionDigits: 2 });
    $("#editTariff").value = (Number(t.tariffEurPerKm) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    $("#editNote").value = t.note || "";
    $("#editHint").textContent = "";
    $("#editModal").hidden = false;
  }
  function closeEditModal() {
    $("#editModal").hidden = true;
  }
  function onEditSubmit(ev) {
    ev.preventDefault();
    var id = $("#editId").value;
    var t = state.trips.find(function (x) { return x.id === id; });
    if (!t) { closeEditModal(); return; }
    var date = $("#editDate").value;
    var dir = $("#editDirection").value;
    var km = parseDeNumber($("#editKm").value);
    var tariff = parseDeNumber($("#editTariff").value);
    var note = ($("#editNote").value || "").trim();
    var hint = $("#editHint");
    hint.textContent = "";
    if (!date) { hint.textContent = "Datum fehlt."; return; }
    if (!isFinite(km) || km <= 0) { hint.textContent = "Bitte gültige Kilometer > 0."; return; }
    if (!isFinite(tariff) || tariff <= 0) { hint.textContent = "Bitte gültigen Tarif > 0."; return; }
    t.date = date;
    t.direction = dir === "return" ? "return" : "forward";
    t.km = km;
    t.tariffEurPerKm = tariff;
    t.amountEur = round2(km * tariff);
    t.note = note;
    try {
      saveTrips();
    } catch (e) {
      hint.textContent = "Speichern fehlgeschlagen – Speicher möglicherweise voll.";
      console.error(e);
      return;
    }
    closeEditModal();
    toast("Fahrt aktualisiert.", "ok");
    renderOverview();
  }

  /* ---------- Confirm-Modal (Löschen) ---------- */
  var confirmModalListenersBound = false;
  var confirmOkHandler = null;
  function bindConfirmModal() {
    if (confirmModalListenersBound) return;
    confirmModalListenersBound = true;
    $$('#confirmModal [data-confirm-close]').forEach(function (n) {
      n.addEventListener("click", closeConfirm);
    });
    $("#confirmOk").addEventListener("click", function () {
      var h = confirmOkHandler;
      closeConfirm();
      if (typeof h === "function") h();
    });
  }
  function showConfirm(title, text, onOk) {
    bindConfirmModal();
    $("#confirmTitle").textContent = title || "Sicher?";
    $("#confirmText").textContent = text || "";
    confirmOkHandler = onOk || null;
    $("#confirmModal").hidden = false;
  }
  function closeConfirm() {
    $("#confirmModal").hidden = true;
    confirmOkHandler = null;
  }
  function confirmDelete(id) {
    var t = state.trips.find(function (x) { return x.id === id; });
    if (!t) return;
    showConfirm(
      "Fahrt löschen?",
      fmtDateDe(t.date) + " · " +
      (t.direction === "forward" ? "Hin" : "Rück") + " · " +
      fmtKm(Number(t.km) || 0) + " km · " +
      fmtEur(round2(Number(t.amountEur) || 0)),
      function () {
        state.trips = state.trips.filter(function (x) { return x.id !== id; });
        try {
          saveTrips();
          toast("Fahrt gelöscht.", "ok");
          renderOverview();
        } catch (e) {
          toast("Löschen fehlgeschlagen.", "err");
        }
      }
    );
  }

  /* ---------- CSV-Export ---------- */
  function csvEscape(v) {
    if (v === null || v === undefined) return "";
    var s = String(v);
    // CSV-Quote, falls Sonderzeichen
    if (/[";\n\r]/.test(s)) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }
  function exportCsv(scope) {
    var all = state.trips.slice().sort(function (a, b) {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
    var rows, filename;
    if (scope === "month") {
      var m = $("#filterMonth").value || currentMonthIso();
      rows = all.filter(function (t) { return t.date.indexOf(m) === 0; });
      filename = "fahrtenbuch_" + m + ".csv";
    } else {
      rows = all;
      var d = new Date();
      var stamp = d.getFullYear() + "-" +
                  String(d.getMonth() + 1).padStart(2, "0") + "-" +
                  String(d.getDate()).padStart(2, "0");
      filename = "fahrtenbuch_alle_" + stamp + ".csv";
    }
    if (rows.length === 0) {
      toast("Keine Fahrten für den Export.", "err");
      return;
    }
    var header = ["Datum", "Richtung", "km", "Tarif (€/km)", "Betrag (€)", "Notiz"];
    var lines = [header.map(csvEscape).join(";")];
    rows.forEach(function (t) {
      lines.push([
        t.date,
        t.direction === "forward" ? "Hin" : "Rück",
        (Number(t.km) || 0).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
        (Number(t.tariffEurPerKm) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        (Number(t.amountEur) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        t.note || ""
      ].map(csvEscape).join(";"));
    });
    // BOM + CRLF für saubere Excel-Darstellung
    var content = "\uFEFF" + lines.join("\r\n") + "\r\n";
    var blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("CSV exportiert: " + filename, "ok");
  }

  /* ---------- PDF-Export (über window.print) ---------- */
  function buildPrintView() {
    var f = $("#filterMonth").value || currentMonthIso();
    var trips = state.trips
      .filter(function (t) { return t.date.indexOf(f) === 0; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var sumKm = 0, sumEur = 0;
    var body = $("#printBody");
    body.innerHTML = "";
    trips.forEach(function (t) {
      sumKm += Number(t.km) || 0;
      sumEur += Number(t.amountEur) || 0;
      var tr = el("tr", null, [
        el("td", { text: fmtDateDe(t.date) }),
        el("td", { text: t.direction === "forward" ? "Hin" : "Rück" }),
        el("td", { text: (Number(t.km) || 0).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) }),
        el("td", { text: (Number(t.tariffEurPerKm) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }),
        el("td", { text: (Number(t.amountEur) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }),
        el("td", { text: t.note || "" })
      ]);
      body.appendChild(tr);
    });
    $("#printSumKm").textContent = sumKm.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    $("#printSumEur").textContent = fmtEur(round2(sumEur));
    $("#printMeta").textContent = "Zeitraum: " + fmtMonthDe(f);
    $("#printDate").textContent = fmtDateDe(todayIso());
    return trips.length;
  }
  function exportPdf() {
    var n = buildPrintView();
    if (n === 0) {
      toast("Keine Fahrten im gewählten Monat – nichts zu drucken.", "err");
      return;
    }
    toast("Druckdialog öffnen – als PDF speichern wählen.");
    // Kurze Verzögerung, damit Toast sichtbar ist
    setTimeout(function () { window.print(); }, 250);
  }

  /* ---------- Service Worker ---------- */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    // Nur über http(s) registrieren – file:// verursacht sonst Fehler
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    navigator.serviceWorker.register(SW_PATH).then(function (reg) {
      console.info("[SW] registriert:", reg.scope);
    }, function (err) {
      console.warn("[SW] Registrierung fehlgeschlagen:", err);
    });
  }

  /* ---------- Bulk / Mehrfach-Erfassung ---------- */
  var bulkState = {
    month: null,        // { year, month } – angezeigter Monat
    selected: Object.create(null), // key "YYYY-MM-DD" -> true
    routeKey: "forward", // "forward" | "return"
    mode: "both"        // "both" | "forward" | "return"
  };

  var MONTH_NAMES = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember"
  ];

  function isoFromParts(y, m, d) {
    var mm = String(m + 1);
    if (mm.length < 2) mm = "0" + mm;
    var dd = String(d);
    if (dd.length < 2) dd = "0" + dd;
    return y + "-" + mm + "-" + dd;
  }

  function currentYearMonth() {
    var d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  function renderBulkRouteList() {
    var list = $("#bulkRouteList");
    if (!list) return;
    list.innerHTML = "";
    var s = state.settings;
    var items = [
      { key: "forward", name: "Hin (Wohnung → Lager)", km: s.forwardKm },
      { key: "return", name: "Rück (Lager → Wohnung)", km: s.returnKm }
    ];
    items.forEach(function (it) {
      var div = el("div", {
        class: "bulk-route-item" + (bulkState.routeKey === it.key ? " selected" : ""),
        "data-route": it.key,
        role: "radio",
        "aria-checked": bulkState.routeKey === it.key ? "true" : "false",
        tabindex: "0"
      }, [
        el("span", { class: "ri-name" }, it.name),
        el("span", { class: "ri-km" }, fmtKm(it.km) + " km")
      ]);
      div.addEventListener("click", function () {
        bulkState.routeKey = it.key;
        renderBulkRouteList();
      });
      div.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          bulkState.routeKey = it.key;
          renderBulkRouteList();
        }
      });
      list.appendChild(div);
    });
  }

  function renderBulkCalendar() {
    var cal = $("#bulkCalendar");
    if (!cal) return;
    cal.innerHTML = "";
    var y = bulkState.month.year;
    var m = bulkState.month.month;
    var first = new Date(y, m, 1);
    // Mo=0 ... So=6
    var firstWeekday = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var todayIso = (function () {
      var t = new Date();
      return isoFromParts(t.getFullYear(), t.getMonth(), t.getDate());
    })();

    $("#bulkMonthTitle").textContent = MONTH_NAMES[m] + " " + y;

    for (var i = 0; i < firstWeekday; i++) {
      cal.appendChild(el("div", { class: "bulk-day empty" }, ""));
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var iso = isoFromParts(y, m, d);
      var dow = (new Date(y, m, d).getDay() + 6) % 7; // 0=Mo
      var isWeekend = dow >= 5; // Sa, So
      var isFuture = iso > todayIso;
      var classes = ["bulk-day"];
      if (isWeekend) classes.push("weekend");
      if (isFuture) classes.push("future");
      if (bulkState.selected[iso]) classes.push("selected");
      var cell = el("div", {
        class: classes.join(" "),
        "data-iso": iso,
        role: "gridcell",
        "aria-selected": bulkState.selected[iso] ? "true" : "false",
        "aria-label": iso
      }, String(d));
      cell.addEventListener("click", function (ev) {
        var isoVal = ev.currentTarget.getAttribute("data-iso");
        if (bulkState.selected[isoVal]) {
          delete bulkState.selected[isoVal];
        } else {
          bulkState.selected[isoVal] = true;
        }
        renderBulkCalendar();
        renderBulkSummary();
      });
      cal.appendChild(cell);
    }
  }

  function renderBulkSummary() {
    var n = Object.keys(bulkState.selected).length;
    $("#bulkCount").textContent = n + (n === 1 ? " Tag ausgewählt" : " Tage ausgewählt");
    $("#bulkCreate").disabled = n === 0;
  }

  function renderBulk() {
    if (!bulkState.month) bulkState.month = currentYearMonth();
    renderBulkRouteList();
    renderBulkCalendar();
    renderBulkSummary();
    var msg = $("#bulkMsg");
    if (msg) { msg.textContent = ""; msg.className = "form-msg"; }
  }

  function bulkChangeMonth(delta) {
    bulkState.month.month += delta;
    if (bulkState.month.month < 0) {
      bulkState.month.month = 11;
      bulkState.month.year -= 1;
    } else if (bulkState.month.month > 11) {
      bulkState.month.month = 0;
      bulkState.month.year += 1;
    }
    renderBulkCalendar();
  }

  function commitBulk() {
    var s = state.settings;
    var isos = Object.keys(bulkState.selected).sort();
    if (isos.length === 0) return;
    if (!isFinite(s.tariffEurPerKm) || s.tariffEurPerKm <= 0) {
      var m = $("#bulkMsg");
      m.textContent = "Bitte zuerst in den Einstellungen einen gültigen Tarif eintragen.";
      m.className = "form-msg err";
      return;
    }
    var fwdKm = Number(s.forwardKm);
    var retKm = Number(s.returnKm);
    var fwdOk = isFinite(fwdKm) && fwdKm > 0;
    var retOk = isFinite(retKm) && retKm > 0;
    var mode = bulkState.mode;
    if ((mode === "forward" || mode === "both") && !fwdOk) {
      $("#bulkMsg").textContent = "Hin-Strecke fehlt oder ist 0 – bitte in Einstellungen prüfen.";
      $("#bulkMsg").className = "form-msg err";
      return;
    }
    if ((mode === "return" || mode === "both") && !retOk) {
      $("#bulkMsg").textContent = "Rück-Strecke fehlt oder ist 0 – bitte in Einstellungen prüfen.";
      $("#bulkMsg").className = "form-msg err";
      return;
    }

    var created = 0;
    var now = new Date().toISOString();
    isos.forEach(function (iso) {
      if (mode === "forward" || mode === "both") {
        state.trips.push({
          id: makeId(),
          date: iso,
          direction: "forward",
          km: fwdKm,
          tariffEurPerKm: Number(s.tariffEurPerKm),
          amountEur: round2(fwdKm * Number(s.tariffEurPerKm)),
          note: "Mehrfach: Hin",
          createdAt: now
        });
        created++;
      }
      if (mode === "return" || mode === "both") {
        state.trips.push({
          id: makeId(),
          date: iso,
          direction: "return",
          km: retKm,
          tariffEurPerKm: Number(s.tariffEurPerKm),
          amountEur: round2(retKm * Number(s.tariffEurPerKm)),
          note: "Mehrfach: Rück",
          createdAt: now
        });
        created++;
      }
    });

    try {
      saveTrips();
    } catch (e) {
      $("#bulkMsg").textContent = "Speichern fehlgeschlagen – möglicherweise Speicher voll.";
      $("#bulkMsg").className = "form-msg err";
      console.error(e);
      return;
    }

    bulkState.selected = Object.create(null);
    renderBulkCalendar();
    renderBulkSummary();
    var msg = $("#bulkMsg");
    msg.textContent = created + " Fahrten erstellt. Siehe Übersicht.";
    msg.className = "form-msg ok";
    toast(created + " Fahrten erstellt.", "ok");
  }

  /* ---------- Storage-Hinweis im UI ---------- */
  function showStorageBanner() {
    if (HAS_STORAGE) return;
    var card = el("div", { class: "card warn-card" }, [
      el("p", { html: "<strong>Hinweis:</strong> localStorage ist in diesem Browser nicht verfügbar " +
        "(z. B. privater Modus). Fahrten können nicht gespeichert werden." })
    ]);
    var main = $(".app-main");
    if (main && main.firstChild) main.insertBefore(card, main.firstChild);
  }

  /* ---------- Init / Wiring ---------- */
  function init() {
    if (!HAS_STORAGE) showStorageBanner();
    loadSettings();
    loadTrips();

    // Datum-Default
    $("#tripDate").value = todayIso();
    // Monatsfilter-Default
    $("#filterMonth").value = currentMonthIso();

    // Navigation
    $$(".nav-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        showView(b.getAttribute("data-go"));
      });
    });
    $$("[data-go]").forEach(function (b) {
      if (b.classList.contains("nav-btn")) return;
      b.addEventListener("click", function () {
        showView(b.getAttribute("data-go"));
      });
    });

    // Capture
    $$('input[name="direction"]').forEach(function (r) {
      r.addEventListener("change", updateCaptureHint);
    });
    $("#captureForm").addEventListener("submit", onCaptureSubmit);
    $("#settingsForm").addEventListener("submit", onSettingsSubmit);
    $("#btnClearTrips").addEventListener("click", onClearTrips);

    // Filter reagiert live
    $("#filterMonth").addEventListener("change", renderOverview);
    $("#filterMonth").addEventListener("input", renderOverview);

    // Export
    $("#btnExportCsvMonth").addEventListener("click", function () { exportCsv("month"); });
    $("#btnExportCsvAll").addEventListener("click", function () { exportCsv("all"); });
    $("#btnExportPdf").addEventListener("click", exportPdf);

    // Bulk / Mehrfach-Erfassung
    $("#bulkPrevMonth").addEventListener("click", function () { bulkChangeMonth(-1); });
    $("#bulkNextMonth").addEventListener("click", function () { bulkChangeMonth(1); });
    $("#bulkCreate").addEventListener("click", commitBulk);
    $("#bulkClear").addEventListener("click", function () {
      bulkState.selected = Object.create(null);
      renderBulkCalendar();
      renderBulkSummary();
    });
    $$('input[name="bulkMode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        bulkState.mode = r.value;
      });
    });

    // ESC schließt Modals
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        if (!$("#editModal").hidden) closeEditModal();
        if (!$("#confirmModal").hidden) closeConfirm();
      }
    });

    // Initial-View
    if (!settingsComplete()) {
      // Willkommens-Screen: direkt zu Einstellungen
      showView("settings");
      var s = state.settings;
      var msg = "";
      if (s.forwardKm <= 0 || s.returnKm <= 0) {
        msg = "Willkommen! Bitte zuerst Hin- und Rück-Strecke sowie den Tarif eingeben.";
      } else if (s.tariffEurPerKm <= 0) {
        msg = "Willkommen! Bitte zuerst den Tarif pro km eingeben.";
      } else {
        msg = "Willkommen! Bitte die Einstellungen prüfen und speichern.";
      }
      var settingsMsg = $("#settingsMsg");
      settingsMsg.textContent = msg;
      settingsMsg.classList.add("ok");
    } else {
      showView("capture");
    }

    registerServiceWorker();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
