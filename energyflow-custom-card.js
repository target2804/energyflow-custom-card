/* EnergyFlow Custom Card — v0.6.0
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

const EF_VERSION = "0.6.0";
const EF_TYPE = "custom:energyflow-custom-card";
const EF_EXPORT_COLOR = "#a66add";
const EF_PALETTE = {orange:"#e9a219",yellow:"#f0ba27",blue:"#329af0",violet:"#b184e5",green:"#24a85a",teal:"#23a9aa",red:"#e0556b",grey:"#8b92a5"};
const EF_COLOR_OPTIONS = [["orange","Orange"],["yellow","Gelb"],["blue","Blau"],["violet","Violett"],["green","Grün"],["teal","Türkis"],["red","Rot"],["grey","Grau"]].map(([value,label])=>({value,label}));
const efColor = (v, d) => EF_PALETTE[v] || (/^#[0-9a-f]{3,8}$/i.test(String(v || "")) ? v : (EF_PALETTE[d] || d));

/* ---------- Config helpers (shared by card and editor) ---------- */

function efIsLegacy(cfg) {
  return !!cfg && !Array.isArray(cfg.circuits) && !!(cfg.house || cfg.heat_pump || cfg.ev);
}

/* Converts the config format of v0.1–v0.5 (house / heat_pump / ev / consumers) to the modular format.
 * The legacy Buderus defaults are kept ONLY here so that existing dashboards keep working unchanged. */
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
    home: clean({entity: wp.power, name: "Wärmepumpe", icon: "mdi:heat-pump", color: "violet"})
  }];
  const consumers = (Array.isArray(cfg.consumers) ? cfg.consumers : []).map(x => clean({
    source: "entity", entity: x.entity, name: x.name || x.entity, icon: x.icon || "mdi:flash",
    color: "#" + String(x.color || "9c80d4").replace(/^#/, "")
  }));
  const panels = [
    {type: "circuit", circuit: 0, title: "Hausstrom", icon: "mdi:home-lightning-bolt", color: "orange", rows: [
      {source: "remainder", name: "Hausverbrauch", icon: "mdi:home", color: "#349ce9", in_bar: true},
      {source: "device", name: "Wallbox", icon: "mdi:car", color: "#23985c", in_bar: true}, ...consumers]},
    {type: "circuit", circuit: 1, title: "Wärmestrom", icon: "mdi:heat-pump", color: "violet", show_bar: false, rows: [
      clean({source: "entity", entity: wp.compressor_power, name: "Kompressor", icon: "mdi:heat-pump", color: "violet",
        status_entity: wp.compressor_status || "sensor.buderus_gateway_101730536_kompressorstatus",
        energy_entity: wp.compressor_energy || "sensor.buderus_gateway_101730536_stromverbrauch_warmepumpe_gesamt"}),
      clean({source: "entity", entity: wp.heater_power, name: "Heizstab", icon: "mdi:radiator", color: "violet",
        status_entity: wp.heater_status || "sensor.buderus_gateway_101730536_heizstabstatus",
        energy_entity: wp.heater_energy || "sensor.buderus_gateway_101730536_stromverbrauch_elektrischer_zuheizer_gesamt"})]},
    {type: "balance", circuit: 0, title: "PV & Bilanz", icon: "mdi:solar-power", hint: "Hausstromkreis"}
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
  fmt(v) { if (v === null || v === undefined || !Number.isFinite(v)) return "–"; return Math.abs(v) >= 1000 ? (v / 1000).toLocaleString("de-DE", {maximumFractionDigits: 2}) + " kW" : Math.round(v).toLocaleString("de-DE") + " W"; }
  fmtKwh(v) { return v === null || v === undefined ? "–" : v.toLocaleString("de-DE", {maximumFractionDigits: 1}) + " kWh"; }
  esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c])); }
  click(id) { if (!id) return; this.dispatchEvent(new CustomEvent("hass-more-info", {bubbles: true, composed: true, detail: {entityId: id}})); }

  /* ---------- resolved circuit (config + live values) ---------- */
  _circuit(c, i) {
    const g = c.grid || {}, s = c.solar || {}, hm = c.home || {}, d = c.device || {};
    const hasSolar = s.enabled !== undefined ? !!s.enabled : !!s.entity;
    const hasDev = d.enabled !== undefined ? !!d.enabled : !!d.entity;
    const sign = g.invert ? -1 : 1;
    const gridRaw = this.watts(g.entity);
    const gridW = gridRaw === null ? null : gridRaw * sign;
    const solarW = hasSolar ? this.watts(s.entity) : null;
    let homeW = hm.entity ? this.watts(hm.entity) : null;
    if (homeW === null && !hm.entity) {
      if (hasSolar) homeW = solarW !== null && gridW !== null ? Math.max(0, solarW + gridW) : null;
      else homeW = gridW !== null ? Math.max(0, gridW) : null;
    }
    const devW = hasDev ? this.watts(d.entity) : null;
    const pvUse = hasSolar && solarW !== null && gridW !== null ? Math.max(0, solarW - Math.max(0, -gridW)) : null;
    const own = solarW > 0 && pvUse !== null ? Math.min(100, Math.round(pvUse / solarW * 100)) : null;
    const autarky = homeW > 0 && pvUse !== null ? Math.min(100, Math.round(pvUse / homeW * 100)) : null;
    return {
      i, name: c.name || ("Stromkreis " + (i + 1)), hasSolar, hasDev, gridW, solarW, homeW, devW, pvUse, own, autarky,
      devSoc: d.soc ? this.val(d.soc) : null,
      grid: {entity: g.entity, name: g.name || "Netz", icon: g.icon || "mdi:transmission-tower", color: efColor(g.color, "blue"), meter: g.meter_reading},
      solar: {entity: s.entity, name: s.name || "PV-Produktion", icon: s.icon || "mdi:solar-power", color: efColor(s.color, "orange")},
      home: {entity: hm.entity, name: hm.name || "Haus", icon: hm.icon || "mdi:home", color: efColor(hm.color, "orange")},
      device: {entity: d.entity, name: d.name || "Gerät", icon: d.icon || "mdi:car", color: efColor(d.color, "green")}
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
    cs.forEach((c, i) => {
      const b = L.blocks[i], {xL, xC, xR, yTop, yMid} = b;
      if (c.hasSolar) {
        const pvY = yTop + Math.sqrt(R * R - L.dx * L.dx), sideX = Math.sqrt(R * R - L.dy * L.dy);
        wires.push({...line(xL + R, yMid, xR - R, yMid), color: c.grid.color, active: c.gridW !== null && c.gridW > MIN});
        wires.push({...this._elbow(xC - L.dx, pvY, xL + sideX, yMid - L.dy), color: EF_EXPORT_COLOR, active: c.gridW !== null && -c.gridW > MIN});
        wires.push({...this._elbow(xC + L.dx, pvY, xR - sideX, yMid - L.dy), color: c.solar.color, active: c.pvUse !== null && c.pvUse > MIN});
        if (c.hasDev) wires.push({...line(xR, yMid - R, xR, yTop + R), color: c.device.color, active: c.devW !== null && c.devW > MIN});
        const exporting = c.gridW !== null && c.gridW < 0;
        nodes.push({x: xC, y: yTop, pos: "above", name: c.solar.name, value: this.fmt(c.solarW), icon: c.solar.icon, color: c.solar.color, entity: c.solar.entity});
        nodes.push({x: xL, y: yMid, pos: "below", name: c.grid.name, value: c.gridW === null ? "–" : (exporting ? "← " : "→ ") + fmtAbs(c.gridW), icon: c.grid.icon, color: exporting ? EF_EXPORT_COLOR : c.grid.color, entity: c.grid.entity});
        nodes.push({x: xR, y: yMid, pos: "below", name: c.home.name, value: this.fmt(c.homeW), icon: c.home.icon, color: c.home.color, entity: c.home.entity});
        if (c.hasDev) nodes.push({x: xR, y: yTop, pos: "above", name: c.device.name, value: this.fmt(c.devW), icon: c.device.icon, color: c.device.color, entity: c.device.entity, extra: c.devSoc === null ? "" : Math.round(c.devSoc) + " %"});
      } else {
        const flow = c.gridW !== null ? c.gridW : c.homeW;
        wires.push({...line(xL + R, yMid, xC - R, yMid), color: c.home.color, active: flow !== null && flow > MIN});
        if (c.hasDev) wires.push({...line(xC + R, yMid, xR - R, yMid), color: c.device.color, active: c.devW !== null && c.devW > MIN});
        nodes.push({x: xL, y: yMid, pos: "below", name: c.grid.name, value: fmtAbs(c.gridW), icon: c.grid.icon, color: c.grid.color, entity: c.grid.entity});
        nodes.push({x: xC, y: yMid, pos: "below", name: c.home.name, value: this.fmt(c.homeW), icon: c.home.icon, color: c.home.color, entity: c.home.entity});
        if (c.hasDev) nodes.push({x: xR, y: yMid, pos: "below", name: c.device.name, value: this.fmt(c.devW), icon: c.device.icon, color: c.device.color, entity: c.device.entity, extra: c.devSoc === null ? "" : Math.round(c.devSoc) + " %"});
      }
    });
    return {wires, nodes};
  }

  ensureSkeleton() {
    if (this._flow) return;
    if (!this.shadowRoot) this.attachShadow({mode: "open"});
    this.shadowRoot.innerHTML = '<style>' + this.css() + '</style><ha-card><div class="flow-layout"><svg class="flow-wires" aria-hidden="true"></svg><div class="flow-nodes"></div></div><div class="panels"></div></ha-card>';
    this._flow = this.shadowRoot.querySelector(".flow-layout");
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
        F.wires.filter(w => w.active).map(w => '<circle r="4.5" style="fill:' + w.color + '"><animateMotion dur="' + Math.max(1.6, w.len / 70).toFixed(2) + 's" repeatCount="indefinite" path="' + w.d + '"/></circle>').join("");
    }
    this._nodes.innerHTML = F.nodes.map(n =>
      '<div class="flow-node" style="left:' + n.x + 'px;top:' + n.y + 'px;--node-color:' + n.color + ';--d:' + (L.R * 2) + 'px" data-e="' + this.esc(n.entity || "") + '"' + (n.entity ? ' tabindex="0" role="button"' : "") + '>' +
      (n.extra ? '<span class="node-extra">' + this.esc(n.extra) + '</span>' : "") +
      this.ico(n.icon, n.color) + '<strong>' + this.esc(n.value) + '</strong><span class="flow-label ' + n.pos + '">' + this.esc(n.name) + '</span></div>').join("");
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
      '<div class="kpis">' + (kpis.length ? '<div class="kpi-list">' + kpis.join("") + "</div>" : "") + (gauges.length ? '<div class="gauge-list">' + gauges.join("") + "</div>" : "") + "</div></section>";
  }

  css() { return `
    :host{display:block}*{box-sizing:border-box}
    ha-card{display:block;background:var(--ha-card-background,rgba(36,39,58,.72));border:1px solid rgba(202,211,245,.12);border-radius:22px;padding:16px;color:var(--primary-text-color,#fff);box-shadow:none;overflow:hidden;font-family:var(--primary-font-family,Roboto,"Arial",sans-serif)}
    h3{display:flex;align-items:center;gap:8px}
    .empty{padding:24px 8px;text-align:center;color:var(--secondary-text-color,#abb2c0)}
    .flow-layout{position:relative;isolation:isolate;margin:0 0 20px;width:100%}
    .flow-wires{position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;pointer-events:none;overflow:visible}
    .wire{fill:none;stroke-width:2;stroke-linecap:round;opacity:.9;transition:opacity .4s}
    .wire.idle{opacity:.22}
    .flow-node{position:absolute;z-index:1;width:var(--d);height:var(--d);transform:translate(-50%,-50%);border:2px solid var(--node-color);border-radius:50%;background:var(--card-background-color,#222530);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;line-height:1.12;cursor:pointer;text-align:center;outline:none}
    .flow-node:focus-visible{box-shadow:0 0 0 2px var(--primary-color,#03a9f4)}
    .flow-node strong{font-size:14px;white-space:nowrap;font-weight:500}.node-extra{font-size:11px;color:var(--secondary-text-color,#c8ccd9)}
    .compact .flow-node strong{font-size:12px}.compact .flow-label{font-size:12px}.compact .flow-node ha-icon{--mdc-icon-size:22px!important}
    .flow-label{position:absolute;left:50%;transform:translateX(-50%);font-size:13px;line-height:1.25;white-space:nowrap;font-weight:400;color:var(--secondary-text-color,#abb2c0)}
    .flow-label.above{bottom:calc(100% + 5px)}.flow-label.below{top:calc(100% + 5px)}
    .panels{container-type:inline-size}
    .meters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-bottom:12px}
    .meters:last-child{margin-bottom:0}
    @container (max-width:400px){.meters{grid-template-columns:minmax(0,1fr)}}
    .panel{border:1px solid rgba(202,211,245,.12);border-radius:17px;padding:12px;background:rgba(15,20,35,.16);min-width:0}
    h3{font-size:15px;line-height:1.35;font-weight:600;margin:0 0 5px;overflow-wrap:normal}
    h3 ha-icon,.consumer ha-icon{flex-shrink:0}
    .hint{font-size:12px;color:var(--secondary-text-color,#abb2c0);margin:0 0 13px}
    .metric{display:flex;justify-content:space-between;gap:7px;color:var(--secondary-text-color,#abb2c0);font-size:12px;flex-wrap:wrap}
    .metric span:last-child{text-align:right}.metric strong{display:block;font-size:16px;color:var(--primary-text-color,#fff);margin-top:6px;white-space:nowrap}
    .stack{height:9px;background:#343b4a;border-radius:10px;display:flex;overflow:hidden;margin:14px 0 10px}
    .consumer{display:flex;align-items:center;gap:6px;font-size:12px;padding:7px 0}
    .consumer ha-icon{--mdc-icon-size:20px!important}
    .consumer span{min-width:0;flex:1}.consumer strong{margin-left:auto;text-align:right;white-space:nowrap;font-size:12px}
    .balance h3{margin-bottom:14px}.balance .hint{margin:0 0 0 auto;font-weight:400}
    .kpis{display:grid;grid-template-columns:minmax(0,1fr);gap:16px 10px;align-items:start}
    @container (min-width:430px){.kpis{grid-template-columns:minmax(0,.9fr) minmax(0,1.5fr)}.kpis>:only-child{grid-column:1/-1}}
    .kpi-list{display:flex;flex-wrap:wrap;gap:12px 18px}
    .kpi{display:flex;flex-direction:column;gap:11px;font-size:12px;color:var(--secondary-text-color,#abb2c0);padding-top:13px}
    .kpi strong{font-size:17px;color:var(--primary-text-color,#fff)}
    .gauge-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
    .gauge{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0;position:relative}
    .gauge-svg{display:block;width:100%;max-width:170px;height:auto;overflow:visible}
    .gauge-track,.gauge-fill{fill:none;stroke-width:14;stroke-linecap:butt}
    .gauge-track{stroke:#353d4d}.gauge-fill{stroke-dashoffset:0}
    .gauge strong{font-size:20px;position:relative;margin-top:-30px;z-index:1}
    .gauge span{font-size:12px;color:var(--secondary-text-color,#abb2c0);margin-top:8px;line-height:1.3;overflow-wrap:normal;hyphens:auto}
    .wp-detail{display:flex;align-items:center;gap:8px;padding:11px 0;border-top:1px solid rgba(202,211,245,.08);min-width:0}
    .wp-detail ha-icon{flex-shrink:0;--mdc-icon-size:21px!important}
    .wp-detail-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;font-size:13px}
    .wp-detail-main span{color:var(--secondary-text-color,#abb2c0);font-size:12px}
    .wp-detail-values{display:flex;flex-direction:column;text-align:right;gap:3px;margin-left:auto;max-width:58%}
    .wp-detail-values strong{font-size:13px}.wp-detail-values span{font-size:11px;color:var(--secondary-text-color,#abb2c0)}
    @media(max-width:460px){ha-card{padding:11px}.panel{padding:13px}}
    @media(prefers-reduced-motion:reduce){.flow-wires circle{display:none}}
  `; }
}

