/* EnergyFlow Custom Card — v0.1.0
 * Two electrically separate meters. PV connects exclusively to meter 1.
 */
class EnergyFlowCustomCard extends HTMLElement {
  static getStubConfig() { return {house:{grid:"sensor.wattwachter_energy_now",solar:"sensor.solax_pv_power_total",total:"sensor.hausverbrauch_aktuell"},heat_pump:{power:"sensor.wattwachter_2_energy_now"},ev:{power:"sensor.evcc_daheimladen_smart_pro_charge_power",soc:"sensor.az_b_489_state_of_charge"}}; }
  setConfig(config) {
    if (!config.house?.grid || !config.house?.solar || !config.heat_pump?.power) throw new Error("house.grid, house.solar und heat_pump.power sind erforderlich.");
    this.config=config;
    if (!this.shadowRoot) this.attachShadow({mode:"open"});
    this.render();
  }
  set hass(value) { this._hass=value; if(this.config) this.render(); }
  getCardSize(){return 9;}
  getGridOptions(){return {columns:12,min_columns:6};}
  state(id){return id && this._hass?.states?.[id];}
  val(id){const s=this.state(id); if(!s || ["unknown","unavailable"].includes(s.state)) return null; const n=Number(s.state.replace(",","."));return Number.isFinite(n)?n:null;}
  watts(id){const v=this.val(id);if(v===null)return null;const u=(this.state(id)?.attributes?.unit_of_measurement||"W").toLowerCase();return u==="kw"?v*1000:v;}
  kwh(id){const v=this.val(id);if(v===null)return null;const u=(this.state(id)?.attributes?.unit_of_measurement||"kWh").toLowerCase();return u==="wh"?v/1000:v;}
  fmt(v){if(v===null||v===undefined||!Number.isFinite(v))return "–";return Math.abs(v)>=1000?(v/1000).toLocaleString("de-DE",{maximumFractionDigits:2})+" kW":Math.round(v).toLocaleString("de-DE")+" W";}
  fmtKwh(v){return v===null?"–":v.toLocaleString("de-DE",{maximumFractionDigits:1})+" kWh";}
  esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  click(id){if(!id)return;this.dispatchEvent(new CustomEvent("hass-more-info",{bubbles:true,composed:true,detail:{entityId:id}}));}
  render(){
    const c=this.config,h=c.house,wp=c.heat_pump,e=c.ev||{};
    const solar=this.watts(h.solar),grid=this.watts(h.grid),house=this.watts(h.total);
    const hp=this.watts(wp.power), ev=this.watts(e.power),soc=this.val(e.soc);
    const hv=house!==null?house:(solar!==null&&grid!==null?Math.max(0,solar+grid):null);
    const base=hv!==null&&ev!==null?Math.max(0,hv-ev):null;
    const pHouse=hv&&base!==null?Math.min(100,Math.max(0,base/hv*100)):0;
    const pEv=hv&&ev!==null?Math.min(100,Math.max(0,ev/hv*100)):0;
    const pvUse=solar===null||grid===null?null:Math.max(0,solar-Math.max(0,-grid));
    const own=solar>0&&pvUse!==null?Math.min(100,Math.round(pvUse/solar*100)):null;
    const autarky=hv>0&&pvUse!==null?Math.min(100,Math.round(pvUse/hv*100)):null;
    const entries=Array.isArray(c.consumers)?c.consumers:[];
    const consumerRows=entries.map((x,i)=>{const w=this.watts(x.entity);return '<div class="consumer" data-e="'+this.esc(x.entity)+'"><span class="dot" style="background:'+this.esc(x.color||"#9c80d4")+'"></span><span>'+this.esc(x.name||x.entity)+'</span><strong>'+this.fmt(w)+'</strong></div>'}).join("");
    const node=(x,y,color,icon,label,value,entity,subtitle="")=>'<g class="node" data-e="'+this.esc(entity||"")+'" tabindex="0"><circle cx="'+x+'" cy="'+y+'" r="49" stroke="'+color+'"/><text x="'+x+'" y="'+(y-15)+'" class="node-icon">'+icon+'</text><text x="'+x+'" y="'+(y+11)+'" class="node-value">'+this.esc(value)+'</text><text x="'+x+'" y="'+(y+69)+'" class="node-label">'+label+'</text>'+(subtitle?'<text x="'+x+'" y="'+(y+30)+'" class="node-sub">'+this.esc(subtitle)+'</text>':"")+'</g>';
    this.shadowRoot.innerHTML='<style>'+this.css()+'</style>'+
    '<ha-card><div class="head"><span>▣ &nbsp;'+this.esc(c.title||"Energiefluss")+'</span><span class="live">● Live</span></div>'+
    '<svg class="flow" viewBox="0 0 720 415" role="img" aria-label="Zwei getrennte Stromkreise. Oben Hausstrom mit PV und Wallbox, unten separater Wärmepumpenzähler.">'+
    '<g class="routes"><path class="route purple" d="M130 115 C225 115 236 85 305 85"/><path class="route amber" d="M403 85 Q460 154 550 154"/><path class="route blue" d="M130 154 H550"/><path class="route green" d="M605 102 V154"/><path class="route wp" d="M130 325 H320"/><circle class="flowdot" r="4" fill="#b879ef"><animateMotion dur="4s" repeatCount="indefinite" path="M130 115 C225 115 236 85 305 85"/></circle><circle class="flowdot" r="4" fill="#2196ed"><animateMotion dur="3s" repeatCount="indefinite" path="M130 154 H550"/></circle><circle class="flowdot" r="4" fill="#b879ef"><animateMotion dur="4s" repeatCount="indefinite" path="M130 325 H320"/></circle></g>'+
    node(80,115,"#249bf5","⚡","Netz Haus",grid===null?"–":(grid<0?"↗ ":"↘ ")+this.fmt(Math.abs(grid)),h.grid)+
    node(355,85,"#f6a20a","☀","PV-Produktion",this.fmt(solar),h.solar)+
    node(605,154,"#f6a20a","⌂","Haus",this.fmt(hv),h.total||"")+
    node(605,45,"#27af58","▣","Auto",this.fmt(ev),e.power,soc===null?"":Math.round(soc)+" %")+
    node(80,325,"#299bf5","⚡","Netz WP",this.fmt(hp),wp.power)+
    node(370,325,"#a977e4","✺","Wärmepumpe",this.fmt(hp),wp.power)+
    '</svg>'+
    '<div class="meters"><section class="panel"><h3>⌂ &nbsp; Hausstromzähler <small>(inkl. Wallbox)</small></h3><div class="metric"><span>Leistung <b>'+this.fmt(hv)+'</b></span><span>Zählerstand <b>'+this.fmtKwh(this.kwh(h.meter_reading))+'</b></span></div><div class="stack"><i style="width:'+pHouse+'%;background:#349ce9"></i><i style="width:'+pEv+'%;background:#23985c"></i></div><div class="consumer"><span>⌂ Haus ohne Wallbox</span><strong>'+this.fmt(base)+'</strong></div><div class="consumer"><span>▣ Wallbox</span><strong>'+this.fmt(ev)+'</strong></div>'+consumerRows+'</section>'+
    '<section class="panel"><h3>✺ &nbsp; Wärmepumpenzähler</h3><div class="metric"><span>Leistung <b>'+this.fmt(hp)+'</b></span><span>Zählerstand <b>'+this.fmtKwh(this.kwh(wp.meter_reading))+'</b></span></div><div class="stack"><i style="width:100%;background:#a977e4"></i></div><div class="consumer"><span>✺ Wärmepumpe</span><strong>'+this.fmt(hp)+'</strong></div><p class="note">Separater Stromkreis · keine PV-Zuordnung</p></section></div>'+
    '<div class="balance panel"><h3>☀ &nbsp; PV & Bilanz <small>Hausstromkreis</small></h3><div class="kpis"><div>PV-Erzeugung<b>'+this.fmt(solar)+'</b></div><div>PV-Einspeisung<b>'+this.fmt(grid===null?null:Math.max(0,-grid))+'</b></div><div>Eigenverbrauchsquote<b>'+(own===null?"–":own+" %")+'</b></div><div>Autarkiegrad<b>'+(autarky===null?"–":autarky+" %")+'</b></div></div></div></ha-card>';
    this.shadowRoot.querySelectorAll("[data-e]").forEach(el=>{let id=el.getAttribute("data-e");if(id){el.addEventListener("click",()=>this.click(id));el.addEventListener("keydown",ev=>{if(ev.key==="Enter")this.click(id);});}});
  }
  css(){return \`
    :host{display:block} *{box-sizing:border-box}
    ha-card{background:var(--ha-card-background,rgba(36,39,58,.72));border:1px solid rgba(202,211,245,.12);border-radius:22px;padding:15px;color:var(--primary-text-color,#fff);box-shadow:none;overflow:hidden}
    .head{display:flex;justify-content:space-between;align-items:center;font-size:19px;font-weight:650;margin:0 2px 4px}
    .live{font-size:11px;font-weight:500;color:#31c47a}
    .flow{display:block;width:100%;height:auto;max-height:440px;overflow:visible}
    .route{fill:none;stroke-width:2;stroke-linecap:round}.purple,.wp{stroke:#aa70dc}.amber{stroke:#ef9c0f}.blue{stroke:#278fe5}.green{stroke:#27a851}
    .node{cursor:pointer}.node circle{fill:var(--card-background-color,#20232d);stroke-width:3}.node text{text-anchor:middle;fill:var(--primary-text-color,#fff)}
    .node-icon{font-size:27px}.node-value{font-size:15px;font-weight:700}.node-label{font-size:12px}.node-sub{font-size:11px;fill:#c0c6d2!important}
    .meters{display:grid;grid-template-columns:1fr 1fr;gap:12px}.panel{border:1px solid rgba(202,211,245,.12);border-radius:17px;padding:15px;background:rgba(15,20,35,.16);min-width:0}
    h3{font-size:15px;font-weight:600;margin:0 0 13px}h3 small{font-weight:400;color:var(--secondary-text-color,#aab2c3)}
    .metric{display:flex;justify-content:space-between;gap:12px;color:var(--secondary-text-color,#aab2c3);font-size:12px}.metric span:last-child{text-align:right}.metric b{display:block;color:var(--primary-text-color,#fff);font-size:17px;margin-top:4px}
    .stack{height:9px;border-radius:10px;background:#343b4a;display:flex;overflow:hidden;margin:15px 0}
    .consumer{display:flex;align-items:center;gap:9px;padding:6px 0;font-size:13px}.consumer strong{margin-left:auto;font-weight:600}.dot{width:8px;height:8px;border-radius:50%;flex:none}
    .note{font-size:11px;color:var(--secondary-text-color,#aab2c3);margin:14px 0 0}
    .balance{margin-top:12px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.kpis>div{font-size:12px;color:var(--secondary-text-color,#aab2c3)}.kpis b{display:block;font-size:17px;color:var(--primary-text-color,#fff);margin-top:5px}
    @media(max-width:560px){ha-card{padding:10px}.meters{grid-template-columns:1fr}.head{font-size:17px}.kpis{grid-template-columns:repeat(2,1fr)}.node-label{font-size:12px}}
    @media(prefers-reduced-motion:reduce){.flowdot{display:none}}
  \`;}
}
if(!customElements.get("energyflow-custom-card"))customElements.define("energyflow-custom-card",EnergyFlowCustomCard);
window.customCards=window.customCards||[];
if(!window.customCards.some(x=>x.type==="energyflow-custom-card"))window.customCards.push({type:"energyflow-custom-card",name:"EnergyFlow Custom Card",description:"Hausstrom und Wärmepumpe als getrennte Stromkreise mit Live-Verbrauchern."});
