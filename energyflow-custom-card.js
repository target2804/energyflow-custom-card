/* EnergyFlow Custom Card — v0.2.0
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
    const ico=(name,color)=>'<ha-icon icon="'+this.esc(name)+'" style="color:'+color+';--mdc-icon-size:25px"></ha-icon>';
    const circle=(name,value,icon,color,entity,extra='')=>'<div class="flow-node" data-e="'+this.esc(entity||'')+'"><div class="flow-circle" style="--node-color:'+color+'">'+(extra?'<span class="node-extra">'+this.esc(extra)+'</span>':'')+ico(icon,color)+'<strong>'+this.esc(value)+'</strong></div><span class="flow-label">'+this.esc(name)+'</span></div>';
    const gauge=(label,percent,color)=>{const good=Number.isFinite(percent),p=good?Math.min(100,Math.max(0,percent)):0;return '<div class="gauge"><div class="gauge-arc" style="--gauge-color:'+color+';--gauge-value:'+p+'"><strong>'+(good?Math.round(percent)+' %':'–')+'</strong></div><span>'+label+'</span></div>';};
    const consumer=(name,power,icon,color,entity)=>'<div class="consumer" data-e="'+this.esc(entity||'')+'">'+ico(icon,color)+'<span>'+this.esc(name)+'</span><strong>'+this.fmt(power)+'</strong></div>';
    const entries=Array.isArray(c.consumers)?c.consumers:[];
    const consumerRows=entries.map(x=>consumer(x.name||x.entity,this.watts(x.entity),x.icon||'mdi:flash','#'+String(x.color||'9c80d4').replace(/^#/,'') ,x.entity)).join('');
    const wpTotal=this.kwh(wp.meter_reading),houseTotal=this.kwh(h.meter_reading);
    this.shadowRoot.innerHTML='<style>'+this.css()+'</style>'+
      '<ha-card><div class="head"><span>'+ico('mdi:transmission-tower','#cfd6e5')+' '+this.esc(c.title||'Energiefluss')+'</span><small>● Live</small></div>'+
      '<div class="flow-layout"><svg class="flow-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+
      '<path class="wire solar-to-grid" d="M49 20 C36 20 34 36 13 36"/><path class="wire solar-to-home" d="M51 20 C67 20 65 39 87 39"/><path class="wire grid-to-home" d="M13 43 C39 49 65 49 87 43"/><path class="wire ev-line" d="M87 20 L87 33"/><path class="wire wp-wire" d="M13 79 H49"/></svg>'+
      '<div class="flow-pv">'+circle('PV-Produktion',this.fmt(solar),'mdi:solar-power','#e9a219',h.solar)+'</div>'+
      '<div class="flow-grid">'+circle('Netz Haus',grid===null?'–':(grid<0?'↗ ':'↘ ')+this.fmt(Math.abs(grid)),'mdi:transmission-tower','#329af0',h.grid)+'</div>'+
      '<div class="flow-home">'+circle('Haus',this.fmt(hv),'mdi:home','#e9a219',h.total)+'</div>'+
      '<div class="flow-ev">'+circle('Auto',this.fmt(ev),'mdi:car','#24a85a',e.power,soc===null?'':Math.round(soc)+' %')+'</div>'+
      '<div class="flow-gridwp">'+circle('Netz WP',this.fmt(hp),'mdi:transmission-tower','#399ef2',wp.power)+'</div>'+
      '<div class="flow-wp">'+circle('Wärmepumpe',this.fmt(hp),'mdi:heat-pump','#b184e5',wp.power)+'</div></div>'+
      '<div class="meters"><section class="panel"><h3>'+ico('mdi:home-lightning-bolt','#e9a219')+' Hausstromzähler</h3><p class="hint">Inklusive Wallbox</p>'+
      '<div class="metric"><span>Aktuelle Leistung<strong>'+this.fmt(hv)+'</strong></span><span>Zählerstand<strong>'+this.fmtKwh(houseTotal)+'</strong></span></div>'+
      '<div class="stack"><i style="width:'+pHouse+'%;background:#349ce9"></i><i style="width:'+pEv+'%;background:#23985c"></i></div>'+
      consumer('Haus ohne Wallbox',base,'mdi:home','#349ce9','')+consumer('Wallbox',ev,'mdi:car','#23985c',e.power)+consumerRows+'</section>'+
      '<section class="panel"><h3>'+ico('mdi:heat-pump','#b184e5')+' Wärmepumpenzähler</h3><p class="hint">Separater Stromkreis · ohne PV</p>'+
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
    ha-card{background:var(--ha-card-background,rgba(36,39,58,.72));border:1px solid rgba(202,211,245,.12);border-radius:22px;padding:16px;color:var(--primary-text-color,#fff);box-shadow:none;overflow:hidden}
    .head{display:flex;justify-content:space-between;align-items:center;font-size:20px;font-weight:650;margin:0 0 14px}
    .head>span,h3{display:flex;align-items:center;gap:8px}.head small{font-size:13px;color:#31c47a;font-weight:500}
    .flow-layout{height:350px;position:relative;overflow:hidden;margin-bottom:14px}
    .flow-wires{position:absolute;inset:0;width:100%;height:100%;z-index:0}
    .wire{fill:none;stroke-width:.48;stroke-linecap:round;opacity:.85}
    .solar-to-grid,.wp-wire{stroke:#a66add}.solar-to-home{stroke:#e9a219}.grid-to-home{stroke:#329af0}.ev-line{stroke:#269d54}
    .flow-node{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;text-align:center}
    .flow-circle{width:82px;height:82px;border:2px solid var(--node-color);border-radius:50%;background:var(--card-background-color,#222530);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:14px;line-height:1.15}
    .flow-circle strong{font-size:15px;white-space:nowrap}.node-extra{font-size:11px;color:#c8ccd9}
    .flow-label{font-size:14px;line-height:1.2;white-space:nowrap}
    .flow-pv,.flow-grid,.flow-home,.flow-ev,.flow-gridwp,.flow-wp{position:absolute;transform:translate(-50%,-50%);z-index:1}
    .flow-pv{left:50%;top:21%}.flow-grid{left:13%;top:42%}.flow-home{left:87%;top:47%}
    .flow-ev{left:87%;top:15%}.flow-gridwp{left:13%;top:84%}.flow-wp{left:49%;top:84%}
    .meters{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .panel{border:1px solid rgba(202,211,245,.12);border-radius:17px;padding:15px;background:rgba(15,20,35,.16);min-width:0}
    h3{font-size:17px;line-height:1.35;font-weight:650;margin:0 0 6px;overflow-wrap:anywhere}
    h3 ha-icon,.consumer ha-icon,.wp-extra ha-icon{flex-shrink:0}
    .hint{font-size:13px;color:var(--secondary-text-color,#abb2c0);margin:0 0 16px}
    .metric{display:flex;justify-content:space-between;gap:10px;color:var(--secondary-text-color,#abb2c0);font-size:13px;flex-wrap:wrap}
    .metric span:last-child{text-align:right}.metric strong{display:block;font-size:18px;color:var(--primary-text-color,#fff);margin-top:5px;white-space:nowrap}
    .stack{height:10px;background:#343b4a;border-radius:12px;display:flex;overflow:hidden;margin:16px 0 12px}
    .consumer,.wp-extra{display:flex;align-items:center;gap:8px;font-size:14px;padding:8px 0}
    .consumer span,.wp-extra span{min-width:0;flex:1}.consumer strong,.wp-extra strong{margin-left:auto;text-align:right;white-space:nowrap;font-size:14px}
    .wp-extra{border-top:1px solid rgba(202,211,245,.08);padding:12px 0}.wp-extra:first-of-type{margin-top:18px}
    .balance{margin-top:12px}.balance h3{margin-bottom:17px}.balance .hint{margin:0 0 0 auto;font-weight:400}
    .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:center}
    .kpi{display:flex;flex-direction:column;gap:9px;font-size:14px;color:var(--secondary-text-color,#abb2c0)}
    .kpi strong{font-size:19px;color:var(--primary-text-color,#fff)}
    .gauge{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center}
    .gauge-arc{height:60px;width:112px;max-width:100%;position:relative;overflow:hidden}
    .gauge-arc:before{content:"";position:absolute;left:9%;top:10%;width:82%;aspect-ratio:1;border:11px solid #353d4d;border-radius:50%}
    .gauge-arc:after{content:"";position:absolute;left:9%;top:10%;width:82%;aspect-ratio:1;border:11px solid transparent;border-top-color:var(--gauge-color);border-left-color:var(--gauge-color);border-radius:50%;transform:rotate(calc(-45deg + var(--gauge-value) * 1.8deg))}
    .gauge-arc strong{position:absolute;inset:auto 0 0;z-index:1;font-size:18px}
    .gauge>span{font-size:13px;color:var(--secondary-text-color,#abb2c0)}
    @media(max-width:600px){ha-card{padding:13px}.meters{grid-template-columns:1fr}.flow-layout{height:330px}.flow-circle{width:73px;height:73px}.flow-circle strong{font-size:14px}.flow-label{font-size:12px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.flow-pv{top:22%}.flow-ev{top:15%}}
  `;}
}
if(!customElements.get("energyflow-custom-card"))customElements.define("energyflow-custom-card",EnergyFlowCustomCard);
window.customCards=window.customCards||[];
if(!window.customCards.some(x=>x.type==="energyflow-custom-card"))window.customCards.push({type:"energyflow-custom-card",name:"EnergyFlow Custom Card",description:"Hausstrom und Wärmepumpe als getrennte Stromkreise mit Live-Verbrauchern."});