/* ====================================================================== */
/*  Visual editor                                                         */
/* ====================================================================== */

const EF_LABELS = {
  name: "Name (Beschriftung)", icon: "Icon", color: "Farbe", entity: "Sensor (Leistung)", meter_reading: "Zählerstand (kWh-Sensor)",
  invert: "Vorzeichen umkehren (Einspeisung positiv)", enabled: "Anzeigen", soc: "Ladestand (%-Sensor)",
  title: "Titel", hint: "Zusatztext (rechts)", type: "Panel-Typ", circuit: "Stromkreis", show_meter: "Leistung & Zählerstand anzeigen", show_bar: "Verteilungsbalken anzeigen",
  source: "Wert", status_entity: "Status-Sensor", energy_entity: "Energie gesamt (kWh-Sensor)", in_bar: "Im Verteilungsbalken",
  show_pv: "PV-Produktion", show_feed_in: "PV-Einspeisung", show_own: "Eigenverbrauchsquote", show_autarky: "Autarkiegrad"
};
const EF_HELPERS = {
  entity: "Leer lassen, wenn der Wert nicht angezeigt werden soll bzw. berechnet wird.",
  invert: "Home Assistant: positiv = Bezug, negativ = Einspeisung.",
  source: "Eigener Sensor, Haus-Gesamt, Gerät oder Rest (Haus minus Gerät)."
};

