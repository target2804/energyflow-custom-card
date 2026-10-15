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
- First prototype v0.1.0: fixed layout with flowing SVG indicators. Visual editor, exact mimicry of the mockup, configurable animations and comprehensive test coverage are not implemented yet.

## License
MIT.
