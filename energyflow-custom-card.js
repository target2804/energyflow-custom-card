/* EnergyFlow Custom Card — v0.4.0
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
    const ico=(name,color)=>'<ha-icon icon="'+this.esc(name)+'" style="color:'+color+';--mdc-icon-size:25px"></ha-icon>';
    const circle=(name,value,icon,color,entity,extra='')=>'<div class="flow-node" data-e="'+this.esc(entity||'')+'"><div class="flow-circle" style="--node-color:'+color+'">'+(extra?'<span class="node-extra">'+this.esc(extra)+'</span>':'')+ico(icon,color)+'<strong>'+this.esc(value)+'</strong></div><span class="flow-label">'+this.esc(name)+'</span></div>';
    const gauge=(label,percent,color)=>{const good=Number.isFinite(percent),p=good?Math.min(100,Math.max(0,percent)):0;const dash=(p*1.445).toFixed(1);return '<div class="gauge"><svg class="gauge-svg" viewBox="0 0 140 85" aria-label="'+this.esc(label)+'"><path d="M15 75 A55 55 0 0 1 125 75" class="gauge-track"/><path d="M15 75 A55 55 0 0 1 125 75" class="gauge-fill" style="stroke:'+color+';stroke-dasharray:'+dash+' 200"/></svg><strong>'+(good?Math.round(percent)+' %':'–')+'</strong><span>'+label+'</span></div>';};
    const consumer=(name,power,icon,color,entity)=>'<div class="consumer" data-e="'+this.esc(entity||'')+'">'+ico(icon,color)+'<span>'+this.esc(name)+'</span><strong>'+this.fmt(power)+'</strong></div>';
    const entries=Array.isArray(c.consumers)?c.consumers:[];
    const consumerRows=entries.map(x=>consumer(x.name||x.entity,this.watts(x.entity),x.icon||'mdi:flash','#'+String(x.color||'9c80d4').replace(/^#/,'') ,x.entity)).join('');
    const wpTotal=this.kwh(wp.meter_reading),houseTotal=this.kwh(h.meter_reading);
    this.shadowRoot.innerHTML='<style>'+this.css()+'</style>'+
      '<ha-card><div class="head"><span>'+ico('mdi:transmission-tower','#cfd6e5')+' '+this.esc(c.title||'Energiefluss')+'</span></div>'+
      '<div class="flow-layout"><svg class="flow-wires" viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">'+
      '<path class="wire solar-to-grid" d="M135 258 C290 258 335 90 500 90"/><path class="wire solar-to-home" d="M500 90 C642 90 693 285 865 285"/><path class="wire grid-to-home" d="M135 258 C395 275 603 285 865 285"/><path class="wire ev-line" d="M865 68 V285"/><path class="wire wp-wire" d="M135 441 H485"/>'+
      '<circle class="dot dot-purple" r="5"><animateMotion dur="5s" repeatCount="indefinite" path="M135 258 C290 258 335 90 500 90"/></circle>'+
      '<circle class="dot dot-orange" r="5"><animateMotion dur="4s" repeatCount="indefinite" path="M500 90 C642 90 693 285 865 285"/></circle>'+
      '<circle class="dot dot-blue" r="5"><animateMotion dur="4.5s" repeatCount="indefinite" path="M135 258 C395 275 603 285 865 285"/></circle>'+
      '<circle class="dot dot-wp" r="5"><animateMotion dur="5s" repeatCount="indefinite" path="M135 441 H485"/></circle></svg>'+
      '<div class="flow-pv">'+circle("PV-Produktion",this.fmt(solar),"mdi:solar-power","#e9a219",h.solar)+'</div>'+
      '<div class="flow-grid">'+circle("Netz Haus",grid===null?"–":(grid<0?"← ":"→ ")+this.fmt(Math.abs(grid)),"mdi:transmission-tower",grid<0?"#aa70dc":"#329af0",h.grid)+'</div>'+
      '<div class="flow-home">'+circle("Haus",this.fmt(hv),"mdi:home","#e9a219",h.total)+'</div>'+
      '<div class="flow-ev">'+circle("Auto",this.fmt(ev),"mdi:car","#24a85a",e.power,soc===null?"":Math.round(soc)+" %")+'</div>'+
      '<div class="flow-gridwp">'+circle("Netz WP",this.fmt(hp),"mdi:transmission-tower","#399ef2",wp.power)+'</div>'+
      '<div class="flow-wp">'+circle("Wärmepumpe",this.fmt(hp),"mdi:heat-pump","#b184e5",wp.power)+'</div></div>'+
      '<div class="meters"><section class="panel"><h3>'+ico('mdi:home-lightning-bolt','#e9a219')+' Hausstrom</h3>'+
      '<div class="metric"><span>Aktuelle Leistung<strong>'+this.fmt(hv)+'</strong></span><span>Zählerstand<strong>'+this.fmtKwh(houseTotal)+'</strong></span></div>'+
      '<div class="stack"><i style="width:'+pHouse+'%;background:#349ce9"></i><i style="width:'+pEv+'%;background:#23985c"></i></div>'+
      consumer('Hausverbrauch',base,'mdi:home','#349ce9','')+consumer('Wallbox',ev,'mdi:car','#23985c',e.power)+consumerRows+'</section>'+
      '<section class="panel"><h3>'+ico('mdi:heat-pump','#b184e5')+' Wärmestrom</h3>'+
      '<div class="metric"><span>Aktuelle Leistung<strong>'+this.fmt(hp)+'</strong></span><span>Zählerstand<strong>'+this.fmtKwh(wpTotal)+'</strong></span></div>'+
      consumer('Wärmepumpe',hp,'mdi:heat-pump','#b184e5',wp.power)+
      '<div class="wp-extra"><span>'+ico('mdi:transmission-tower','#b184e5')+' Netzversorgung</span><strong>'+this.fmt(hp)+'</strong></div>'+
      '<div class="wp-extra"><span>'+ico('mdi:solar-power','#b184e5')+' PV-Versorgung</span><strong>Keine</strong></div></section></div>'+
      '<section class="panel balance"><h3>'+ico('mdi:solar-power','#e9a219')+' PV & Bilanz <span class="hint">Hausstromkreis</span></h3>'+
      '<div class="kpis"><div class="kpi"><span>PV-Produktion</span><strong>'+this.fmt(solar)+'</strong></div>'+
      '<div class="kpi"><span>PV-Einspeisung</span><strong>'+this.fmt(grid===null?null:Math.max(0,-grid))+'</strong></div>'+
      gauge('Eigenverbrauchsquote',own,'#f0ba27')+gauge('Autarkiegrad',autarky,'#46c97d')+'</div></section></ha-card>';
    this.shadowRoot.querySelectorAll("[data-e]").forEach(el=>{let id=el.getAttribute("data-e");if(id){el.addEventListener("click",()=>this.click(id));el.addEventListener("keydown",ev=>{if(ev.key==="Enter")this.click(id);});}});
  }
  css(){return `
    :host{display:block}*{box-sizing:border-box}
    ha-card{background:var(--ha-card-background,rgba(36,39,58,.72));border:1px solid rgba(202,211,245,.12);border-radius:22px;padding:16px;color:var(--primary-text-color,#fff);box-shadow:none;overflow:hidden;font-family:var(--primary-font-family,Roboto,"Arial",sans-serif)}
    .head{display:flex;justify-content:space-between;align-items:center;font-size:19px;font-weight:600;margin-bottom:15px}
    .head>span,h3{display:flex;align-items:center;gap:8px}.head small{font-size:12px;color:#31c47a;font-weight:500}
    .flow-layout{height:335px;position:relative;isolation:isolate;margin:0 0 20px}
    .flow-wires{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}
    .wire{fill:none;stroke-width:2.6;stroke-linecap:round;opacity:.85}
    .solar-to-grid,.wp-wire{stroke:#a66add}.solar-to-home{stroke:#e9a219}.grid-to-home{stroke:#329af0}.ev-line{stroke:#269d54}
    .dot-purple,.dot-wp{fill:#b177e2}.dot-orange{fill:#e9a219}.dot-blue{fill:#329af0}
    .flow-node{display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;text-align:center}
    .flow-circle{width:78px;height:78px;border:2px solid var(--node-color);border-radius:50%;background:var(--card-background-color,#222530);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;line-height:1.12}
    .flow-circle strong{font-size:14px;white-space:nowrap;font-weight:600}.node-extra{font-size:11px;color:#c8ccd9}
    .flow-label{font-size:13px;line-height:1.25;white-space:nowrap;font-weight:400;order:2}.flow-pv .flow-label,.flow-ev .flow-label{order:-1;margin-bottom:3px}
    .flow-pv,.flow-grid,.flow-home,.flow-ev,.flow-gridwp,.flow-wp{position:absolute;transform:translateX(-50%);z-index:1}
    .flow-pv{left:50%;top:7px}.flow-grid{left:13.5%;top:145px}.flow-home{left:86.5%;top:145px}
    .flow-ev{left:86.5%;top:5px}.flow-gridwp{left:13.5%;top:245px}.flow-wp{left:48.5%;top:245px}
    .meters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
    .panel{border:1px solid rgba(202,211,245,.12);border-radius:17px;padding:12px;background:rgba(15,20,35,.16);min-width:0}
    h3{font-size:15px;line-height:1.35;font-weight:600;margin:0 0 5px;overflow-wrap:normal}
    h3 ha-icon,.consumer ha-icon,.wp-extra ha-icon{flex-shrink:0}
    .hint{font-size:12px;color:var(--secondary-text-color,#abb2c0);margin:0 0 13px}
    .metric{display:flex;justify-content:space-between;gap:7px;color:var(--secondary-text-color,#abb2c0);font-size:12px;flex-wrap:wrap}
    .metric span:last-child{text-align:right}.metric strong{display:block;font-size:16px;color:var(--primary-text-color,#fff);margin-top:6px;white-space:nowrap}
    .stack{height:9px;background:#343b4a;border-radius:10px;display:flex;overflow:hidden;margin:14px 0 10px}
    .consumer,.wp-extra{display:flex;align-items:center;gap:6px;font-size:12px;padding:7px 0}
    .consumer ha-icon,.wp-extra ha-icon{--mdc-icon-size:20px!important}
    .consumer span,.wp-extra span{min-width:0;flex:1}.consumer strong,.wp-extra strong{margin-left:auto;text-align:right;white-space:nowrap;font-size:12px}
    .wp-extra{border-top:1px solid rgba(202,211,245,.08);padding:10px 0}.wp-extra:first-of-type{margin-top:15px}
    .balance{margin-top:12px}.balance h3{margin-bottom:14px}.balance .hint{margin:0 0 0 auto;font-weight:400}
    .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;align-items:start}
    .kpi{display:flex;flex-direction:column;gap:11px;font-size:12px;color:var(--secondary-text-color,#abb2c0);padding-top:13px}
    .kpi strong{font-size:17px;color:var(--primary-text-color,#fff)}
    .gauge{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0;position:relative}
    .gauge-svg{display:block;width:100%;max-width:125px;height:77px;overflow:visible}
    .gauge-track,.gauge-fill{fill:none;stroke-width:13;stroke-linecap:butt}
    .gauge-track{stroke:#353d4d}.gauge-fill{stroke-dashoffset:0}
    .gauge strong{font-size:17px;position:relative;margin-top:-24px;z-index:1}
    .gauge span{font-size:11px;color:var(--secondary-text-color,#abb2c0);margin-top:6px;line-height:1.3;overflow-wrap:anywhere}
    @media(max-width:460px){ha-card{padding:11px}.flow-circle{width:69px;height:69px}.flow-circle strong{font-size:12px}.flow-label{font-size:12px}.meters{grid-template-columns:1fr}.panel{padding:13px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:15px}.flow-gridwp,.flow-wp{top:236px}}
    @media(prefers-reduced-motion:reduce){.dot{display:none}}
  `;}
}
if(!customElements.get("energyflow-custom-card"))customElements.define("energyflow-custom-card",EnergyFlowCustomCard);
window.customCards=window.customCards||[];
if(!window.customCards.some(x=>x.type==="energyflow-custom-card"))window.customCards.push({type:"energyflow-custom-card",name:"EnergyFlow Custom Card",description:"Hausstrom und Wärmepumpe als getrennte Stromkreise mit Live-Verbrauchern."});
