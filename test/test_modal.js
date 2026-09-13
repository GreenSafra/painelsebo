// caminhos relativos a esta pasta, funciona em qualquer maquina
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs=require('fs');const {JSDOM}=require('jsdom');
const T=(n,c,x)=>console.log((c?'  ok  ':'  FALHA ')+n+(x?' — '+x:''));
const E=s=>s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
async function abrir(mapa){
  const dom=new JSDOM(fs.readFileSync(PAINEL,'utf8'),{runScripts:'dangerously',url:'https://x/'});
  const w=dom.window;w.DecompressionStream=DecompressionStream;w.CompressionStream=CompressionStream;
  w.Response=Response;w.Blob=Blob;w.XMLSerializer=dom.window.XMLSerializer;
  w.HTMLElement.prototype.scrollIntoView=function(){};w.Element.prototype.scrollIntoView=function(){};
  w.btoa=s=>Buffer.from(s,'binary').toString('base64');w.atob=s=>Buffer.from(s,'base64').toString('binary');
  const fake=p=>{const b=fs.readFileSync(p);return{name:'x',arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
  await new Promise(r=>setTimeout(r,60));
  await w.receber('prog',fake('in/prog4.xlsx'));await w.receber('mapa',fake(mapa));
  await new Promise(r=>setTimeout(r,150));
  return w;
}
(async()=>{
  for (const [nome,arq] of [['mapa 28/08','in/mapa.xlsx'],['mapa 04/09 (Modal CIF/FOB)','in/mapa2.xlsx'],['mapa com a coluna renomeada','in/mapa_ruim.xlsx'],['mapa sem CIF/FOB nenhum','in/mapa_semmodal.xlsx']]) {
    const w=await abrir(arq);
    const set=(c,v)=>{const i=w.document.querySelector('[data-nec="'+E(c)+'"]');if(i){i.value=v;i.dispatchEvent(new w.Event('input'));}};
    set('JBS - BioPower Lins',1015);set('JBS - BioPower Campo Verde',1400);set('Flora SP',300);set('Flora GO',1000);
    w.rodar(); await new Promise(r=>setTimeout(r,80));
    console.log('\n== '+nome);
    console.log('   coluna de modal:',JSON.stringify(w.MAPA.modalCol));
    const vals=new Set(w.MAPA.rows.map(r=>r.modal));
    T('só CIF/FOB nos valores', [...vals].every(v=>v===''||/^(CIF|FOB)$/i.test(v)), [...vals].join(','));
    const r=await w.programacaoPreenchida(w.PROGBUF,w.PROD,w.RES.alocFinal,w.OPS);
    const buf=Buffer.from(await r.arquivo.arrayBuffer());
    const sh=await w.readXlsx({arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)});
    const CD=w.PROD.colDest, ix=L=>L.charCodeAt(0)-65;
    const d=sh['Programação'].slice(1).filter(x=>x[3]);
    const modais=new Set(d.map(x=>String(x[ix(CD.modal)]||'')));
    T('modal gravado como texto CIF/FOB',[...modais].every(v=>v===''||/^(CIF|FOB)$/.test(v)),[...modais].join(','));
    T('data de entrega preenchida nas CIF',
      d.filter(x=>x[ix(CD.modal)]==='CIF').every(x=>+x[ix(CD.entrega)]>0),
      d.filter(x=>x[ix(CD.modal)]==='CIF').length+' cargas CIF');
    const av=w.document.querySelector('#avisos').textContent.replace(/\s+/g,' ');
    console.log('   aviso:', /CIF\/FOB/.test(av)? av.match(/[^.]*CIF\/FOB[^.]*\./)[0].trim() : '(nenhum)');
  }
})().catch(e=>{console.error('ERRO:',e.message,e.stack);process.exit(1)});
