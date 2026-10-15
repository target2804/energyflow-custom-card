/* EnergyFlow Custom Card — v0.10.1
 * Modular energy flow card: any number of electrically separate circuits
 * (each with its own grid meter, optional PV, a "home" node and an optional device),
 * plus freely configurable detail panels. Visual editor included.
 *
 * Flow geometry: circles and SVG paths share ONE pixel coordinate system.
 * The flow area is measured (ResizeObserver), all positions are derived from
 * _geom(), and the SVG viewBox equals the real pixel size (no distortion).
 *
 * NOTE: never name methods like properties Home Assistant sets on card elements
 * (e.g. "layout", "preview", "hass"), they would be shadowed.
 */

const EF_VERSION = "0.10.1";
const EF_TYPE = "custom:energyflow-custom-card";
const EF_EXPORT_COLOR = "#a66add";
const EF_PALETTE = {orange:"#e9a219",yellow:"#f0ba27",blue:"#329af0",violet:"#b184e5",green:"#24a85a",teal:"#23a9aa",red:"#e0556b",grey:"#8b92a5"};
const efColor = (v, d) => {
  if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(n => Number.isFinite(Number(n)))) return "rgb(" + v.slice(0, 3).map(n => Math.max(0, Math.min(255, Math.round(Number(n))))).join(",") + ")";
  return EF_PALETTE[v] || (/^#[0-9a-f]{3,8}$/i.test(String(v || "")) ? v : (EF_PALETTE[d] || d));
};
/* any colour value (palette name, hex or [r,g,b]) -> [r,g,b] for the editor's colour picker */
const efToRgb = (v, d) => {
  if (Array.isArray(v) && v.length >= 3) return v.slice(0, 3).map(Number);
  let hex = EF_PALETTE[v] || (/^#[0-9a-f]{3,6}$/i.test(String(v || "")) ? v : (EF_PALETTE[d] || d));
  hex = String(hex).replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
};

/* ---------- Config helpers (shared by card and editor) ---------- */

function efIsLegacy(cfg) {
  return !!cfg && !Array.isArray(cfg.circuits) && !!(cfg.house || cfg.heat_pump || cfg.ev);
}

/* Converts the config format of v0.1–v0.5 (house / heat_pump / ev / consumers) to the modular format.
 * Only values that were configured are carried over; nothing installation-specific is hardcoded. */
function efMigrateLegacy(cfg) {
  const h = cfg.house || {}, wp = cfg.heat_pump || {}, e = cfg.ev || {};
  const clean = o => { Object.keys(o).forEach(k => { if (o[k] === undefined || o[k] === "") delete o[k]; }); return o; };
  const circuits = [{
    name: "Hausstrom",
    grid: clean({entity: h.grid, name: "Netz Haus", meter_reading: h.meter_reading}),
    solar: clean({enabled: true, entity: h.solar, name: "PV-Produktion"}),
    home: clean({entity: h.total, name: "Haus"}),
    device: clean({enabled: !!e.power, entity: e.power, name: "Auto", soc: e.soc})
  }, {
    name: "Wärmestrom",
    grid: clean({entity: wp.power, name: "Netz WP", meter_reading: wp.meter_reading}),
    home: clean({entity: wp.power, name: "Wärmepumpe", icon: "mdi:heat-pump", color: "red"})
  }];
  const consumers = (Array.isArray(cfg.consumers) ? cfg.consumers : []).map(x => clean({
    source: "entity", entity: x.entity, name: x.name || x.entity, icon: x.icon || "mdi:flash",
    color: "#" + String(x.color || "9c80d4").replace(/^#/, "")
  }));
  const panels = [
    {type: "circuit", circuit: 0, title: "Hausstrom", icon: "mdi:home-lightning-bolt", color: "orange", rows: [
      {source: "remainder", name: "Hausverbrauch", icon: "mdi:home", color: "#349ce9", in_bar: true},
      {source: "device", name: "Wallbox", icon: "mdi:car", color: "#23985c", in_bar: true}, ...consumers]},
    {type: "circuit", circuit: 1, title: "Wärmestrom", icon: "mdi:heat-pump", color: "red", show_bar: false, rows: [
      clean({source: "entity", entity: wp.compressor_power, name: "Kompressor", icon: "mdi:heat-pump", color: "red",
        status_entity: wp.compressor_status,
        energy_entity: wp.compressor_energy}),
      clean({source: "entity", entity: wp.heater_power, name: "Heizstab", icon: "mdi:radiator", color: "red",
        status_entity: wp.heater_status,
        energy_entity: wp.heater_energy})]},
    {type: "balance", circuit: 0, title: "PV & Bilanz", icon: "mdi:solar-power"}
  ];
  return {type: cfg.type || EF_TYPE, circuits, panels};
}

function efDefaultConfig() {
  return {
    type: EF_TYPE,
    circuits: [{name: "Hausstrom", grid: {name: "Netz"}, solar: {enabled: true, name: "PV-Produktion"}, home: {name: "Haus"}, device: {enabled: false, name: "Auto"}}],
    panels: [
      {type: "circuit", circuit: 0, title: "Hausstrom", icon: "mdi:home-lightning-bolt", color: "orange", rows: [{source: "remainder", name: "Hausverbrauch", icon: "mdi:home", color: "blue", in_bar: true}]},
      {type: "balance", circuit: 0, title: "PV & Bilanz", icon: "mdi:solar-power"}
    ]
  };
}

function efNormalize(cfg) {
  let n;
  if (efIsLegacy(cfg)) n = efMigrateLegacy(cfg);
  else n = JSON.parse(JSON.stringify(cfg || {}));
  if (!n.type) n.type = EF_TYPE;
  if (!Array.isArray(n.circuits)) n.circuits = efIsLegacy(cfg) ? n.circuits : efDefaultConfig().circuits;
  if (!Array.isArray(n.panels)) n.panels = [];
  return n;
}

/* ====================================================================== */
/*  Card                                                                  */
/* ====================================================================== */

class EnergyFlowCustomCard extends HTMLElement {
  static getConfigElement() { return document.createElement("energyflow-custom-card-editor"); }
  static getStubConfig() { return efDefaultConfig(); }
  setConfig(config) {
    if (!config) throw new Error("Ungültige Konfiguration");
    this.config = efNormalize(config);
    this._svgKey = null;
    this.render();
  }
  set hass(value) { this._hass = value; if (this.config) this.render(); }
  connectedCallback() {
    if (!this._ro && window.ResizeObserver) {
      this._ro = new ResizeObserver(entries => { const w = Math.round(entries[0].contentRect.width); if (w > 0 && w !== this._w) { this._w = w; if (this.config) this.render(); } });
    }
    if (this._ro && this._flow) this._ro.observe(this._flow);
  }
  disconnectedCallback() { if (this._ro) this._ro.disconnect(); }
  getCardSize() { return 4 + (this.config?.circuits?.length || 1) * 3; }
  getGridOptions() { return {columns: 12, min_columns: 6}; }

  state(id) { return id && this._hass?.states?.[id]; }
  val(id) { const s = this.state(id); if (!s || ["unknown", "unavailable"].includes(s.state)) return null; const n = Number(String(s.state).replace(",", ".")); return Number.isFinite(n) ? n : null; }
  watts(id) { const v = this.val(id); if (v === null) return null; const u = (this.state(id)?.attributes?.unit_of_measurement || "W").toLowerCase(); return u === "kw" ? v * 1000 : v; }
  kwh(id) { const v = this.val(id); if (v === null) return null; const u = (this.state(id)?.attributes?.unit_of_measurement || "kWh").toLowerCase(); return u === "wh" ? v / 1000 : v; }
  _num(key, d) { const n = Number(this.config && this.config[key]); return this.config && this.config[key] !== undefined && this.config[key] !== "" && Number.isFinite(n) ? n : d; }
  fmt(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "–";
    const th = this._num("kilo_threshold", 1000), bd = this._num("base_decimals", 0), kd = this._num("kilo_decimals", 2);
    return Math.abs(v) >= th ? (v / 1000).toLocaleString("de-DE", {maximumFractionDigits: kd}) + " kW" : v.toLocaleString("de-DE", {maximumFractionDigits: bd}) + " W";
  }
  fmtKwh(v) { return v === null || v === undefined ? "–" : v.toLocaleString("de-DE", {maximumFractionDigits: 1}) + " kWh"; }
  esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c])); }
  click(id) { if (!id || this.config.clickable_entities === false) return; this.dispatchEvent(new CustomEvent("hass-more-info", {bubbles: true, composed: true, detail: {entityId: id}})); }

  /* ---------- resolved circuit (config + live values) ---------- */
  _circuit(c, i) {
    const g = c.grid || {}, s = c.solar || {}, hm = c.home || {}, d = c.device || {}, bt = c.battery || {};
    const hasSolar = s.enabled !== undefined ? !!s.enabled : !!s.entity;
    const hasDev = d.enabled !== undefined ? !!d.enabled : !!d.entity;
    const hasBat = bt.enabled !== undefined ? !!bt.enabled : !!bt.entity;
    const sign = g.invert ? -1 : 1;
    const gridRaw = this.watts(g.entity);
    const gridW = gridRaw === null ? null : gridRaw * sign;
    const solarW = hasSolar ? this.watts(s.entity) : null;
    const batRaw = hasBat ? this.watts(bt.entity) : null;
    const batW = batRaw === null ? null : batRaw * (bt.invert ? -1 : 1);   // positive = discharging, negative = charging
    let homeW = hm.entity ? this.watts(hm.entity) : null;
    if (homeW === null && !hm.entity) {
      if (hasSolar) homeW = solarW !== null && gridW !== null ? Math.max(0, solarW + gridW + (batW || 0)) : null;
      else homeW = gridW !== null ? Math.max(0, gridW) : null;
    }
    const devW = hasDev ? this.watts(d.entity) : null;
    const pvUse = hasSolar && solarW !== null && gridW !== null ? Math.max(0, solarW - Math.max(0, -gridW)) : null;
    const own = solarW > 0 && pvUse !== null ? Math.min(100, Math.round(pvUse / solarW * 100)) : null;
    const autarky = homeW > 0 && pvUse !== null ? Math.min(100, Math.round(pvUse / homeW * 100)) : null;
    return {
      i, name: c.name || ("Stromkreis " + (i + 1)), hasSolar, hasDev, hasBat, batW, gridW, solarW, homeW, devW, pvUse, own, autarky,
      devSoc: d.soc ? this.val(d.soc) : null,
      batSoc: bt.soc ? this.val(bt.soc) : null,
      grid: {entity: g.entity, display_state: g.display_state || "two_way", name: g.name || "Netz", icon: g.icon || "mdi:transmission-tower", color: efColor(g.color, "blue"), meter: g.meter_reading},
      solar: {entity: s.entity, name: s.name || "PV-Produktion", icon: s.icon || "mdi:solar-power", color: efColor(s.color, "orange")},
      home: {entity: hm.entity, name: hm.name || "Haus", icon: hm.icon || "mdi:home", color: efColor(hm.color, "orange")},
      device: {entity: d.entity, name: d.name || "Gerät", icon: d.icon || "mdi:car", color: efColor(d.color, "green")},
      battery: {entity: bt.entity, name: bt.name || "Batterie", icon: bt.icon || "mdi:battery-high", color: efColor(bt.color, "teal")}
    };
  }

  /* ---------- Layout constants (pixels in the flow area) ----------
   * Proportions follow Power Flow Card Plus: 80 px circles. A circuit with PV gets the classic
   * triangle (PV top centre, grid left, home right, device above home); a circuit without PV is a
   * single row (grid - home - device). Circuits are stacked with a clear gap. */
  _geom(W, cs) {
    const R = W < 400 ? 36 : 40;
    const L = {W, R, blocks: []};
    const xL = R + 12, xC = W / 2, xR = W - R - 12;
    let y = 0;
    cs.forEach((c, i) => {
      let b;
      if (c.hasSolar) {
        const yTop = y + R + 24, yMid = yTop + Math.round(R * 2.8);
        b = {xL, xC, xR, yTop, yMid, bottom: yMid + R + 28};
      } else {
        const yMid = y + R + 6;
        b = {xL, xC, xR, yTop: yMid, yMid, bottom: yMid + R + 28};
      }
      b.R = R;
      if (c.hasBat) {   // battery hangs below the grid-home line, joined by a short vertical branch
        b.xBat = c.hasSolar || !c.hasDev ? xC : Math.round((xL + xC) / 2);
        b.yBat = b.yMid + Math.round(R * (c.hasSolar || !c.hasDev ? 2.3 : 2.9));   // with PV-less device row the home label sits next to the branch
        b.bottom = b.yBat + R + 28;
      }
      L.blocks.push(b);
      y = b.bottom + (i < cs.length - 1 ? 36 : 0);
    });
    L.H = y;
    L.dx = Math.round(R * 0.45);   // PV connection offset from PV centre (x)
    L.dy = Math.round(R * 0.38);   // branch line offset above grid/home centre (y)
    return L;
  }
  /* Vertical leg, quarter-circle bend, horizontal leg: (sx,sy) -> (ex,ey). */
  _elbow(sx, sy, ex, ey) {
    const dir = Math.sign(ex - sx) || 1, v = ey - sy, h = Math.abs(ex - sx);
    const r = Math.max(0, Math.min(v, h - 8)), k = 0.5523 * r, y1 = ey - r, f = n => Math.round(n * 10) / 10;
    return {d: "M" + f(sx) + " " + f(sy) + " V" + f(y1) + " C" + f(sx) + " " + f(y1 + k) + " " + f(sx + dir * (r - k)) + " " + f(ey) + " " + f(sx + dir * r) + " " + f(ey) + " H" + f(ex),
      len: (v - r) + (h - r) + Math.PI * r / 2};
  }
  _flowItems(L, cs) {
    const wires = [], nodes = [], R = L.R, MIN = 5, f = n => Math.round(n * 10) / 10;
    const line = (x1, y1, x2, y2) => ({d: "M" + f(x1) + " " + f(y1) + " L" + f(x2) + " " + f(y2), len: Math.hypot(x2 - x1, y2 - y1)});
    const fmtAbs = v => this.fmt(v === null ? null : Math.abs(v));
    /* like Power Flow Card Plus "two_way": both directions are always shown, each in its own colour */
    const gridLines = c => {
      const mode = c.grid.display_state, w = c.gridW;
      const out = [], imp = {text: "→ " + this.fmt(w === null ? null : Math.max(0, w)), color: c.grid.color}, exp = {text: "← " + this.fmt(w === null ? null : Math.max(0, -w)), color: EF_EXPORT_COLOR};
      if (mode === "one_way") return [imp];
      if (mode === "one_way_reverse") return [exp];
      return [exp, imp];
    };
    cs.forEach((c, i) => {
      const b = L.blocks[i], {xL, xC, xR, yTop, yMid} = b;
      if (c.hasSolar) {
        const pvY = yTop + Math.sqrt(R * R - L.dx * L.dx), sideX = Math.sqrt(R * R - L.dy * L.dy);
        wires.push({...line(xL + R, yMid, xR - R, yMid), color: c.grid.color, active: c.gridW !== null && c.gridW > MIN});
        wires.push({...this._elbow(xC - L.dx, pvY, xL + sideX, yMid - L.dy), color: EF_EXPORT_COLOR, active: c.gridW !== null && -c.gridW > MIN});
        wires.push({...this._elbow(xC + L.dx, pvY, xR - sideX, yMid - L.dy), color: c.solar.color, active: c.pvUse !== null && c.pvUse > MIN});
        if (c.hasDev) wires.push({...line(xR, yMid - R, xR, yTop + R), color: c.device.color, active: c.devW !== null && c.devW > MIN});
        this._battery(c, b, wires, nodes, line, MIN);
        const exporting = c.gridW !== null && c.gridW < 0;
        nodes.push({x: xC, y: yTop, pos: "above", name: c.solar.name, value: this.fmt(c.solarW), icon: c.solar.icon, color: c.solar.color, entity: c.solar.entity});
        nodes.push({x: xL, y: yMid, pos: "below", name: c.grid.name, lines: gridLines(c), icon: c.grid.icon, color: exporting ? EF_EXPORT_COLOR : c.grid.color, entity: c.grid.entity});
        nodes.push({x: xR, y: yMid, pos: "below", name: c.home.name, value: this.fmt(c.homeW), icon: c.home.icon, color: c.home.color, entity: c.home.entity});
        if (c.hasDev) nodes.push({x: xR, y: yTop, pos: "above", name: c.device.name, value: this.fmt(c.devW), icon: c.device.icon, color: c.device.color, entity: c.device.entity, extra: c.devSoc === null ? "" : Math.round(c.devSoc) + " %"});
      } else {
        const flow = c.gridW !== null ? c.gridW : c.homeW;
        const hx = c.hasDev ? xC : xR;   // without device the home circle sits on the right, in line with circuits that have PV
        wires.push({...line(xL + R, yMid, hx - R, yMid), color: c.home.color, active: flow !== null && flow > MIN});
        if (c.hasDev) wires.push({...line(xC + R, yMid, xR - R, yMid), color: c.device.color, active: c.devW !== null && c.devW > MIN});
        this._battery(c, b, wires, nodes, line, MIN);
        nodes.push({x: xL, y: yMid, pos: "below", name: c.grid.name, lines: gridLines(c), icon: c.grid.icon, color: c.gridW !== null && c.gridW < 0 ? EF_EXPORT_COLOR : c.grid.color, entity: c.grid.entity});
        nodes.push({x: hx, y: yMid, pos: "below", name: c.home.name, value: this.fmt(c.homeW), icon: c.home.icon, color: c.home.color, entity: c.home.entity});
        if (c.hasDev) nodes.push({x: xR, y: yMid, pos: "below", name: c.device.name, value: this.fmt(c.devW), icon: c.device.icon, color: c.device.color, entity: c.device.entity, extra: c.devSoc === null ? "" : Math.round(c.devSoc) + " %"});
      }
    });
    return {wires, nodes};
  }

  _battery(c, b, wires, nodes, line, MIN) {
    if (!c.hasBat) return;
    const w = c.batW, charging = w !== null && w < -MIN, discharging = w !== null && w > MIN;
    const top = line(b.xBat, b.yMid, b.xBat, b.yBat - b.R);
    const rev = line(b.xBat, b.yBat - b.R, b.xBat, b.yMid);
    wires.push({...(discharging ? rev : top), color: c.battery.color, active: charging || discharging});
    nodes.push({x: b.xBat, y: b.yBat, pos: "below", name: c.battery.name, value: this.fmt(w === null ? null : Math.abs(w)), icon: c.battery.icon, color: c.battery.color, entity: c.battery.entity,
      extra: c.batSoc === null ? "" : Math.round(c.batSoc) + " %"});
  }

  ensureSkeleton() {
    if (this._flow) return;
    if (!this.shadowRoot) this.attachShadow({mode: "open"});
    this.shadowRoot.innerHTML = '<style>' + this.css() + '</style><ha-card><div class="card-title"></div><div class="flow-layout"><svg class="flow-wires" aria-hidden="true"></svg><div class="flow-nodes"></div></div><div class="panels"></div></ha-card>';
    this._flow = this.shadowRoot.querySelector(".flow-layout");
    this._title = this.shadowRoot.querySelector(".card-title");
    this._card = this.shadowRoot.querySelector("ha-card");
    this._svg = this.shadowRoot.querySelector(".flow-wires");
    this._nodes = this.shadowRoot.querySelector(".flow-nodes");
    this._panels = this.shadowRoot.querySelector(".panels");
    const card = this.shadowRoot.querySelector("ha-card");
    const pick = ev => ev.composedPath().find(el => el.getAttribute && el.getAttribute("data-e"));
    card.addEventListener("click", ev => { const el = pick(ev); if (el) this.click(el.getAttribute("data-e")); });
    card.addEventListener("keydown", ev => { if (ev.key !== "Enter") return; const el = pick(ev); if (el) this.click(el.getAttribute("data-e")); });
    if (this._ro && this.isConnected) this._ro.observe(this._flow);
  }

  render() {
    if (!this.config) return;
    try { this._render(); }
    catch (err) {   // never let a render problem become a HA "Konfigurationsfehler": show the real message instead
      console.error("EnergyFlow Custom Card:", err);
      if (!this.shadowRoot) this.attachShadow({mode: "open"});
      this._flow = null; this._svgKey = null;
      this.shadowRoot.innerHTML = '<ha-card style="display:block;padding:16px"><strong>EnergyFlow Custom Card – Fehler</strong><pre style="white-space:pre-wrap;font-size:12px;margin:8px 0 0">' + this.esc(err && err.stack ? err.stack : String(err)) + '</pre></ha-card>';
    }
  }

  _render() {
    this.ensureSkeleton();
    const c = this.config, st = c.style_ha_card && typeof c.style_ha_card === "object" ? c.style_ha_card : {};
    this._title.textContent = c.title || ""; this._title.style.display = c.title ? "block" : "none";
    this._card.style.cssText = Object.keys(st).map(k => k + ":" + st[k]).join(";");   // same idea as Power Flow Card Plus' style_ha_card
    this._card.classList.toggle("no-labels", !!c.no_labels);
    this._panels.classList.toggle("side", !!c.panels_side_by_side);
    this._card.classList.toggle("no-click", c.clickable_entities === false);
    if (!this._w && this._flow.clientWidth) this._w = this._flow.clientWidth;
    const cs = (this.config.circuits || []).map((c, i) => this._circuit(c, i));
    if (!cs.length) {
      this._flow.style.height = "auto"; this._svg.innerHTML = "";
      this._nodes.innerHTML = '<div class="empty">Noch kein Stromkreis konfiguriert – Karte bearbeiten.</div>';
      this._panels.innerHTML = ""; return;
    }
    const L = this._geom(this._w || 470, cs), F = this._flowItems(L, cs);
    this._flow.style.height = L.H + "px";
    this._flow.classList.toggle("compact", L.R < 40);
    const key = JSON.stringify([L.W, L.H, F.wires.map(w => [w.d, w.color, w.active])]);
    if (key !== this._svgKey) {   // rebuild SVG only on geometry/activity change, so dots keep moving smoothly
      this._svgKey = key;
      this._svg.setAttribute("viewBox", "0 0 " + L.W + " " + L.H);
      this._svg.innerHTML =
        F.wires.map(w => '<path class="wire' + (w.active ? "" : " idle") + '" style="stroke:' + w.color + '" d="' + w.d + '"/>').join("") +
        (this.config.disable_dots ? [] : F.wires.filter(w => w.active)).map(w => '<circle r="4.5" style="fill:' + w.color + '"><animateMotion dur="' + Math.max(1.6, w.len / 70).toFixed(2) + 's" repeatCount="indefinite" path="' + w.d + '"/></circle>').join("");
    }
    this._nodes.innerHTML = F.nodes.map(n =>
      '<div class="flow-node" style="left:' + n.x + 'px;top:' + n.y + 'px;--node-color:' + n.color + ';--d:' + (L.R * 2) + 'px" data-e="' + this.esc(n.entity || "") + '"' + (n.entity ? ' tabindex="0" role="button"' : "") + '>' +
      (n.extra ? '<span class="node-extra">' + this.esc(n.extra) + '</span>' : "") +
      this.ico(n.icon, n.color) + (n.lines ? n.lines.map(l => '<strong class="ln" style="color:' + l.color + '">' + this.esc(l.text) + '</strong>').join('') : '<strong>' + this.esc(n.value) + '</strong>') + '<span class="flow-label ' + n.pos + '">' + this.esc(n.name) + '</span></div>').join("");
    this._panels.innerHTML = this._panelsHtml(cs);
  }

  ico(name, color) { return '<ha-icon icon="' + this.esc(name) + '" style="color:' + color + ';--mdc-icon-size:25px"></ha-icon>'; }

  /* ---------- Panels below the diagram ---------- */
  _panelsHtml(cs) {
    const panels = Array.isArray(this.config.panels) ? this.config.panels : [];
    const out = []; let pending = [];
    const flush = () => { if (pending.length) { out.push('<div class="meters">' + pending.join("") + '</div>'); pending = []; } };
    panels.forEach(p => {
      const c = cs[Number(p.circuit) || 0] || cs[0];
      if (!c) return;
      if (p.type === "balance") { flush(); out.push(this._balanceHtml(p, c)); }
      else pending.push(this._circuitPanelHtml(p, c));
    });
    flush();
    return out.join("");
  }

  _statusLabel(id) {
    const raw = this.state(id)?.state;
    if (!raw || ["unknown", "unavailable"].includes(raw)) return "–";
    return ({off: "Aus", on: "An", heating: "Heizen", cooling: "Kühlen", dhw: "Warmwasser", defrost: "Abtauen", alarm: "Störung", pool: "Pool", pool_heat: "Pool heizen"}[raw] || raw);
  }

  _rowData(r, c) {
    const src = r.source || "entity";
    let power = null, showPower = true, entity = r.entity || "", name = r.name, icon = r.icon, def = "mdi:flash";
    if (src === "home") { power = c.homeW; entity = r.entity || c.home.entity || ""; name = name || c.home.name; def = c.home.icon; }
    else if (src === "device") { power = c.devW; entity = r.entity || c.device.entity || ""; name = name || c.device.name; def = c.device.icon; }
    else if (src === "battery") { power = c.batW === null ? null : Math.abs(c.batW); entity = r.entity || c.battery.entity || ""; name = name || c.battery.name; def = c.battery.icon; }
    else if (src === "remainder") { power = c.homeW !== null ? Math.max(0, c.homeW - (c.devW || 0)) : null; name = name || "Verbrauch"; def = "mdi:home"; }
    else { power = r.entity ? this.watts(r.entity) : null; showPower = !!r.entity; name = name || this.state(r.entity)?.attributes?.friendly_name || r.entity || "Zeile"; }
    const inBar = r.in_bar !== undefined ? !!r.in_bar : (src === "remainder" || src === "device");
    return {src, power, showPower, entity, name, icon: icon || def, color: efColor(r.color, "violet"), inBar,
      status: r.status_entity, energy: r.energy_entity};
  }

  _circuitPanelHtml(p, c) {
    const color = efColor(p.color, "orange");
    const rows = (Array.isArray(p.rows) ? p.rows : []).map(r => this._rowData(r, c));
    let html = '<section class="panel"><h3>' + this.ico(p.icon || "mdi:flash", color) + " " + this.esc(p.title || c.name) + "</h3>";
    if (p.show_meter !== false) {
      html += '<div class="metric"><span>Aktuelle Leistung<strong>' + this.fmt(c.homeW) + '</strong></span><span>Zählerstand<strong>' + this.fmtKwh(this.kwh(c.grid.meter)) + "</strong></span></div>";
    }
    if (p.show_bar !== false) {
      const total = c.homeW;
      const segs = rows.filter(r => r.inBar && r.power !== null && total > 0).map(r => '<i style="width:' + Math.min(100, Math.max(0, r.power / total * 100)) + '%;background:' + r.color + '"></i>').join("");
      if (segs) html += '<div class="stack">' + segs + "</div>";
    }
    html += rows.map(r => {
      const detail = r.status || r.energy;
      if (!detail) return '<div class="consumer" data-e="' + this.esc(r.entity) + '">' + this.ico(r.icon, r.color) + "<span>" + this.esc(r.name) + "</span>" + (r.showPower ? "<strong>" + this.fmt(r.power) + "</strong>" : "") + "</div>";
      return '<div class="wp-detail" data-e="' + this.esc(r.status || r.entity || r.energy) + '">' + this.ico(r.icon, r.color) +
        '<div class="wp-detail-main"><strong>' + this.esc(r.name) + "</strong>" + (r.status ? "<span>" + this.esc(this._statusLabel(r.status)) + "</span>" : "") + "</div>" +
        '<div class="wp-detail-values">' + (r.showPower ? "<strong>" + this.fmt(r.power) + "</strong>" : "") + (r.energy ? "<span>" + this.fmtKwh(this.kwh(r.energy)) + " gesamt</span>" : "") + "</div></div>";
    }).join("");
    return html + "</section>";
  }

  _balanceHtml(p, c) {
    const gauge = (label, percent, color) => {
      const good = Number.isFinite(percent), v = good ? Math.min(100, Math.max(0, percent)) : 0, dash = (v * 1.445).toFixed(1);
      return '<div class="gauge"><svg class="gauge-svg" lang="de" viewBox="0 0 140 85" aria-label="' + this.esc(label) + '"><path d="M15 75 A55 55 0 0 1 125 75" class="gauge-track"/><path d="M15 75 A55 55 0 0 1 125 75" class="gauge-fill" style="stroke:' + color + ';stroke-dasharray:' + dash + ' 200"/></svg><strong>' + (good ? Math.round(percent) + " %" : "–") + "</strong><span>" + label + "</span></div>";
    };
    const kpi = (label, value) => '<div class="kpi"><span>' + label + "</span><strong>" + value + "</strong></div>";
    const kpis = [], gauges = [];
    if (p.show_pv !== false) kpis.push(kpi("PV-Produktion", this.fmt(c.solarW)));
    if (p.show_feed_in !== false) kpis.push(kpi("PV-Einspeisung", this.fmt(c.gridW === null ? null : Math.max(0, -c.gridW))));
    if (p.show_own !== false) gauges.push(gauge("Eigenverbrauchsquote", c.own, "#f0ba27"));
    if (p.show_autarky !== false) gauges.push(gauge("Autarkiegrad", c.autarky, "#46c97d"));
    return '<section class="panel balance"><h3>' + this.ico(p.icon || "mdi:solar-power", efColor(p.color, "orange")) + " " + this.esc(p.title || "PV & Bilanz") + (p.hint ? ' <span class="hint">' + this.esc(p.hint) + "</span>" : "") + "</h3>" +
      (kpis.length ? '<div class="kpi-list">' + kpis.join("") + "</div>" : "") + (gauges.length ? '<div class="gauge-list">' + gauges.join("") + "</div>" : "") + "</section>";
  }

  css() { return `
    :host{display:block}*{box-sizing:border-box}
    ha-card{display:block;background:rgba(36,39,58,.72);border:1px solid rgba(202,211,245,.10);border-radius:22px;padding:16px;color:var(--primary-text-color,#fff);box-shadow:none;overflow:hidden;font-family:var(--primary-font-family,Roboto,"Arial",sans-serif)}
    h3{display:flex;align-items:center;gap:8px}
    .card-title{display:none;font-size:16px;font-weight:600;margin:0 0 12px}
    .no-labels .flow-label{display:none}.no-click .flow-node,.no-click [data-e]{cursor:default}
    .empty{padding:24px 8px;text-align:center;color:var(--secondary-text-color,#abb2c0)}
    .flow-layout{position:relative;isolation:isolate;margin:0 0 20px;width:100%}
    .flow-wires{position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;pointer-events:none;overflow:visible}
    .wire{fill:none;stroke-width:2;stroke-linecap:round;opacity:.9;transition:opacity .4s}
    .wire.idle{opacity:.22}
    .flow-node{position:absolute;z-index:1;width:var(--d);height:var(--d);transform:translate(-50%,-50%);border:2px solid var(--node-color);border-radius:50%;background:var(--card-background-color,#222530);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;line-height:1.12;cursor:pointer;text-align:center;outline:none}
    .flow-node:focus-visible{box-shadow:0 0 0 2px var(--primary-color,#03a9f4)}
    .flow-node strong{font-size:14px;white-space:nowrap;font-weight:500}.node-extra{font-size:11px;color:var(--secondary-text-color,#c8ccd9)}
    .flow-node strong.ln{font-size:12px;line-height:1.15}.compact .flow-node strong{font-size:12px}.compact .flow-node strong.ln{font-size:11px}.compact .flow-label{font-size:12px}.compact .flow-node ha-icon{--mdc-icon-size:22px!important}
    .flow-label{position:absolute;left:50%;transform:translateX(-50%);font-size:13px;line-height:1.25;white-space:nowrap;font-weight:400;color:var(--secondary-text-color,#abb2c0)}
    .flow-label.above{bottom:calc(100% + 5px)}.flow-label.below{top:calc(100% + 5px)}
    .panels{container-type:inline-size}
    .meters{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin-bottom:12px}
    .meters:last-child{margin-bottom:0}
    @container (min-width:401px){.panels.side .meters{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
    .panel{border:1px solid rgba(202,211,245,.12);border-radius:17px;padding:12px;background:rgba(15,20,35,.16);min-width:0}
    h3{font-size:15px;line-height:1.35;font-weight:600;margin:0 0 5px;overflow-wrap:normal}
    h3 ha-icon,.consumer ha-icon{flex-shrink:0}
    .hint{font-size:12px;color:var(--secondary-text-color,#abb2c0);margin:0 0 13px}
    .metric{display:flex;justify-content:space-between;text-align:left;gap:6px 14px;color:var(--secondary-text-color,#abb2c0);font-size:12px;flex-wrap:wrap}
    .metric strong{display:block;font-size:16px;color:var(--primary-text-color,#fff);margin-top:6px;white-space:nowrap}
    .stack{height:9px;background:#343b4a;border-radius:10px;display:flex;overflow:hidden;margin:14px 0 10px}
    .consumer{display:flex;align-items:center;gap:6px;font-size:12px;padding:7px 0}
    .consumer ha-icon{--mdc-icon-size:20px!important}
    .consumer span{min-width:0;flex:1}.consumer strong{margin-left:auto;text-align:right;white-space:nowrap;font-size:12px}
    .balance h3{margin-bottom:14px}.balance .hint{margin:0 0 0 auto;font-weight:400}
    .kpi-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px 16px;margin-bottom:16px}
    .kpi{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--secondary-text-color,#abb2c0)}
    .kpi strong{font-size:20px;font-weight:600;color:var(--primary-text-color,#fff)}
    .gauge-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;justify-items:center}
    .gauge{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0;width:100%;max-width:200px;position:relative}
    .gauge-svg{display:block;width:100%;height:auto;overflow:visible}
    .gauge-track,.gauge-fill{fill:none;stroke-width:14;stroke-linecap:butt}
    .gauge-track{stroke:#353d4d}.gauge-fill{stroke-dashoffset:0}
    .gauge strong{font-size:20px;position:relative;margin-top:-30px;z-index:1}
    .gauge span{font-size:13px;color:var(--secondary-text-color,#abb2c0);margin-top:8px;line-height:1.3;overflow-wrap:normal;hyphens:auto}
    .wp-detail{display:flex;align-items:center;gap:6px;padding:7px 0;min-width:0;font-size:12px}
    .wp-detail ha-icon{flex-shrink:0;--mdc-icon-size:20px!important}
    .wp-detail-main{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0;font-size:12px}
    .wp-detail-main strong{font-size:12px;font-weight:400}
    .wp-detail-main span{color:var(--secondary-text-color,#abb2c0);font-size:11px}
    .wp-detail-values{display:flex;flex-direction:column;text-align:right;gap:2px;margin-left:auto;min-width:0;flex:0 1 auto}
    .wp-detail-values strong{font-size:12px;font-weight:700}.wp-detail-values span{font-size:11px;color:var(--secondary-text-color,#abb2c0)}
    @media(max-width:460px){ha-card{padding:11px}.panel{padding:13px}}
    @media(prefers-reduced-motion:reduce){.flow-wires circle{display:none}}
  `; }
}

