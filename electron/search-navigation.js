'use strict';
function searchNavigation(moduleName, target) {
  if (target == null) return undefined;
  if (!target || typeof target !== 'object' || Array.isArray(target) || target.module !== moduleName) throw new Error('Destino da busca inválido.');
  const field = (key, optional=false) => {
    const value=target[key];
    if (optional && value==='') return '';
    if (typeof value!=='string'||!value.trim()||value.length>512||/[\u0000-\u001f]/.test(value)) throw new Error('Registro da busca inválido.');
    return value;
  };
  if(moduleName==='followup'&&target.kind==='order')return {open_oc:field('oc'),open_supplier:field('supplier_key',true)};
  if(moduleName==='followup'&&target.kind==='supplier')return {open_contact:field('supplier_key')};
  if(moduleName==='compras'&&target.kind==='map')return {open_map:field('map_id')};
  if(moduleName==='compras'&&target.kind==='item')return {open_item:field('item_id')};
  throw new Error('Destino da busca inválido.');
}
module.exports={searchNavigation};
