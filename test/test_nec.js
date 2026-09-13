// caminhos relativos a esta pasta, funciona em qualquer maquina
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs=require('fs');const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync(PAINEL,'utf8'),{runScripts:'dangerously',url:'https://x/'});
const w=dom.window;w.DecompressionStream=DecompressionStream;w.CompressionStream=CompressionStream;w.Response=Response;w.Blob=Blob;
w.HTMLElement.prototype.scrollIntoView=function(){};w.Element.prototype.scrollIntoView=function(){};
const fake=(n,p)=>{const b=fs.readFileSync(p);return{name:n,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
const T=(n,c,x)=>console.log((c?'  ok  ':'  FALHA ')+n+(x?' — '+x:''));
const E=s=>s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
(async()=>{
 await new Promise(r=>setTimeout(r,60));
 await w.receber('prog',fake('a','in/prog3.xlsx'));await w.receber('mapa',fake('c','in/mapa.xlsx'));
 await new Promise(r=>setTimeout(r,120));
 const d=w.document;
 const set=(c,v)=>{const i=d.querySelector('[data-nec="'+E(c)+'"]');i.value=v;i.dispatchEvent(new w.Event('input'))};
 set('JBS - BioPower Lins',1050);set('JBS - BioPower Campo Verde',1540);
 set('Flora SP',300);set('Flora GO',1000);
 w.rodar();
 await new Promise(r=>setTimeout(r,60));

 // soltar a trava da Campo Verde
 const cb=d.querySelector('[data-tv="'+E('JBS - BioPower Campo Verde')+'"]');
 cb.checked=false;cb.dispatchEvent(new w.Event('change'));w.rodar();
 await new Promise(r=>setTimeout(r,60));
 const cvSemTrava=w.RES.alocFinal.filter(a=>a.cli==='JBS - BioPower Campo Verde');
 T('sem trava, Campo Verde puxa de outros estados',
   new Set(cvSemTrava.map(a=>a.uf)).size>1,
   [...new Set(cvSemTrava.map(a=>a.uf))].join(','));
 cb.checked=true;cb.dispatchEvent(new w.Event('change'));w.rodar();
 await new Promise(r=>setTimeout(r,60));
 const cvComTrava=w.RES.alocFinal.filter(a=>a.cli==='JBS - BioPower Campo Verde');
 T('com trava, só MT', cvComTrava.every(a=>a.uf==='MT'),
   [...new Set(cvComTrava.map(a=>a.uf))].join(','));

 // volume que não cabe
 set('JBS - BioPower Campo Verde',3000);w.rodar();
 await new Promise(r=>setTimeout(r,80));
 T('avisa quando não cabe na trava',
   d.querySelector('#avisos').textContent.indexOf('Não deu para fechar')>=0,
   d.querySelector('#avisos').textContent.replace(/\s+/g,' ').slice(0,130));
 set('JBS - BioPower Campo Verde',1540);w.rodar();
 await new Promise(r=>setTimeout(r,60));

 // tirar a Flora SP da lista
 d.querySelector('[data-tira="'+E('Flora SP')+'"]').click();
 await new Promise(r=>setTimeout(r,80));
 T('tirou a Flora SP', d.querySelectorAll('.nrow').length===4);
 T('Flora SP virou terceiro',
   w.DS.quotes.some(q=>q.cli==='Flora SP'&&!q.prop));

 // acrescentar de volta
 d.querySelector('#bAddNec').click();
 const opts=[...d.querySelectorAll('#selNec option')].map(o=>o.value);
 T('lista de clientes do mapa para acrescentar', opts.length>20 && opts.indexOf('Flora SP')>=0,
   opts.length+' opções');
 d.querySelector('#selNec').value='Flora SP';
 d.querySelector('#bAddOk').click();
 await new Promise(r=>setTimeout(r,80));
 T('Flora SP voltou', d.querySelectorAll('.nrow').length===5);
 set('Flora SP',300);w.rodar();
 await new Promise(r=>setTimeout(r,80));
 T('números voltam ao original',
   d.querySelector('#necTot').textContent.indexOf('3.890')>=0,
   d.querySelector('#necTot').textContent);
 T('receita NET confere R$ 31.325.566',
   Math.round(w.RES.netFinal)===31325566, 'R$ '+Math.round(w.RES.netFinal).toLocaleString('pt-BR'));
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)});