/* ====================================================================== */
/*  Visual editor — same navigation pattern as Power Flow Card Plus:      */
/*  overview with link rows -> sub pages (back arrow) with ha-form.       */
/* ====================================================================== */

const EF_ICONS = {
  back: "M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z",
  chevron: "M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z",
  close: "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z",
  pencil: "M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z",
  up: "M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z",
  down: "M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z",
  plus: "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"
};

const EF_LABELS = {
  name: "Name (Beschriftung)", icon: "Icon", color: "Farbe", entity: "Sensor (Leistung)", meter_reading: "Zählerstand (kWh-Sensor)",
  invert: "Vorzeichen umkehren", display_state: "Anzeige Bezug/Einspeisung", enabled: "Anzeigen", soc: "Ladestand (%-Sensor)",
  base_decimals: "Nachkommastellen (W)", kilo_decimals: "Nachkommastellen (kW)", kilo_threshold: "Umschaltung auf kW ab (W)",
  clickable_entities: "Klick öffnet Sensor-Dialog", panels_side_by_side: "Bereiche nebeneinander", disable_dots: "Bewegte Punkte ausschalten", no_labels: "Beschriftungen ausblenden",
  title: "Titel", hint: "Zusatztext (rechts)", type: "Typ", circuit: "Stromkreis", show_meter: "Leistung & Zählerstand", show_bar: "Verteilungsbalken",
  source: "Wert", status_entity: "Status-Sensor", energy_entity: "Energie gesamt (kWh-Sensor)", in_bar: "Im Verteilungsbalken",
  show_pv: "PV-Produktion", show_feed_in: "PV-Einspeisung", show_own: "Eigenverbrauchsquote", show_autarky: "Autarkiegrad"
};
const EF_ENTITY_HELPER = "Optional: leer lassen, wenn der Wert nicht angezeigt oder berechnet werden soll.";
const EF_HELPERS = {
  invert: "Netz: positiv = Bezug, negativ = Einspeisung. Batterie: positiv = Entladen, negativ = Laden. Umkehren, falls dein Sensor andersherum zählt.",
  source: "Eigener Sensor, Haus-Gesamt, Gerät oder Rest (Haus minus Gerät)."
};
const EF_NODES = {
  grid: {label: "Netz", icon: "mdi:transmission-tower", color: "blue"},
  solar: {label: "PV-Anlage", icon: "mdi:solar-power", color: "orange"},
  home: {label: "Haus / Verbraucher", icon: "mdi:home", color: "orange"},
  device: {label: "Gerät (z. B. Auto/Wallbox)", icon: "mdi:car", color: "green"},
  battery: {label: "Batterie (optional)", icon: "mdi:battery-high", color: "teal"}
};

