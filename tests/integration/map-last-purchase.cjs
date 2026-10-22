'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const css=['styles.css','compras.css','operational-ui.css'].map(f=>fs.readFileSync(path.join(root,'renderer',f),'utf8')).join('\n');
  await page.setContent(`<style>${css}</style><div class="map-workspace"><div class="purchase-table map-quote-table"><table><tbody>${[1,2,3].map(id=>`<tr><td class="sticky-col item-col description"><strong>Material de manutenção ${id}</strong><small class="map-last-purchase" data-last-purchase="${id}">Consultando…</small></td><td>100 UN</td></tr>`).join('')}</tbody></table></div></div>`);
  await page.addScriptTag({path:path.join(root,'renderer/purchase-history.js')});
  await page.evaluate(async()=>{
   const items=[1,2,3].map(id=>({id,article:String(id),unit:'UN'}));
   await PurchaseHistory.fillMapReferences(document.body,items,async(method,route)=>{
    const q=new URLSearchParams(route.split('?')[1]).get('q');
    return {items:q==='3'?[]:[{article:q,unit:'UN',unit_basis:'order',latest:{oc:'12345',sort_date:'2026-10-22',order_price:q==='1'?125.1234:null,company:'Hotel de referência',supplier:'Fornecedor de referência',price_source:q==='2'?'conflict':'direct',cancelled:q==='2'}}],page:0,page_size:20,total:q==='3'?0:1};
   });
  });
  const labels=await page.locator('.map-last-purchase').allTextContents();
  assert.match(labels[0],/125,1234/);
  assert.match(labels[1],/Não informado.*cancelado/);
  assert.match(labels[2],/sem referência/);
  assert.match(await page.locator('.map-last-purchase').first().getAttribute('title'),/OC 12345.*22\/10\/2026.*Hotel de referência/);
  for(const width of [1440,1000]){
   await page.setViewportSize({width,height:900});
   const cells=await page.locator('.item-col').evaluateAll(cells=>cells.map(el=>({width:getComputedStyle(el).width,overflow:el.scrollWidth>el.clientWidth+1})));
   for(const cell of cells){assert.equal(cell.width,'250px');assert.equal(cell.overflow,false);}
   const output=process.env.VYZIUM_TEST_OUTPUT_DIR||'/tmp/vyzium-map-last-purchase';
   fs.mkdirSync(output,{recursive:true});
   await page.screenshot({path:path.join(output,`map-last-purchase-${width}.png`),fullPage:true});
  }
  console.log('PASS: latest price, missing/conflicting values, cancelled status, metadata and unchanged 250px column');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
