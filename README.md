# EnergyFlow Custom Card

Custom Home Assistant Lovelace card for **two electrically separate meters**: a house circuit with solar PV and EV charging, plus a heat-pump circuit **without PV**.

## Installation via HACS
1. HACS → custom repositories → `https://github.com/target2804/energyflow-custom-card` → type **Dashboard**
2. Find **EnergyFlow Custom Card**, download it and reload the browser.
3. Add a manual card using the configuration below. The resource should be registered automatically as `/hacsfiles/energyflow-custom-card/energyflow-custom-card.js` (JavaScript module).

## Configuration
```yaml
type: custom:energyflow-custom-card
title: Energiefluss
house:
  grid: sensor.wattwachter_energy_now
  solar: sensor.solax_pv_power_total
  total: sensor.hausverbrauch_aktuell
  # meter_reading: sensor.DEIN_HAUSZAEHLER_KWH
ev:
  power: sensor.evcc_daheimladen_smart_pro_charge_power
  soc: sensor.az_b_489_state_of_charge
heat_pump:
  power: sensor.wattwachter_2_energy_now
  compressor_status: sensor.buderus_gateway_101730536_kompressorstatus
  heater_status: sensor.buderus_gateway_101730536_heizstabstatus
  compressor_energy: sensor.buderus_gateway_101730536_stromverbrauch_warmepumpe_gesamt
  heater_energy: sensor.buderus_gateway_101730536_stromverbrauch_elektrischer_zuheizer_gesamt
  # meter_reading: sensor.DEIN_WP_ZAEHLER_KWH
consumers:
  - entity: sensor.steckdose_kueche_power
    name: Kühlschrank
    color: "#23a9aa"
  - entity: sensor.steckdose_hwr_power
    name: Waschmaschine
    color: "#d84a79"
```

## Notes
- Power sensors accept `W` and `kW`; cumulative meter readings accept `Wh` and `kWh`.
- House grid power must follow the Home Assistant sign convention: **positive = import, negative = export**.
- The heat pump circuit is **never** fed from solar and is **never** included in house meter totals.
- House usage is taken from `house.total`; if omitted it is derived as solar + signed grid.
- The house-without-EV row is derived by subtracting EV power from the house total. Additional consumers are shown informationally and are not added twice.
- Click a live sensor for the Home Assistant more-info dialog.
- Blank meter readings are intentional until real kWh entity IDs are configured.
- Prototype v0.2: improved diagram geometry, larger typography, WP meter details and semicircular autonomy/self-consumption gauges. Visual editor, pixel-perfect mockup matching, configurable animations and comprehensive test coverage are not implemented yet.

## License
MIT.

## Wärmestrom-Anzeige
Die Zeilen Kompressor und Heizstab zeigen ihren Betriebszustand und den jeweiligen kumulierten Energieverbrauch (kWh). Die vier Buderus-Entitäten sind im Code vorgegeben und per YAML überschreibbar. Live-Leistungen in Watt erscheinen nur bei Angabe der optionalen Felder `heat_pump.compressor_power` und `heat_pump.heater_power`; Gesamt-kWh-Werte sind keine Live-Leistung.

Stand v0.5.4: Fix für "Konfigurationsfehler" – HA setzt `layout` auf Karten-Elementen, die interne Methode heißt jetzt `_geom()`.

Stand v0.5.3: Render-Fehler werden in der Karte mit Meldung angezeigt statt als "Konfigurationsfehler".

Stand v0.5.2: Kreise und SVG-Linien nutzen jetzt ein gemeinsames Pixel-Koordinatensystem (viewBox = gemessene Kartenbreite, keine verzerrende Skalierung). Alle Positionen werden zentral in `_geom()` definiert. Violette (PV → Netz Haus) und orange (PV → Haus) Leitung starten an getrennten Punkten links/rechts der PV-Mitte, laufen senkrecht nach unten und biegen mit sanftem Radius ab; die blaue Netzlinie ist durchgehend horizontal. Flow-Punkte laufen entlang der echten Pfade, inaktive Leitungen werden abgedimmt.