class EnergyFlowCustomCardEditor extends HTMLElement {
  constructor() { super(); this._forms = []; this._path = []; this.attachShadow({mode: "open"}); }
  connectedCallback() { this._loadHelpers(); }
  async _loadHelpers() {
    try {
      if (!customElements.get("ha-form")) customElements.get("hui-button-card")?.getConfigElement?.();
      if (!customElements.get("ha-entity-picker")) customElements.get("hui-entities-card")?.getConfigElement?.();
      if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
      const h = await window.loadCardHelpers?.();
      const c = await h?.createCardElement({type: "entities", entities: []});
      await c?.constructor?.getConfigElement?.();
    } catch (e) { /* editor still works if the pickers are already loaded */ }
  }
  setConfig(config) {
    const n = efNormalize(config);
    if (this._cfg && (JSON.stringify(n) === JSON.stringify(this._cfg) || JSON.stringify(n) === this._lastEmitted)) return;
    this._cfg = n;
    this._build();
  }
  set hass(h) { this._hass = h; this._forms.forEach(f => { f.hass = h; }); this.shadowRoot.querySelectorAll("ha-entity-picker").forEach(p => { p.hass = h; }); }

  _pruned() {
    const c = JSON.parse(JSON.stringify(this._cfg));
    c.circuits.forEach(x => ["grid", "solar", "home", "device", "battery"].forEach(k => { if (x[k] && !Object.keys(x[k]).length) delete x[k]; }));
    return c;
  }
  _emit() {
    const c = this._pruned();
    this._lastEmitted = JSON.stringify(c);
    this.dispatchEvent(new CustomEvent("config-changed", {bubbles: true, composed: true, detail: {config: c}}));
  }
  _structural() { this._emit(); this._build(); }
  _go(path) { this._path = path; this._build(); }
  _back() { this._go(this._path[2] === "r" ? this._path.slice(0, 2) : this._path.slice(0, -1)); }

