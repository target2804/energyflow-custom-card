# EnergyFlow Custom Card

Modulare Energiefluss-Karte für Home Assistant im Stil der Power Flow Card Plus – mit **beliebig vielen elektrisch getrennten Stromkreisen** (jeweils eigener Zähler), optionaler PV, Geräten und frei wählbaren Bereichen unter dem Diagramm. Die Karte hat einen **visuellen Editor** im Stil der Power Flow Card Plus (Übersicht mit Link-Zeilen, Unterseiten mit Zurück-Pfeil, Farbwähler), YAML ist nicht nötig.

## Installation über HACS
1. HACS → Benutzerdefinierte Repositories → `https://github.com/target2804/energyflow-custom-card` → Typ **Dashboard**
2. **EnergyFlow Custom Card** suchen, herunterladen, Browser-Cache leeren (Strg+Shift+R).
3. Karte hinzufügen → „EnergyFlow Custom Card“ → Editor nutzen.

## Aufbau

### Stromkreise
Jeder Stromkreis besteht aus:

| Knoten | Pflicht | Inhalt |
|---|---|---|
| **Netz** | ja | Leistungssensor (positiv = Bezug, negativ = Einspeisung), Name, Icon, Farbe, Zählerstand (kWh), optional Vorzeichen umkehren |
| **PV-Anlage** | nein | Leistungssensor, Name, Icon, Farbe. Mit PV entsteht das Dreieck PV – Netz – Haus, inklusive Einspeise-Leitung |
| **Haus / Verbraucher** | ja | Leistungssensor (leer = wird aus PV + Netz berechnet), Name, Icon, Farbe |
| **Gerät** | nein | z. B. Auto/Wallbox: Leistungssensor, Name, Icon, Farbe, Ladestand (%) |

Ein Stromkreis **ohne PV** wird als einfache Reihe *Netz → Haus → Gerät* gezeichnet (z. B. Wärmepumpe mit eigenem Zähler). Es gibt keine Verbindung zwischen Stromkreisen: PV wird nur dem eigenen Stromkreis zugeordnet.

### Bereiche unter dem Diagramm
- **Stromkreis-Bereich:** Titel, Icon, Farbe, Anzeige von Leistung/Zählerstand, Verteilungsbalken und beliebig viele **Zeilen**.
  Jede Zeile hat eine Quelle: *eigener Sensor*, *Haus-Gesamt*, *Gerät* oder *Rest (Haus minus Gerät)*, dazu optional Status-Sensor und Energie-Sensor (kWh gesamt).
- **PV & Bilanz:** PV-Produktion, Einspeisung, Eigenverbrauchsquote, Autarkiegrad (jeweils ein-/ausblendbar).

## Beispiel (YAML)
```yaml
type: custom:energyflow-custom-card
circuits:
  - name: Hausstrom
    grid:
      entity: sensor.house_grid_power
      name: Netz Haus
      meter_reading: sensor.house_grid_energy_total
    solar:
      enabled: true
      entity: sensor.pv_power
      name: PV-Produktion
    home:
      entity: sensor.house_power
      name: Haus
    device:
      enabled: true
      entity: sensor.wallbox_power
      name: Auto
      soc: sensor.car_battery_level
  - name: Wärmestrom
    grid:
      entity: sensor.heatpump_grid_power
      name: Netz WP
      meter_reading: sensor.heatpump_grid_energy_total
    home:
      name: Wärmepumpe
      icon: mdi:heat-pump
      color: violet
panels:
  - type: circuit
    circuit: 0
    title: Hausstrom
    icon: mdi:home-lightning-bolt
    color: orange
    rows:
      - { source: remainder, name: Hausverbrauch, icon: mdi:home, color: blue }
      - { source: device, name: Wallbox, icon: mdi:car, color: green }
      - { source: entity, entity: sensor.kitchen_plug_power, name: Küche, color: teal }
  - type: circuit
    circuit: 1
    title: Wärmestrom
    icon: mdi:heat-pump
    color: violet
    show_bar: false
    rows:
      - source: entity
        name: Kompressor
        icon: mdi:heat-pump
        status_entity: sensor.heatpump_compressor_status
        energy_entity: sensor.heatpump_compressor_energy_total
  - type: balance
    circuit: 0
    title: PV & Bilanz
    hint: Hausstromkreis
```
Farben: Farbwähler im Editor (gespeichert als `[r, g, b]`), in YAML zusätzlich `orange`, `yellow`, `blue`, `violet`, `green`, `teal`, `red`, `grey` oder ein Hex-Wert (`"#23a9aa"`).

## Hinweise
- Leistungssensoren akzeptieren `W` und `kW`, Zählerstände `Wh` und `kWh`.
- Klick auf einen Kreis oder eine Zeile öffnet den Dialog des Sensors.
- Die Karte erkennt Konfigurationen aus v0.1–v0.5 (`house`, `heat_pump`, `ev`, `consumers`) und übernimmt sie automatisch. Beim ersten Speichern im Editor wird das neue Format geschrieben.
- Releases entstehen automatisch: Bei jeder Änderung der JS-Datei legt ein GitHub-Workflow ein Release mit der Versionsnummer aus der ersten Zeile der Datei an.

## Lizenz
MIT.