class EnergyFlowCustomCardEditor extends HTMLElement {
  constructor() { super(); this._forms = []; this._open = {}; this.attachShadow({mode: "open"}); }
  connectedCallback() { this._loadHelpers(); }
  async _loadHelpers() {
    try {
      if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
      const h = await window.loadCardHelpers?.();
      const c = await h?.createCardElement({type: "entities", entities: []});
      await c?.constructor?.getConfigElement?.();
    } catch (e) { /* editor still works if pickers are already loaded */ }
  }
  setConfig(config) {
    const n = efNormalize(config);
    if (this._cfg && (JSON.stringify(n) === JSON.stringify(this._cfg) || JSON.stringify(n) === this._lastEmitted)) return;
    this._cfg = n;
    this._build();
  }
  set hass(h) { this._hass = h; this._forms.forEach(f => { f.hass = h; }); }

  _pruned() {
    const c = JSON.parse(JSON.stringify(this._cfg));
    c.circuits.forEach(x => ["grid", "solar", "home", "device"].forEach(k => { if (x[k] && !Object.keys(x[k]).length) delete x[k]; }));
    return c;
  }
  _emit() {
    const c = this._pruned();
    this._lastEmitted = JSON.stringify(c);
    this.dispatchEvent(new CustomEvent("config-changed", {bubbles: true, composed: true, detail: {config: c}}));
  }
  _structural() { this._emit(); this._build(); }

