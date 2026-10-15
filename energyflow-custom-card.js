/* EnergyFlow Custom Card — v0.5.4
 * Two electrically separate meters. PV connects exclusively to meter 1.
 *
 * Flow geometry: circles and SVG paths share ONE pixel coordinate system.
 * The flow area is measured (ResizeObserver), all positions are derived from
 * the constants in _geom(), and the SVG viewBox equals the real pixel size
 * (no non-uniform scaling). Changing a constant moves circles and lines together.
 */
class EnergyFlowCustomCard extends HTMLElement {
  static getStubConfig() { return {house:{grid:"sensor.wattwachter_energy_now",solar:"sensor.solax_pv_power_total",total:"sensor.hausverbrauch_aktuell"},heat_pump:{power:"sensor.wattwachter_2_energy_now"},ev:{power:"sensor.evcc_daheimladen_smart_pro_charge_power",soc:"sensor.az_b_489_state_of_charge"}}; }
  setConfig(config) {
    if (!config.house?.grid || !config.house?.solar || !config.heat_pump?.power) throw new Error("house.grid, house.solar und heat_pump.power sind erforderlich.");
    this.config=config;
    this._svgKey=null;
    this.render();
  }
  set hass(value) { this._hass=value; if(this.config) this.render(); }
  connectedCallback(){
    if(!this._ro && window.ResizeObserver){
      this._ro=new ResizeObserver(entries=>{const w=Math.round(entries[0].contentRect.width);if(w>0&&w!==this._w){this._w=w;if(this.config)this.render();}});
    }
    if(this._ro&&this._flow)this._ro.observe(this._flow);
  }
  disconnectedCallback(){if(this._ro)this._ro.disconnect();}
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

