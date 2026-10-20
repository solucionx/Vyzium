'use strict';
const {chromium}=require('playwright');
const fs=require('fs');
const path=require('path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const css=['styles.css','compras.css','operational-ui.css'].map(f=>fs.readFileSync(path.join(root,'renderer',f),'utf8')).join('\n');
  await page.setContent(`<html><head><style>${css}</style></head><body class="module-compras"><main style="padding:24px"><h1>Mapas ativos</h1><div id="cards" class="map-cards"></div></main></body></html>`);
  const source=fs.readFileSync(path.join(root,'renderer/compras-app.js'),'utf8');
  const functions=source.slice(source.indexOf('function quotationDeliveryHtml('),source.indexOf('function drawMapLibrary('));
  await page.addScriptTag({content:`const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); const dateLabel=x=>x; const mapDueBadgeHtml=()=>''; ${functions}`});
  const states=['pending','partial','sent','sending','uncertain','failed'];
  await page.evaluate(states=>{
   document.querySelector('#cards').innerHTML=states.map((state,i)=>mapCardHtml({id:'map'+i,name:'Mapa '+(i+1),count:11,created:'2026-10-20',items:['Material hidráulico','Material elétrico'],scis:['35162','35163'],completion_percent:0,quotation_delivery:{state,total:3,sent:state==='sent'?3:state==='partial'?1:0,uncertain:state==='uncertain'?1:0,failed:state==='failed'?1:0,sending:state==='sending'?1:0}})).join('');
  },states);
  assert.equal(await page.locator('.quotation-delivery').count(),6);
  const expected=['Cotações aguardando envio','Cotações parcialmente enviadas','Cotações enviadas','Cotações em envio','Envio sem confirmação','Falha no envio das cotações'];
  assert.deepEqual(await page.locator('.quotation-delivery').allTextContents(),expected);
  assert.match(await page.locator('.quotation-delivery-detail').nth(1).textContent(),/1 de 3/);
  assert.equal(await page.evaluate(()=>quotationDeliveryHtml({archived:true})), '');
  for(const width of [1440,1000]) {
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>Array.from(document.querySelectorAll('.quotation-delivery')).some(e=>e.scrollWidth>e.clientWidth+1)),false,'Delivery labels must fit');
   const output=process.env.VYZIUM_TEST_OUTPUT_DIR||'/tmp/vyzium-quotation-status';
   fs.mkdirSync(output,{recursive:true});
   await page.screenshot({path:path.join(output,`quotation-status-${width}.png`),fullPage:true});
  }
  console.log('PASS: all delivery states, counts, completed maps and responsive labels');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
