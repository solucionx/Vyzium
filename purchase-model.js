(function(root) {
  'use strict';
  function days(item, today) {
    if (!item.needed || item.deadline_rule !== 'approval_12_days') return null;
    return Math.round((new Date(item.needed+'T12:00:00')-new Date(today+'T12:00:00'))/86400000);
  }
  function matches(item, filters, today) {
    const f=filters||{}, d=days(item,today);
    return ['buyer','company','group','status','approval'].every(k=>!f[k]||item[k]===f[k]) &&
      (!f.search||`${item.sci} ${item.article} ${item.description}`.toLocaleLowerCase('pt-BR').includes(f.search.toLocaleLowerCase('pt-BR'))) &&
      (!f.control||(f.control==='mapped'?item.maps?.length:!item.maps?.length)) &&
      (!f.deadline||({overdue:d!==null&&d<0,on_time:d!==null&&d>=0,soon:d!==null&&d>=0&&d<=3,future:d>3,none:d===null,urgent:item.urgent})[f.deadline]);
  }
  function summarize(items, today) {
    const scis=new Map(), hotels=new Map();
    for(const item of items) {
      const key=JSON.stringify([item.company,item.sci]);
      if(!scis.has(key))scis.set(key,{company:item.company,dates:[],count:0});
      const sci=scis.get(key);sci.dates.push(days(item,today));sci.count++;
    }
    const total={total:0,on_time:0,overdue:0,none:0,items:items.length};
    for(const sci of scis.values()) {
      const state=sci.dates.some(d=>d!==null&&d<0)?'overdue':sci.dates.some(d=>d===null)?'none':'on_time';
      if(!hotels.has(sci.company))hotels.set(sci.company,{company:sci.company,total:0,on_time:0,overdue:0,none:0,items:0});
      const hotel=hotels.get(sci.company);hotel.total++;hotel[state]++;hotel.items+=sci.count;total.total++;total[state]++;
    }
    return {...total,hotels:[...hotels.values()].sort((a,b)=>a.company.localeCompare(b.company,'pt-BR'))};
  }
  function summarizeLines(items, today) {
    const total={total:items.length,on_time:0,overdue:0,none:0,scis:summarize(items,today).total};
    const hotels=new Map();
    for(const item of items) {
      const d=days(item,today),state=d===null?'none':d<0?'overdue':'on_time';
      if(!hotels.has(item.company))hotels.set(item.company,{company:item.company,total:0,on_time:0,overdue:0,none:0});
      const hotel=hotels.get(item.company);hotel.total++;hotel[state]++;total[state]++;
    }
    return {...total,hotels:[...hotels.values()].sort((a,b)=>a.company.localeCompare(b.company,'pt-BR'))};
  }
  function negotiation(initial, final) {
    const parse=v=>Number(String(v).trim().includes(',')?String(v).replace(/\./g,'').replace(',','.'):v);
    const price=parse(initial),net=String(final).trim()===''?price:parse(final);
    if(!String(initial).trim())return {valid:false,label:'Sem cotação'};
    if(!Number.isFinite(price)||!Number.isFinite(net)||price<=0||net<=0||net>price)return {valid:false,label:'Confira os dois valores'};
    return {valid:true,percent:(price-net)/price*100,saving:price-net,final:net};
  }
  const model={days,matches,summarize,summarizeLines,negotiation};
  if(typeof module!=='undefined'&&module.exports)module.exports=model;else root.PurchaseModel=model;
})(typeof globalThis!=='undefined'?globalThis:this);