  /* ---------- Layout constants (pixels in the flow area) ----------
   * Proportions follow Power Flow Card Plus: 80 px circles, PV top centre,
   * grid left / house right on one row, EV above house, branch lines leave the
   * PV circle left/right of its centre and reach grid/house above the blue line. */
  _geom(W){
    const R=W<400?36:40;                 // circle radius (PFC+: 80 px diameter)
    const L={W,R};
    L.xL=R+12;                           // left column  (Netz Haus, Netz WP)
    L.xC=W/2;                            // centre column (PV, Wärmepumpe)
    L.xR=W-R-12;                         // right column (Haus, Auto)
    L.yTop=R+24;                         // PV / Auto row (room for label above)
    L.yMid=L.yTop+Math.round(R*2.8);     // Netz Haus / Haus row
    L.yWp=L.yMid+R*2+70;                 // heat-pump row, clearly separated
    L.H=L.yWp+R+28;                      // total flow height incl. labels below
    L.branchDx=Math.round(R*0.45);       // PV connection offset from PV centre (x)
    L.branchDy=Math.round(R*0.38);       // branch line offset above grid/house centre (y)
    return L;
  }
  /* Vertical leg, quarter-circle bend, horizontal leg: (sx,sy) -> (ex,ey). */
  _elbow(sx,sy,ex,ey){
    const dir=Math.sign(ex-sx)||1, v=ey-sy, h=Math.abs(ex-sx);
    const r=Math.max(0,Math.min(v,h-8)), k=0.5523*r, y1=ey-r, f=n=>Math.round(n*10)/10;
    return {d:'M'+f(sx)+' '+f(sy)+' V'+f(y1)+' C'+f(sx)+' '+f(y1+k)+' '+f(sx+dir*(r-k))+' '+f(ey)+' '+f(sx+dir*r)+' '+f(ey)+' H'+f(ex),
            len:(v-r)+(h-r)+Math.PI*r/2};
  }
  _paths(L){
    const {R,xL,xC,xR,yTop,yMid,yWp,branchDx:dx,branchDy:dy}=L, f=n=>Math.round(n*10)/10;
    const pvY=yTop+Math.sqrt(R*R-dx*dx);          // point on PV circle bottom at ±dx
    const sideX=Math.sqrt(R*R-dy*dy);              // point on grid/house circle side at -dy
    const line=(x1,y1,x2,y2)=>({d:'M'+f(x1)+' '+f(y1)+' L'+f(x2)+' '+f(y2),len:Math.hypot(x2-x1,y2-y1)});
    return {
      solarToGrid:this._elbow(xC-dx,pvY,xL+sideX,yMid-dy),   // violet: PV -> Netz Haus
      solarToHome:this._elbow(xC+dx,pvY,xR-sideX,yMid-dy),   // orange: PV -> Haus
      gridToHome:line(xL+R,yMid,xR-R,yMid),                 // blue:   Netz Haus -> Haus
      homeToEv:line(xR,yMid-R,xR,yTop+R),                   // green:  Haus -> Auto
      gridToWp:line(xL+R,yWp,xC-R,yWp)                      // violet: Netz WP -> Wärmepumpe
    };
  }
  ensureSkeleton(){
    if(this._flow)return;
    if(!this.shadowRoot)this.attachShadow({mode:"open"});
    this.shadowRoot.innerHTML='<style>'+this.css()+'</style><ha-card><div class="flow-layout"><svg class="flow-wires" aria-hidden="true"></svg><div class="flow-nodes"></div></div><div class="panels"></div></ha-card>';
    this._flow=this.shadowRoot.querySelector(".flow-layout");
    this._svg=this.shadowRoot.querySelector(".flow-wires");
    this._nodes=this.shadowRoot.querySelector(".flow-nodes");
    this._below=this.shadowRoot.querySelector(".panels");
    const card=this.shadowRoot.querySelector("ha-card");
    const pick=ev=>ev.composedPath().find(el=>el.getAttribute&&el.getAttribute("data-e"));
    card.addEventListener("click",ev=>{const el=pick(ev);if(el)this.click(el.getAttribute("data-e"));});
    card.addEventListener("keydown",ev=>{if(ev.key!=="Enter")return;const el=pick(ev);if(el)this.click(el.getAttribute("data-e"));});
    if(this._ro&&this.isConnected)this._ro.observe(this._flow);
  }
  render(){
    if(!this.config)return;
    try{this._render();this._err=null;}
    catch(err){   // never let a render problem become a HA "Konfigurationsfehler": show the real message instead
      console.error("EnergyFlow Custom Card:",err);
      if(!this.shadowRoot)this.attachShadow({mode:"open"});
      this._flow=null;this._svgKey=null;
      this.shadowRoot.innerHTML='<ha-card style="display:block;padding:16px"><strong>EnergyFlow Custom Card – Fehler</strong><pre style="white-space:pre-wrap;font-size:12px;margin:8px 0 0">'+this.esc(err&&err.stack?err.stack:String(err))+'</pre></ha-card>';
    }
  }
  _render(){
    this.ensureSkeleton();
    if(!this._w&&this._flow.clientWidth)this._w=this._flow.clientWidth;
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

    /* ---------- Flow diagram ---------- */
    const L=this._geom(this._w||470), P=this._paths(L), MIN=5;
    const active={
      solarToGrid:grid!==null&&-grid>MIN,
      solarToHome:pvUse!==null&&pvUse>MIN,
      gridToHome:grid!==null&&grid>MIN,
      homeToEv:ev!==null&&ev>MIN,
      gridToWp:hp!==null&&hp>MIN
    };
    this._flow.style.height=L.H+'px';
    this._flow.classList.toggle('compact',L.R<40);
    const key=L.W+'|'+Object.values(active).join(',');
    if(key!==this._svgKey){   // rebuild SVG only on geometry/activity change, so dots keep moving smoothly
      this._svgKey=key;
      const wire=(k,cls)=>'<path class="wire '+cls+(active[k]?'':' idle')+'" d="'+P[k].d+'"/>';
      const dot=(k,cls)=>active[k]?'<circle class="dot '+cls+'" r="4.5"><animateMotion dur="'+Math.max(1.6,P[k].len/70).toFixed(2)+'s" repeatCount="indefinite" path="'+P[k].d+'"/></circle>':'';
      this._svg.setAttribute("viewBox","0 0 "+L.W+" "+L.H);
      this._svg.innerHTML=wire('gridToHome','grid-to-home')+wire('solarToGrid','solar-to-grid')+wire('solarToHome','solar-to-home')+wire('homeToEv','ev-line')+wire('gridToWp','wp-wire')+
        dot('gridToHome','dot-blue')+dot('solarToGrid','dot-purple')+dot('solarToHome','dot-orange')+dot('homeToEv','dot-green')+dot('gridToWp','dot-wp');
    }
    const ico=(name,color)=>'<ha-icon icon="'+this.esc(name)+'" style="color:'+color+';--mdc-icon-size:25px"></ha-icon>';
    const node=(x,y,labelPos,name,value,icon,color,entity,extra='')=>'<div class="flow-node" style="left:'+x+'px;top:'+y+'px;--node-color:'+color+';--d:'+(L.R*2)+'px" data-e="'+this.esc(entity||'')+'"'+(entity?' tabindex="0" role="button"':'')+'>'+(extra?'<span class="node-extra">'+this.esc(extra)+'</span>':'')+ico(icon,color)+'<strong>'+this.esc(value)+'</strong><span class="flow-label '+labelPos+'">'+this.esc(name)+'</span></div>';
    this._nodes.innerHTML=
      node(L.xC,L.yTop,'above',"PV-Produktion",this.fmt(solar),"mdi:solar-power","#e9a219",h.solar)+
      node(L.xL,L.yMid,'below',"Netz Haus",grid===null?"–":(grid<0?"← ":"→ ")+this.fmt(Math.abs(grid)),"mdi:transmission-tower",grid<0?"#aa70dc":"#329af0",h.grid)+
      node(L.xR,L.yMid,'below',"Haus",this.fmt(hv),"mdi:home","#e9a219",h.total)+
      node(L.xR,L.yTop,'above',"Auto",this.fmt(ev),"mdi:car","#24a85a",e.power,soc===null?"":Math.round(soc)+" %")+
      node(L.xL,L.yWp,'below',"Netz WP",this.fmt(hp),"mdi:transmission-tower","#399ef2",wp.power)+
      node(L.xC,L.yWp,'below',"Wärmepumpe",this.fmt(hp),"mdi:heat-pump","#b184e5",wp.power);

    /* ---------- Panels below the diagram (unchanged content) ---------- */
    const gauge=(label,percent,color)=>{const good=Number.isFinite(percent),p=good?Math.min(100,Math.max(0,percent)):0;const dash=(p*1.445).toFixed(1);return '<div class="gauge"><svg class="gauge-svg" lang="de" viewBox="0 0 140 85" aria-label="'+this.esc(label)+'"><path d="M15 75 A55 55 0 0 1 125 75" class="gauge-track"/><path d="M15 75 A55 55 0 0 1 125 75" class="gauge-fill" style="stroke:'+color+';stroke-dasharray:'+dash+' 200"/></svg><strong>'+(good?Math.round(percent)+' %':'–')+'</strong><span>'+label+'</span></div>';};
    const consumer=(name,power,icon,color,entity)=>'<div class="consumer" data-e="'+this.esc(entity||'')+'">'+ico(icon,color)+'<span>'+this.esc(name)+'</span><strong>'+this.fmt(power)+'</strong></div>';
    const entries=Array.isArray(c.consumers)?c.consumers:[];
    const consumerRows=entries.map(x=>consumer(x.name||x.entity,this.watts(x.entity),x.icon||'mdi:flash','#'+String(x.color||'9c80d4').replace(/^#/,'') ,x.entity)).join('');
    const wpTotal=this.kwh(wp.meter_reading),houseTotal=this.kwh(h.meter_reading);
    const compressorStatus=wp.compressor_status||"sensor.buderus_gateway_101730536_kompressorstatus";
    const heaterStatus=wp.heater_status||"sensor.buderus_gateway_101730536_heizstabstatus";
    const compressorEnergy=wp.compressor_energy||"sensor.buderus_gateway_101730536_stromverbrauch_warmepumpe_gesamt";
    const heaterEnergy=wp.heater_energy||"sensor.buderus_gateway_101730536_stromverbrauch_elektrischer_zuheizer_gesamt";
    const statusLabel=id=>{const raw=this.state(id)?.state;if(!raw||["unknown","unavailable"].includes(raw))return "–";return ({off:"Aus",heating:"Heizen",cooling:"Kühlen",dhw:"Warmwasser",defrost:"Abtauen",alarm:"Störung",pool:"Pool",pool_heat:"Pool heizen"}[raw]||raw);};
    const deviceRow=(label,icon,statusId,energyId,powerId)=>'<div class="wp-detail" data-e="'+this.esc(statusId)+'">'+ico(icon,"#b184e5")+'<div class="wp-detail-main"><strong>'+this.esc(label)+'</strong><span>'+this.esc(statusLabel(statusId))+'</span></div><div class="wp-detail-values">'+(powerId?'<strong>'+this.fmt(this.watts(powerId))+'</strong>':'')+'<span>'+this.fmtKwh(this.kwh(energyId))+' gesamt</span></div></div>';
    this._below.innerHTML=
      '<div class="meters"><section class="panel"><h3>'+ico('mdi:home-lightning-bolt','#e9a219')+' Hausstrom</h3>'+
      '<div class="metric"><span>Aktuelle Leistung<strong>'+this.fmt(hv)+'</strong></span><span>Zählerstand<strong>'+this.fmtKwh(houseTotal)+'</strong></span></div>'+
      '<div class="stack"><i style="width:'+pHouse+'%;background:#349ce9"></i><i style="width:'+pEv+'%;background:#23985c"></i></div>'+
      consumer('Hausverbrauch',base,'mdi:home','#349ce9','')+consumer('Wallbox',ev,'mdi:car','#23985c',e.power)+consumerRows+'</section>'+
      '<section class="panel"><h3>'+ico('mdi:heat-pump','#b184e5')+' Wärmestrom</h3>'+
      '<div class="metric"><span>Aktuelle Leistung<strong>'+this.fmt(hp)+'</strong></span><span>Zählerstand<strong>'+this.fmtKwh(wpTotal)+'</strong></span></div>'+
      deviceRow('Kompressor','mdi:heat-pump',compressorStatus,compressorEnergy,wp.compressor_power)+
      deviceRow('Heizstab','mdi:radiator',heaterStatus,heaterEnergy,wp.heater_power)+'</section></div>'+
      '<section class="panel balance"><h3>'+ico('mdi:solar-power','#e9a219')+' PV & Bilanz <span class="hint">Hausstromkreis</span></h3>'+
      '<div class="kpis"><div class="kpi"><span>PV-Produktion</span><strong>'+this.fmt(solar)+'</strong></div>'+
      '<div class="kpi"><span>PV-Einspeisung</span><strong>'+this.fmt(grid===null?null:Math.max(0,-grid))+'</strong></div>'+
      gauge('Eigenverbrauchsquote',own,'#f0ba27')+gauge('Autarkiegrad',autarky,'#46c97d')+'</div></section>';
  }
  css(){return `
    :host{display:block}*{box-sizing:border-box}
    ha-card{display:block;background:var(--ha-card-background,rgba(36,39,58,.72));border:1px solid rgba(202,211,245,.12);border-radius:22px;padding:16px;color:var(--primary-text-color,#fff);box-shadow:none;overflow:hidden;font-family:var(--primary-font-family,Roboto,"Arial",sans-serif)}
    h3{display:flex;align-items:center;gap:8px}
    .flow-layout{position:relative;isolation:isolate;margin:0 0 20px;width:100%}
    .flow-wires{position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;pointer-events:none;overflow:visible}
    .wire{fill:none;stroke-width:2;stroke-linecap:round;opacity:.9;transition:opacity .4s}
    .wire.idle{opacity:.22}
    .solar-to-grid,.wp-wire{stroke:#a66add}.solar-to-home{stroke:#e9a219}.grid-to-home{stroke:#329af0}.ev-line{stroke:#269d54}
    .dot-purple,.dot-wp{fill:#b177e2}.dot-orange{fill:#e9a219}.dot-blue{fill:#329af0}.dot-green{fill:#269d54}
    .flow-node{position:absolute;z-index:1;width:var(--d);height:var(--d);transform:translate(-50%,-50%);border:2px solid var(--node-color);border-radius:50%;background:var(--card-background-color,#222530);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;line-height:1.12;cursor:pointer;text-align:center;outline:none}
    .flow-node:focus-visible{box-shadow:0 0 0 2px var(--primary-color,#03a9f4)}
    .flow-node strong{font-size:14px;white-space:nowrap;font-weight:500}.node-extra{font-size:11px;color:var(--secondary-text-color,#c8ccd9)}
    .flow-label{position:absolute;left:50%;transform:translateX(-50%);font-size:13px;line-height:1.25;white-space:nowrap;font-weight:400;color:var(--secondary-text-color,#abb2c0)}
    .compact .flow-node strong{font-size:12px}.compact .flow-label{font-size:12px}.compact .flow-node ha-icon{--mdc-icon-size:22px!important}
    .flow-label.above{bottom:calc(100% + 5px)}.flow-label.below{top:calc(100% + 5px)}
    .meters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
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
    .balance{margin-top:12px}.balance h3{margin-bottom:14px}.balance .hint{margin:0 0 0 auto;font-weight:400}
    .panels{container-type:inline-size}
    .kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 10px;align-items:start}
    @container (min-width:430px){.kpis{grid-template-columns:minmax(0,.8fr) minmax(0,.8fr) minmax(0,1.2fr) minmax(0,1.2fr);gap:8px}}
    .kpi{display:flex;flex-direction:column;gap:11px;font-size:12px;color:var(--secondary-text-color,#abb2c0);padding-top:13px}
    .kpi strong{font-size:17px;color:var(--primary-text-color,#fff)}
    .gauge{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0;position:relative}
    .gauge-svg{display:block;width:100%;max-width:170px;height:auto;overflow:visible}
    .gauge-track,.gauge-fill{fill:none;stroke-width:14;stroke-linecap:butt}
    .gauge-track{stroke:#353d4d}.gauge-fill{stroke-dashoffset:0}
    .gauge strong{font-size:20px;position:relative;margin-top:-30px;z-index:1}
    .gauge span{font-size:12px;color:var(--secondary-text-color,#abb2c0);margin-top:8px;line-height:1.3;overflow-wrap:normal;hyphens:auto}
    .wp-detail{display:flex;align-items:center;gap:8px;padding:11px 0;border-top:1px solid rgba(202,211,245,.08);min-width:0}
    .wp-detail ha-icon{flex-shrink:0;--mdc-icon-size:21px!important}
    .wp-detail-main{display:flex;flex-direction:column;gap:3px;min-width:0;font-size:13px}
    .wp-detail-main span{color:var(--secondary-text-color,#abb2c0);font-size:12px}
    .wp-detail-values{display:flex;flex-direction:column;text-align:right;gap:3px;margin-left:auto;white-space:nowrap}
    .wp-detail-values strong{font-size:13px}.wp-detail-values span{font-size:11px;color:var(--secondary-text-color,#abb2c0)}
    @media(max-width:460px){ha-card{padding:11px}.meters{grid-template-columns:1fr}.panel{padding:13px}}
    @media(prefers-reduced-motion:reduce){.dot{display:none}}
  `;}
}
if(!customElements.get("energyflow-custom-card"))customElements.define("energyflow-custom-card",EnergyFlowCustomCard);
window.customCards=window.customCards||[];
if(!window.customCards.some(x=>x.type==="energyflow-custom-card"))window.customCards.push({type:"energyflow-custom-card",name:"EnergyFlow Custom Card",description:"Hausstrom und Wärmepumpe als getrennte Stromkreise mit Live-Verbrauchern."});
