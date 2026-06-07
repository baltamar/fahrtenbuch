# Fahrtenbuch – PWA für die Strecke Wohnung ↔ Lager

Eine kleine, **offlinefähige Progressive Web App** zum Erfassen, Verwalten
und Exportieren von Fahrten zwischen Wohnung und Lager (oder einem
beliebigen festen Punkt). Alle Daten bleiben ausschließlich lokal im
Browser (`localStorage`).

- **Sprache:** Deutsch
- **Build:** keine – pures HTML / CSS / JavaScript, statisch deploybar
- **Dependencies:** keine externen Libraries, keine CDNs, keine Tracker

---

## Funktionen

- **Einstellungen:** Tarif pro km, Hin- und Rück-Strecke (getrennt setzbar).
- **Fahrt erfassen:** Datum (auch rückwirkend), Richtungs-Auswahl
  („Nur Hin“ / „Nur Rück“ / „Hin + Rück“), optionale Notiz.
- **Tarif-Snapshot:** Bei jeder Fahrt wird der aktuelle Tarif mit
  gespeichert. Eine nachträgliche Tarif-Änderung verändert alte
  Einträge **nicht**.
- **Übersicht:** Monatsfilter, Summe km, Summe €, Liste mit
  Bearbeiten / Löschen.
- **CSV-Export:** Semikolon-getrennt mit BOM (Excel-freundlich), für
  aktuellen Monat oder alle Fahrten.
- **PDF-Export:** Druckansicht mit eigenem Print-Stylesheet (kein jsPDF,
  kein extra Library) – im Druckdialog „Als PDF speichern“ wählen.
- **PWA:** installierbar, Service Worker, Manifest mit 192/512 Icons.

---

## Bedienung

1. **Einstellungen** öffnen, Tarif (z. B. `0,30`) sowie Hin- und
   Rück-Strecke in km eintragen, speichern.
2. Auf **Erfassen** das Datum wählen, Richtung („Hin + Rück“ für
   Hin- und Rückfahrt) auswählen, ggf. Notiz hinzufügen, speichern.
3. In der **Übersicht** Monat filtern, Summen prüfen, einzelne
   Fahrten bearbeiten oder löschen.
4. **CSV**-Button für den aktuellen Monat bzw. für alle Fahrten –
   Datei wird heruntergeladen. **PDF drucken** öffnet den
   Druckdialog; dort „Als PDF speichern“ wählen.

> **Hinweis Datenschutz:** Es werden keinerlei Daten an Server
> gesendet. Die App funktioniert komplett offline, sobald sie einmal
> geladen wurde (Service Worker).

---

## Lokal starten

Da der Service Worker `https://` oder `http://` voraussetzt, reicht
ein einfacher statischer Server:

```bash
# Python 3
cd fahrtenbuch
python3 -m http.server 8080
# dann im Browser öffnen: http://localhost:8080
```

Alternativ:

```bash
# Node (npx, ohne Installation)
npx --yes http-server fahrtenbuch -p 8080
```

Die App kann auch ohne Server per `file://` geöffnet werden – in dem
Fall wird der Service Worker nicht registriert (Browser-Limit), die
App funktioniert sonst aber normal.

---

## Installation auf dem Handy

- **Android (Chrome):** Menü → „Zum Startbildschirm hinzufügen“.
- **iOS (Safari):** Teilen-Button → „Zum Home-Bildschirm“.

---

## Datenstruktur (localStorage)

```js
// key: "settings"
{
  tariffEurPerKm: 0.30,   // €/km
  forwardKm: 12.5,         // Hin (Wohnung → Lager)
  returnKm:  12.5,         // Rück (Lager → Wohnung)
  version: 1
}

// key: "trips"  – Array
[{
  id: "uuid",
  date: "2026-06-06",
  direction: "forward" | "return",
  km: 12.5,
  tariffEurPerKm: 0.30,   // SNAPSHOT
  amountEur: 3.75,         // km * tariffEurPerKm, gerundet
  note: "Kundenbesuch Müller",
  createdAt: "2026-06-06T13:00:00.000Z"
}]
```

---

## Bekannte Limitierungen

- Daten liegen nur in **einem** Browser-Profil. Browser-Daten löschen
  ⇒ Daten weg. Für Backup regelmäßig CSV exportieren.
- Kein Cloud-Sync (bewusst, wegen „lokale Daten“).
- Service Worker nur über `http(s)://`, nicht über `file://`.
- Sehr große Datenmengen (viele tausend Fahrten) können an die
  `localStorage`-Quota (typisch 5 MB) stoßen.

---

## Verzeichnisstruktur

```
fahrtenbuch/
├── index.html
├── app.js
├── styles.css
├── manifest.webmanifest
├── sw.js
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── README.md
└── deliverable.md
```

---

## Lizenz

Privat, persönlicher Gebrauch.