  /* ---------- small DOM helpers ---------- */
  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  _iconBtn(path, label, fn, cls) {
    const b = document.createElement("ha-icon-button");
    b.path = path; b.label = label; if (cls) b.className = cls;
    b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); fn(); });
    return b;
  }
  _btn(label, fn, cls) { const b = this._el("button", "pill " + (cls || ""), label); b.type = "button"; b.addEventListener("click", ev => { ev.preventDefault(); fn(); }); return b; }
  _header(wrap, title, actions = []) {
    const h = this._el("div", "header");
    const l = this._el("div", "back-title");
    l.appendChild(this._iconBtn(EF_ICONS.back, "Zurück", () => this._back()));
    l.appendChild(this._el("span", "", title));
    h.appendChild(l);
    const a = this._el("div", "acts"); actions.forEach(x => a.appendChild(x)); h.appendChild(a);
    wrap.appendChild(h);
  }
  _link(wrap, icon, title, secondary, fn) {
    const r = this._el("div", "link"); r.setAttribute("role", "button"); r.tabIndex = 0;
    const ic = document.createElement("ha-icon"); ic.setAttribute("icon", icon); ic.className = "lead"; r.appendChild(ic);
    const t = this._el("div", "ltext"); t.appendChild(this._el("div", "", title));
    if (secondary) t.appendChild(this._el("div", "secondary", secondary));
    r.appendChild(t);
    const ch = document.createElement("ha-svg-icon"); ch.path = EF_ICONS.chevron; ch.className = "lead"; r.appendChild(ch);
    r.addEventListener("click", fn); r.addEventListener("keydown", e => { if (e.key === "Enter") fn(); });
    wrap.appendChild(r);
  }
  _title(wrap, text) { wrap.appendChild(this._el("div", "section-title", text)); }
  _move(arr, i, dir, after) { const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; if (after) after(i, j); this._structural(); }

  /* ha-form bound to a plain object; writes back only what this form changed */
  _form(schema, obj, {onChange, map, unmap, entityHelper} = {}) {
    const f = document.createElement("ha-form");
    f.hass = this._hass; f.schema = schema;
    f.data = map ? map(obj) : {...obj};
    f.computeLabel = s => EF_LABELS[s.name] || s.name;
    f.computeHelper = s => s.name === "entity" ? (entityHelper ? EF_ENTITY_HELPER : "") : (EF_HELPERS[s.name] || "");
    f.addEventListener("value-changed", ev => {
      ev.stopPropagation();
      const v = unmap ? unmap(ev.detail.value) : ev.detail.value;
      const pv = unmap ? unmap(f.data) : f.data;
      Object.keys(v).forEach(k => {
        if (JSON.stringify(v[k]) === JSON.stringify(pv[k])) return;
        if (v[k] === undefined || v[k] === "" || v[k] === null) delete obj[k]; else obj[k] = v[k];
      });
      Object.keys(pv).forEach(k => { if (!(k in v)) delete obj[k]; });
      f.data = map ? map(obj) : {...obj};
      if (onChange) onChange(obj);
      this._emit();
    });
    this._forms.push(f);
    return f;
  }

  /* ---------- schemas ---------- */
  _S() {
    const two = (a, b) => ({type: "grid", name: "", schema: [a, b]});
    const text = n => ({name: n, selector: {text: {}}}), icon = {name: "icon", selector: {icon: {}}};
    const color = {name: "color", selector: {color_rgb: {}}};
    const num = n => ({name: n, selector: {number: {mode: "box", min: 0, max: 100000, step: 1}}});
    const ent = n => ({name: n, selector: {entity: {}}}), bool = n => ({name: n, selector: {boolean: {}}});
    return {
      circuit: [text("name")],
      title: [text("title")],
      advanced: [two(num("base_decimals"), num("kilo_decimals")), num("kilo_threshold"), two(bool("clickable_entities"), bool("disable_dots")), two(bool("no_labels"), bool("panels_side_by_side"))],
      grid: [ent("entity"), two(text("name"), icon), two(color, ent("meter_reading")), {name: "display_state", selector: {select: {mode: "dropdown", options: [{value: "two_way", label: "Beide Richtungen (← Einspeisung, → Bezug)"}, {value: "one_way", label: "Nur Bezug (→)"}, {value: "one_way_reverse", label: "Nur Einspeisung (←)"}]}}}, bool("invert")],
      solar: [bool("enabled"), ent("entity"), two(text("name"), icon), color],
      home: [ent("entity"), two(text("name"), icon), color],
      device: [bool("enabled"), ent("entity"), two(text("name"), icon), two(color, ent("soc"))],
      battery: [bool("enabled"), ent("entity"), two(text("name"), icon), two(color, ent("soc")), bool("invert")],
      panelCommon: circuitOptions => [
        {name: "type", selector: {select: {mode: "dropdown", options: [{value: "circuit", label: "Stromkreis-Bereich (Zeilen)"}, {value: "balance", label: "PV & Bilanz"}]}}},
        {name: "circuit", selector: {select: {mode: "dropdown", options: circuitOptions.length ? circuitOptions : [{value: "0", label: "–"}]}}},
        two(text("title"), icon), two(color, text("hint"))
      ],
      panelCircuit: [two(bool("show_meter"), bool("show_bar"))],
      panelBalance: [two(bool("show_pv"), bool("show_feed_in")), two(bool("show_own"), bool("show_autarky"))],
      row: [
        {name: "source", selector: {select: {mode: "dropdown", options: [{value: "entity", label: "Eigener Sensor"}, {value: "home", label: "Haus-Gesamt des Stromkreises"}, {value: "device", label: "Gerät des Stromkreises"}, {value: "battery", label: "Batterie des Stromkreises"}, {value: "remainder", label: "Rest (Haus minus Gerät)"}]}}},
        ent("entity"), two(text("name"), icon), two(color, bool("in_bar")), ent("status_entity"), ent("energy_entity")
      ]
    };
  }

  _build() {
    this._forms = [];
    const root = this.shadowRoot, cfg = this._cfg;
    root.innerHTML = "<style>" + this._css() + "</style>";
    const wrap = this._el("div", "wrap"); root.appendChild(wrap);
    const [a, i, b, j] = this._path;
    const bad = () => { this._path = []; this._build(); };
    if (!a) return this._pageMain(wrap);
    if (a === "g") return this._pageAdvanced(wrap);
    if (a === "c") { const c = cfg.circuits[i]; if (!c) return bad(); return b ? this._pageNode(wrap, c, i, b) : this._pageCircuit(wrap, c, i); }
    if (a === "p") {
      const p = cfg.panels[i]; if (!p) return bad();
      if (b === "r") { if (!p.rows || !p.rows[j]) return bad(); return this._pageRow(wrap, p, i, j); }
      return this._pagePanel(wrap, p, i);
    }
    return bad();
  }

  _pageAdvanced(wrap) {
    this._header(wrap, "Erweitert");
    wrap.appendChild(this._form(this._S().advanced, this._cfg, {map: o => ({clickable_entities: true, disable_dots: false, no_labels: false, panels_side_by_side: false, ...o})}));
    wrap.appendChild(this._el("div", "secondary", "Aussehen der Karte (Hintergrund, Rahmen, Radius): im Code-Editor über style_ha_card, wie bei der Power Flow Card Plus."));
  }

  _pageMain(wrap) {
    const cfg = this._cfg;
    wrap.appendChild(this._form(this._S().title, cfg));
    this._title(wrap, "Stromkreise");
    cfg.circuits.forEach((c, i) => {
      const parts = ["Netz"]; if (this._on(c.solar)) parts.push("PV"); parts.push("Haus"); if (this._on(c.device)) parts.push("Gerät"); if (this._on(c.battery)) parts.push("Batterie");
      this._link(wrap, (c.home && c.home.icon) || "mdi:home-lightning-bolt", (i + 1) + ". " + (c.name || "Stromkreis"), parts.join(" · "), () => this._go(["c", i]));
    });
    wrap.appendChild(this._btn("+ Stromkreis hinzufügen", () => { cfg.circuits.push({name: "Stromkreis " + (cfg.circuits.length + 1), grid: {name: "Netz"}, home: {name: "Haus"}}); this._structural(); }, "add"));
    this._title(wrap, "Bereiche unter dem Diagramm");
    cfg.panels.forEach((p, i) => {
      const cn = (cfg.circuits[Number(p.circuit) || 0] || {}).name || "";
      this._link(wrap, p.icon || (p.type === "balance" ? "mdi:solar-power" : "mdi:flash"), (i + 1) + ". " + (p.title || "ohne Titel"),
        (p.type === "balance" ? "PV & Bilanz" : "Stromkreis-Bereich") + (cn ? " · " + cn : ""), () => this._go(["p", i]));
    });
    const adds = this._el("div", "adds");
    adds.appendChild(this._btn("+ Stromkreis-Bereich", () => { cfg.panels.push({type: "circuit", circuit: 0, title: "Neuer Bereich", icon: "mdi:flash", color: "orange", rows: []}); this._structural(); }, "add"));
    adds.appendChild(this._btn("+ Bilanz-Bereich", () => { cfg.panels.push({type: "balance", circuit: 0, title: "PV & Bilanz", icon: "mdi:solar-power"}); this._structural(); }, "add"));
    wrap.appendChild(adds);
    this._link(wrap, "mdi:cog", "Erweitert", "Dezimalstellen, Schwelle kW, Punkte, Beschriftungen, Klick", () => this._go(["g"]));
  }

  _on(node) { return !!node && (node.enabled !== undefined ? !!node.enabled : !!node.entity); }

  _pageCircuit(wrap, c, i) {
    const cfg = this._cfg;
    this._header(wrap, c.name || "Stromkreis", [
      this._iconBtn(EF_ICONS.up, "Nach oben", () => this._move(cfg.circuits, i, -1, (x, y) => { this._path = ["c", y]; this._swapPanelCircuits(x, y); })),
      this._iconBtn(EF_ICONS.down, "Nach unten", () => this._move(cfg.circuits, i, 1, (x, y) => { this._path = ["c", y]; this._swapPanelCircuits(x, y); })),
      this._iconBtn(EF_ICONS.close, "Stromkreis löschen", () => {
        cfg.circuits.splice(i, 1);
        cfg.panels.forEach(p => { const n = Number(p.circuit) || 0; if (n === i) p.circuit = 0; else if (n > i) p.circuit = n - 1; });
        this._path = []; this._structural();
      })
    ]);
    wrap.appendChild(this._form(this._S().circuit, c));
    ["grid", "solar", "home", "device", "battery"].forEach(k => {
      const nd = c[k] || {}, def = EF_NODES[k];
      const sec = k === "solar" || k === "device" || k === "battery" ? (this._on(nd) ? (nd.entity || "aktiv") : "nicht aktiv") : (nd.entity || "");
      this._link(wrap, nd.icon || def.icon, def.label, sec, () => this._go(["c", i, k]));
    });
  }
  _swapPanelCircuits(x, y) { this._cfg.panels.forEach(p => { const n = Number(p.circuit) || 0; if (n === x) p.circuit = y; else if (n === y) p.circuit = x; }); }

  _pageNode(wrap, c, i, kind) {
    const def = EF_NODES[kind];
    c[kind] = c[kind] || {};
    this._header(wrap, (c.name || "Stromkreis") + " › " + def.label);
    wrap.appendChild(this._form(this._S()[kind], c[kind], {entityHelper: kind === "home" || kind === "device" || kind === "battery",
      map: o => ({icon: def.icon, ...(kind === "grid" ? {display_state: "two_way"} : {}), ...o, color: efToRgb(o.color, def.color)})}));
  }

  _pagePanel(wrap, p, i) {
    const cfg = this._cfg;
    const circuitOptions = cfg.circuits.map((c, k) => ({value: String(k), label: (k + 1) + ". " + (c.name || "Stromkreis")}));
    this._header(wrap, p.title || "Bereich", [
      this._iconBtn(EF_ICONS.up, "Nach oben", () => this._move(cfg.panels, i, -1, (x, y) => { this._path = ["p", y]; })),
      this._iconBtn(EF_ICONS.down, "Nach unten", () => this._move(cfg.panels, i, 1, (x, y) => { this._path = ["p", y]; })),
      this._iconBtn(EF_ICONS.close, "Bereich löschen", () => { cfg.panels.splice(i, 1); this._path = []; this._structural(); })
    ]);
    const prevType = p.type || "circuit";
    wrap.appendChild(this._form(this._S().panelCommon(circuitOptions), p, {
      map: o => ({...o, type: o.type || "circuit", circuit: String(o.circuit || 0), icon: o.icon || (prevType === "balance" ? "mdi:solar-power" : "mdi:flash"), color: efToRgb(o.color, "orange")}),
      unmap: v => ({...v, circuit: Number(v.circuit || 0)}),
      onChange: o => { if ((o.type || "circuit") !== prevType) this._structural(); }
    }));
    if (prevType === "balance") {
      wrap.appendChild(this._form(this._S().panelBalance, p, {map: o => ({show_pv: true, show_feed_in: true, show_own: true, show_autarky: true, ...o})}));
      return;
    }
    wrap.appendChild(this._form(this._S().panelCircuit, p, {map: o => ({show_meter: true, show_bar: true, ...o})}));
    this._title(wrap, "Zeilen");
    p.rows = Array.isArray(p.rows) ? p.rows : [];
    this._rowList(wrap, p, i);
  }

  /* row list in the style of Power Flow Card Plus' individual devices: entity picker per row + edit/remove */
  _rowList(wrap, p, i) {
    const list = this._el("div", "entities");
    p.rows.forEach((r, j) => {
      const row = this._el("div", "entity");
      const src = r.source || "entity";
      if (src === "entity") {
        const pick = document.createElement("ha-entity-picker");
        pick.hass = this._hass; pick.value = r.entity || ""; pick.setAttribute("allow-custom-entity", ""); pick.hideClearIcon = true;
        pick.addEventListener("value-changed", ev => { ev.stopPropagation(); const v = ev.detail.value; if (v) r.entity = v; else delete r.entity; this._emit(); });
        row.appendChild(pick);
      } else {
        const label = {home: "Haus-Gesamt", device: "Gerät", battery: "Batterie", remainder: "Rest (Haus minus Gerät)"}[src] || src;
        const sp = this._el("div", "special-row"); sp.appendChild(this._el("span", "", r.name || label)); sp.appendChild(this._el("span", "secondary", label));
        row.appendChild(sp);
      }
      row.appendChild(this._iconBtn(EF_ICONS.up, "Nach oben", () => this._move(p.rows, j, -1), "small"));
      row.appendChild(this._iconBtn(EF_ICONS.down, "Nach unten", () => this._move(p.rows, j, 1), "small"));
      row.appendChild(this._iconBtn(EF_ICONS.close, "Entfernen", () => { p.rows.splice(j, 1); this._structural(); }, "small"));
      row.appendChild(this._iconBtn(EF_ICONS.pencil, "Bearbeiten", () => this._go(["p", i, "r", j]), "small"));
      list.appendChild(row);
    });
    wrap.appendChild(list);
    const add = document.createElement("ha-entity-picker");
    add.className = "add-entity"; add.hass = this._hass;
    add.addEventListener("value-changed", ev => {
      ev.stopPropagation();
      const v = ev.detail.value; if (!v) return;
      ev.target.value = "";
      p.rows.push({source: "entity", entity: v}); this._structural();
    });
    wrap.appendChild(add);
    const adds = this._el("div", "adds");
    [["+ Haus-Gesamt", "home"], ["+ Gerät", "device"], ["+ Rest", "remainder"]].forEach(([label, source]) =>
      adds.appendChild(this._btn(label, () => { p.rows.push({source}); this._structural(); }, "add")));
    wrap.appendChild(adds);
  }

  _pageRow(wrap, p, i, j) {
    const r = p.rows[j];
    this._header(wrap, (j + 1) + " / " + p.rows.length + " Zeile", []);
    wrap.appendChild(this._form(this._S().row, r, {entityHelper: true,
      map: o => ({source: "entity", ...o, color: efToRgb(o.color, "violet"), in_bar: o.in_bar !== undefined ? o.in_bar : (o.source === "remainder" || o.source === "device")}),
      onChange: () => {}
    }));
  }

  _css() { return `
    :host{display:block}.wrap{display:flex;flex-direction:column;gap:12px}
    ha-form{display:block;width:100%}
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
    .back-title{display:flex;align-items:center;font-size:18px;min-width:0}
    .back-title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .acts{display:flex;align-items:center}
    .section-title{margin-top:8px;font-size:16px;font-weight:600}
    .link{display:flex;align-items:center;gap:1rem;min-height:48px;padding:6px 8px;cursor:pointer;font-weight:500;border-radius:8px;outline:none}
    .link:hover,.link:focus-visible{background:rgba(127,127,127,.12)}
    .lead{color:var(--secondary-text-color)}
    .ltext{flex:1;min-width:0}.ltext>div:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .secondary{display:block;color:var(--secondary-text-color);font-size:12px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pill{border:1px solid var(--divider-color,rgba(127,127,127,.4));background:transparent;color:var(--primary-color);border-radius:99px;padding:6px 14px;font:inherit;cursor:pointer}
    .pill:hover{background:rgba(127,127,127,.12)}
    .adds{display:flex;gap:8px;flex-wrap:wrap}
    .entity{display:flex;align-items:center}
    .entity ha-entity-picker{flex-grow:1;min-width:0}
    .special-row{height:60px;display:flex;flex-direction:column;justify-content:center;flex-grow:1;font-size:16px}
    ha-icon-button.small{--mdc-icon-button-size:36px;color:var(--secondary-text-color)}
    .add-entity{display:block}
  `; }
}

if (!customElements.get("energyflow-custom-card")) customElements.define("energyflow-custom-card", EnergyFlowCustomCard);
if (!customElements.get("energyflow-custom-card-editor")) customElements.define("energyflow-custom-card-editor", EnergyFlowCustomCardEditor);
window.customCards = window.customCards || [];
if (!window.customCards.some(x => x.type === "energyflow-custom-card")) window.customCards.push({
  type: "energyflow-custom-card", name: "EnergyFlow Custom Card", preview: true,
  description: "Energiefluss mit beliebig vielen getrennten Stromkreisen (eigene Zähler), PV, Geräten und frei wählbaren Bereichen."
});
