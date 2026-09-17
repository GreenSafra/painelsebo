// caminhos relativos a esta pasta, funciona em qualquer maquina
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs=require('fs');const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync(PAINEL,'utf8'),
  {runScripts:'dangerously',url:'https://x/'});
const w=dom.window;w.DecompressionStream=DecompressionStream;w.CompressionStream=CompressionStream;w.Response=Response;w.Blob=Blob;
w.HTMLElement.prototype.scrollIntoView=function(){};w.Element.prototype.scrollIntoView=function(){};
const T=(n,c,x)=>console.log((c?'  ok  ':'  FALHA ')+n+(x?' — '+x:''));
(async()=>{
 await new Promise(r=>setTimeout(r,80));
 const d=w.document;
 T('Home visível (é a seção que abre no login)', !d.querySelector('#secaoHome').classList.contains('hide'));
 T('tela de importação escondida (não é a seção padrão)', d.querySelector('#importBox').classList.contains('hide'));
 T('aviso de semana nenhuma aberta aparece', !d.querySelector('#avisoSemSemana').classList.contains('hide'));
 T('painel escondido', d.querySelector('#app').classList.contains('hide'));
 T('salvar desabilitado', d.querySelector('#bSave').disabled);
 T('duas áreas de upload', d.querySelectorAll('.drop').length===2);
 T('logo no topo', (d.querySelector('#lgFriboi').src||'').indexOf('data:image')===0);
 T('logos no rodapé', (d.querySelector('#lgBio').src||'').indexOf('data:image')===0 &&
   (d.querySelector('#lgFlora').src||'').indexOf('data:image')===0);
 T('seletor de usuário com 3 opções', d.querySelectorAll('#who option').length===3);
 // arquivo errado no lugar errado
 const b=fs.readFileSync('in/mapa.xlsx');
 await w.receber('prog',{name:'mapa.xlsx',arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)});
 await new Promise(r=>setTimeout(r,80));
 T('avisa quando o arquivo é o errado', !d.querySelector('#impErr').classList.contains('hide'),
   d.querySelector('#impErr').textContent);
 // arquivo que não é xlsx
 await w.receber('mapa',{name:'x.txt',arrayBuffer:async()=>new ArrayBuffer(40)});
 await new Promise(r=>setTimeout(r,50));
 T('avisa quando não é xlsx', d.querySelector('#impErr').textContent.indexOf('xlsx')>0,
   d.querySelector('#impErr').textContent);
})();