  /* A ha-form bound to a plain object; writes changes back, drops empty values */
  _form(schema, obj, {onChange, map, unmap} = {}) {
    const f = document.createElement("ha-form");
    f.hass = this._hass; f.schema = schema;
    f.data = map ? map(obj) : {...obj};
    f.computeLabel = s => EF_LABELS[s.name] || s.name;
    f.computeHelper = s => EF_HELPERS[s.name] || "";
    f.addEventListener("value-changed", ev => {
      ev.stopPropagation();
      const v = unmap ? unmap(ev.detail.value) : ev.detail.value;
      const pv = unmap ? unmap(f.data) : f.data;
      Object.keys(v).forEach(k => {   // apply only what this form changed (several forms may share one object)
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

  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  _btn(label, fn, cls) { const b = this._el("button", "btn " + (cls || ""), label); b.type = "button"; b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); fn(); }); return b; }
  _section(key, title, {open = false, actions = []} = {}) {
    const d = document.createElement("details");
    d.open = this._open[key] !== undefined ? this._open[key] : open;
    d.addEventListener("toggle", () => { this._open[key] = d.open; });
    const s = this._el("summary"); s.appendChild(this._el("span", "st", title));
    const a = this._el("span", "acts"); actions.forEach(x => a.appendChild(x)); s.appendChild(a);
    d.appendChild(s);
    const body = this._el("div", "body"); d.appendChild(body);
    d.body = body;
    return d;
  }
  _move(arr, i, dir) { const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; this._structural(); }

  /* ---- schemas ---- */
  _S() {
    const ent = {entity: {}};
    const two = (a, b) => ({type: "grid", name: "", schema: [a, b]});
    const icon = {name: "icon", selector: {icon: {}}}, name = {name: "name", selector: {text: {}}};
    const color = {name: "color", selector: {select: {options: EF_COLOR_OPTIONS, mode: "dropdown"}}};
    return {
      circuit: [{name: "name", selector: {text: {}}}],
      grid: [{name: "entity", selector: ent}, two(name, icon), two(color, {name: "meter_reading", selector: ent}), {name: "invert", selector: {boolean: {}}}],
      solar: [{name: "enabled", selector: {boolean: {}}}, {name: "entity", selector: ent}, two(name, icon), color],
      home: [{name: "entity", selector: ent}, two(name, icon), color],
      device: [{name: "enabled", selector: {boolean: {}}}, {name: "entity", selector: ent}, two(name, icon), two(color, {name: "soc", selector: ent})]
    };
  }

  _build() {
    this._forms = [];
    const root = this.shadowRoot, cfg = this._cfg, S = this._S();
    root.innerHTML = "<style>" + this._css() + "</style>";
    const wrap = this._el("div", "wrap"); root.appendChild(wrap);

    /* ---- Circuits ---- */
    wrap.appendChild(this._el("h3", "", "Stromkreise"));
    wrap.appendChild(this._el("p", "hint", "Jeder Stromkreis hat einen eigenen Netzanschluss (Zähler). Ein Stromkreis mit PV zeigt das Dreieck PV – Netz – Haus, ohne PV eine einfache Reihe Netz – Haus."));
    cfg.circuits.forEach((c, i) => {
      c.grid = c.grid || {}; c.solar = c.solar || {}; c.home = c.home || {}; c.device = c.device || {};
      const sec = this._section("c" + i, (i + 1) + ". " + (c.name || "Stromkreis"), {open: cfg.circuits.length === 1, actions: [
        this._btn("↑", () => this._move(cfg.circuits, i, -1)), this._btn("↓", () => this._move(cfg.circuits, i, 1)),
        this._btn("✕", () => { cfg.circuits.splice(i, 1); (cfg.panels || []).forEach(p => { if (Number(p.circuit) === i) p.circuit = 0; else if (Number(p.circuit) > i) p.circuit = Number(p.circuit) - 1; }); this._structural(); }, "danger")]});
      sec.body.appendChild(this._form(S.circuit, c, {onChange: () => { sec.querySelector(".st").textContent = (i + 1) + ". " + (c.name || "Stromkreis"); }}));
      const sub = (key, title, schema, obj, open) => { const s2 = this._section("c" + i + key, title, {open}); s2.classList.add("sub"); s2.body.appendChild(this._form(schema, obj)); sec.body.appendChild(s2); };
      sub("g", "Netz", S.grid, c.grid, true);
      sub("s", "PV-Anlage (optional)", S.solar, c.solar, !!(c.solar.enabled || c.solar.entity));
      sub("h", "Haus / Verbraucher", S.home, c.home, true);
      sub("d", "Gerät, z. B. Auto/Wallbox (optional)", S.device, c.device, !!(c.device.enabled || c.device.entity));
      wrap.appendChild(sec);
    });
    wrap.appendChild(this._btn("+ Stromkreis hinzufügen", () => { cfg.circuits.push({name: "Stromkreis " + (cfg.circuits.length + 1), grid: {name: "Netz"}, home: {name: "Haus"}}); this._structural(); }, "add"));

    /* ---- Panels ---- */
    wrap.appendChild(this._el("h3", "", "Bereiche unter dem Diagramm"));
    wrap.appendChild(this._el("p", "hint", "Frei wählbar: Stromkreis-Bereiche mit beliebigen Zeilen (Leistung, Status, Energie) und Bilanz-Bereiche mit PV-Kennzahlen."));
    const circuitOptions = cfg.circuits.map((c, i) => ({value: String(i), label: (i + 1) + ". " + (c.name || "Stromkreis")}));
    cfg.panels.forEach((p, i) => {
      const label = (p.type === "balance" ? "Bilanz" : "Stromkreis") + ": " + (p.title || "ohne Titel");
      const sec = this._section("p" + i, (i + 1) + ". " + label, {actions: [
        this._btn("↑", () => this._move(cfg.panels, i, -1)), this._btn("↓", () => this._move(cfg.panels, i, 1)),
        this._btn("✕", () => { cfg.panels.splice(i, 1); this._structural(); }, "danger")]});
      const common = [
        {name: "type", selector: {select: {mode: "dropdown", options: [{value: "circuit", label: "Stromkreis-Bereich (Zeilen)"}, {value: "balance", label: "PV & Bilanz"}]}}},
        {name: "circuit", selector: {select: {mode: "dropdown", options: circuitOptions.length ? circuitOptions : [{value: "0", label: "–"}]}}},
        {type: "grid", name: "", schema: [{name: "title", selector: {text: {}}}, {name: "icon", selector: {icon: {}}}]},
        {type: "grid", name: "", schema: [{name: "color", selector: {select: {options: EF_COLOR_OPTIONS, mode: "dropdown"}}}, {name: "hint", selector: {text: {}}}]}
      ];
      const map = o => ({...o, type: o.type || "circuit", circuit: String(o.circuit || 0)});
      const unmap = v => ({...v, circuit: Number(v.circuit || 0)});
      const prevType = p.type || "circuit";
      sec.body.appendChild(this._form(common, p, {map, unmap, onChange: o => {
        sec.querySelector(".st").textContent = (i + 1) + ". " + ((o.type === "balance" ? "Bilanz" : "Stromkreis") + ": " + (o.title || "ohne Titel"));
        if ((o.type || "circuit") !== prevType) this._structural();
      }}));
      if (prevType === "balance") {
        sec.body.appendChild(this._form([{type: "grid", name: "", schema: [{name: "show_pv", selector: {boolean: {}}}, {name: "show_feed_in", selector: {boolean: {}}}, {name: "show_own", selector: {boolean: {}}}, {name: "show_autarky", selector: {boolean: {}}}]}], p,
          {map: o => ({show_pv: o.show_pv !== false, show_feed_in: o.show_feed_in !== false, show_own: o.show_own !== false, show_autarky: o.show_autarky !== false, ...o}),
           unmap: v => v}));
      } else {
        sec.body.appendChild(this._form([{type: "grid", name: "", schema: [{name: "show_meter", selector: {boolean: {}}}, {name: "show_bar", selector: {boolean: {}}}]}], p,
          {map: o => ({show_meter: o.show_meter !== false, show_bar: o.show_bar !== false, ...o}), unmap: v => v}));
        p.rows = Array.isArray(p.rows) ? p.rows : [];
        sec.body.appendChild(this._el("h4", "", "Zeilen"));
        p.rows.forEach((r, j) => {
          const rs = this._section("p" + i + "r" + j, (j + 1) + ". " + (r.name || r.entity || "Zeile"), {actions: [
            this._btn("↑", () => this._move(p.rows, j, -1)), this._btn("↓", () => this._move(p.rows, j, 1)),
            this._btn("✕", () => { p.rows.splice(j, 1); this._structural(); }, "danger")]});
          rs.classList.add("sub");
          const rowSchema = [
            {name: "source", selector: {select: {mode: "dropdown", options: [{value: "entity", label: "Eigener Sensor"}, {value: "home", label: "Haus-Gesamt des Stromkreises"}, {value: "device", label: "Gerät des Stromkreises"}, {value: "remainder", label: "Rest (Haus minus Gerät)"}]}}},
            {name: "entity", selector: {entity: {}}},
            {type: "grid", name: "", schema: [{name: "name", selector: {text: {}}}, {name: "icon", selector: {icon: {}}}]},
            {type: "grid", name: "", schema: [{name: "color", selector: {select: {options: EF_COLOR_OPTIONS, mode: "dropdown"}}}, {name: "in_bar", selector: {boolean: {}}}]},
            {name: "status_entity", selector: {entity: {}}},
            {name: "energy_entity", selector: {entity: {}}}
          ];
          rs.body.appendChild(this._form(rowSchema, r, {map: o => ({source: "entity", ...o, in_bar: o.in_bar !== undefined ? o.in_bar : (o.source === "remainder" || o.source === "device")}),
            onChange: o => { rs.querySelector(".st").textContent = (j + 1) + ". " + (o.name || o.entity || "Zeile"); }}));
          sec.body.appendChild(rs);
        });
        sec.body.appendChild(this._btn("+ Zeile hinzufügen", () => { p.rows.push({source: "entity", name: "Neue Zeile"}); this._structural(); }, "add"));
      }
      wrap.appendChild(sec);
    });
    const adds = this._el("div", "adds");
    adds.appendChild(this._btn("+ Stromkreis-Bereich", () => { cfg.panels.push({type: "circuit", circuit: 0, title: "Neuer Bereich", icon: "mdi:flash", color: "orange", rows: []}); this._structural(); }, "add"));
    adds.appendChild(this._btn("+ Bilanz-Bereich", () => { cfg.panels.push({type: "balance", circuit: 0, title: "PV & Bilanz", icon: "mdi:solar-power"}); this._structural(); }, "add"));
    wrap.appendChild(adds);
  }

  _css() { return `
    :host{display:block}.wrap{display:flex;flex-direction:column;gap:10px}
    h3{margin:14px 0 0;font-size:16px;font-weight:600}h4{margin:12px 0 4px;font-size:14px;font-weight:500}
    .hint{margin:0 0 4px;font-size:12px;color:var(--secondary-text-color)}
    details{border:1px solid var(--divider-color,rgba(127,127,127,.3));border-radius:10px;background:var(--card-background-color)}
    details.sub{margin-top:8px;border-style:dashed}
    summary{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;cursor:pointer;list-style:none;font-weight:500}
    summary::-webkit-details-marker{display:none}
    summary::before{content:"▸";margin-right:6px;transition:transform .15s}details[open]>summary::before{transform:rotate(90deg)}
    .st{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .acts{display:flex;gap:4px}
    .body{padding:4px 12px 12px;display:flex;flex-direction:column;gap:8px}
    .btn{border:1px solid var(--divider-color,rgba(127,127,127,.4));background:transparent;color:var(--primary-text-color);border-radius:8px;padding:4px 10px;font:inherit;cursor:pointer}
    .btn:hover{background:rgba(127,127,127,.15)}
    .btn.danger{color:var(--error-color,#db4437)}
    .btn.add{align-self:flex-start;padding:8px 14px;color:var(--primary-color)}
    .adds{display:flex;gap:8px;flex-wrap:wrap}
  `; }
}

if (!customElements.get("energyflow-custom-card")) customElements.define("energyflow-custom-card", EnergyFlowCustomCard);
if (!customElements.get("energyflow-custom-card-editor")) customElements.define("energyflow-custom-card-editor", EnergyFlowCustomCardEditor);
window.customCards = window.customCards || [];
if (!window.customCards.some(x => x.type === "energyflow-custom-card")) window.customCards.push({
  type: "energyflow-custom-card", name: "EnergyFlow Custom Card", preview: true,
  description: "Energiefluss mit beliebig vielen getrennten Stromkreisen (eigene Zähler), PV, Geräten und frei wählbaren Bereichen."
});
