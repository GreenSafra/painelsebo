// caminhos relativos a esta pasta, funciona em qualquer maquina
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs=require('fs');const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync(PAINEL,'utf8'),{runScripts:'dangerously',url:'https://x/'});
const w=dom.window;
w.DecompressionStream=DecompressionStream;w.CompressionStream=CompressionStream;
w.Response=Response;w.Blob=Blob;w.XMLSerializer=dom.window.XMLSerializer;
w.HTMLElement.prototype.scrollIntoView=function(){};w.Element.prototype.scrollIntoView=function(){};
w.btoa=s=>Buffer.from(s,'binary').toString('base64');w.atob=s=>Buffer.from(s,'base64').toString('binary');
const fake=(n,p)=>{const b=fs.readFileSync(p);return{name:n,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
const T=(n,c,x)=>console.log((c?'  ok  ':'  FALHA ')+n+(x?' — '+x:''));
const E=s=>s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
(async()=>{
 await new Promise(r=>setTimeout(r,60));
 await w.receber('prog',fake('modelo.xlsx','in/Modelo_Programacao.xlsx'));
 await w.receber('mapa',fake('mapa.xlsx','in/mapa.xlsx'));
 await new Promise(r=>setTimeout(r,150));
 T('o painel importa o próprio modelo', !w.document.querySelector('#app').classList.contains('hide'));
 T('lê a linha de exemplo e ignora as 199 em branco', w.PROD.linhas.length===1,
   w.PROD.linhas.length+' linha(s), '+w.PROD.plants.length+' unidade(s)');
 T('ignora a linha de TOTAL', w.PROD.plants.reduce((s,p)=>s+p.ton,0)===105,
   w.PROD.plants.reduce((s,p)=>s+p.ton,0)+' t');
 T('acha as colunas de destino no modelo',
   !!(w.PROD.colDest.cli&&w.PROD.colDest.dst&&w.PROD.colDest.of&&w.PROD.colDest.icms&&
      w.PROD.colDest.modal&&w.PROD.colDest.entrega&&w.PROD.colDest.cts&&w.PROD.colDest.tonProd),
   JSON.stringify(w.PROD.colDest));
 const i=w.document.querySelector('[data-nec="'+E('Flora GO')+'"]');
 i.value=70; i.dispatchEvent(new w.Event('input')); w.rodar();
 await new Promise(r=>setTimeout(r,80));
 const rr=await w.programacaoPreenchida(w.PROGBUF,w.PROD,w.RES.alocFinal,w.OPS);
 const buf=Buffer.from(await rr.arquivo.arrayBuffer());
 fs.writeFileSync('modelo_saida.xlsx',buf);
 T('devolve o modelo preenchido', buf.length>8000, (buf.length/1024).toFixed(1)+' KB');
 const sh=await w.readXlsx({arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)});
 const linhas=sh['Programação'];
 let ib=-1; linhas.forEach((r,i)=>{ if(String(r[0]||'').indexOf('Acumulado por cliente')===0) ib=i; });
 const d=linhas.slice(1, ib>0?ib-1:undefined).filter(r=>r[3]);
 if(ib>0) console.log('   acumulado:',linhas.slice(ib+2).filter(r=>r[1]).map(r=>r[0]+' '+r[1]+' '+r[4]).join(' | '));
 console.log('   linhas devolvidas:',d.length);
 d.forEach(r=>console.log('    ',r.slice(7,15).join(' | ')));
 console.log('   trânsito:',rr.transito.map(x=>x.dias+'d').join(', ')||'nenhum');
 T('dividiu 105 t entre a Flora GO e o terceiro', d.length===2);
})().catch(e=>{console.error('ERRO:',e.message,e.stack);process.exit(1)});
