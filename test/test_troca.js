// caminhos relativos a esta pasta, funciona em qualquer maquina
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs=require('fs');const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync(PAINEL,'utf8'),{runScripts:'dangerously',url:'https://x/'});
const w=dom.window;w.DecompressionStream=DecompressionStream;w.CompressionStream=CompressionStream;
w.Response=Response;w.Blob=Blob;w.HTMLElement.prototype.scrollIntoView=function(){};w.Element.prototype.scrollIntoView=function(){};
const fake=p=>{const b=fs.readFileSync(p);return{name:'x',arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
const T=(n,c,x)=>console.log((c?'  ok  ':'  FALHA ')+n+(x?' — '+x:''));
const E=s=>s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
(async()=>{
 await new Promise(r=>setTimeout(r,60));
 await w.receber('prog',fake('in/prog3.xlsx'));await w.receber('mapa',fake('in/mapa.xlsx'));
 await new Promise(r=>setTimeout(r,120));
 const d=w.document;
 const set=(c,v)=>{const i=d.querySelector('[data-nec="'+E(c)+'"]');i.value=v;i.dispatchEvent(new w.Event('input'))};
 set('JBS - BioPower Lins',1050);set('JBS - BioPower Campo Verde',1540);set('Flora SP',300);set('Flora GO',1000);
 w.rodar(); await new Promise(r=>setTimeout(r,80));

 d.querySelector('#map path[data-uf="SP"]').dispatchEvent(new w.Event('click'));
 await new Promise(r=>setTimeout(r,40));
 const nUn=w.DS.plants.filter(p=>p.uf==='SP').length;
 T('botão em todas as unidades de SP', d.querySelectorAll('[data-ed]').length===nUn, nUn+' unidades');
 // AND manda 100% para a BioPower Lins: nao tinha botao antes
 d.querySelector('[data-ed="AND"]').click(); await new Promise(r=>setTimeout(r,40));
 const ops=[...d.querySelectorAll('#detail .opt')];
 console.log('\nranking da AND (35 t, hoje 100% própria):');
 ops.forEach(o=>console.log('    ',o.querySelector('.rk').textContent,
   o.querySelector('.nm').textContent.padEnd(42),
   o.querySelector('.nt').textContent, 'vol', o.querySelector('.vol').value));
 T('lista inclui própria e terceiros', ops.length>=4, ops.length+' opções');
 T('a fábrica própria aparece com os 35 t',
   ops.some(o=>/BioPower Lins/.test(o.querySelector('.nm').textContent) && o.querySelector('.vol').value==='35'));
 T('ranking em ordem de NET',
   ops.map(o=>parseFloat(o.querySelector('.nt').textContent.replace(/[^\d,]/g,'').replace(',','.')))
      .every((v,i,a)=>i===0||a[i-1]>=v));
 T('marca visual do grupo em cada linha', ops.every(o=>!!o.querySelector('.dot')));

 // tira da própria e joga no melhor terceiro
 const antesLins=w.RES.alocFinal.filter(a=>a.cli==='JBS - BioPower Lins').reduce((s,a)=>s+a.ton,0);
 const vProp=ops.find(o=>/BioPower Lins/.test(o.querySelector('.nm').textContent)).querySelector('.vol');
 const vTer=ops.find(o=>!/BioPower|Flora/.test(o.querySelector('.nm').textContent)).querySelector('.vol');
 vProp.value='0'; vProp.dispatchEvent(new w.Event('change'));
 await new Promise(r=>setTimeout(r,60));
 T('avisa que falta destinar', /falta destinar/.test(d.querySelector('#detail .rest')?d.querySelector('#detail .rest').textContent:''),
   (d.querySelector('#detail .rest')||{}).textContent);
 const ops2=[...d.querySelectorAll('#detail .opt')];
 const t2=ops2.find(o=>!/BioPower|Flora/.test(o.querySelector('.nm').textContent)).querySelector('.vol');
 t2.value='35'; t2.dispatchEvent(new w.Event('change'));
 await new Promise(r=>setTimeout(r,60));
 T('total volta a fechar', !d.querySelector('#detail .rest'));
 const depoisLins=w.RES.alocFinal.filter(a=>a.cli==='JBS - BioPower Lins').reduce((s,a)=>s+a.ton,0);
 T('a BioPower Lins continua com 1.050 t (outra unidade cobriu)',
   Math.abs(depoisLins-1050)<0.01, antesLins+' -> '+depoisLins);
 T('total continua 5.915 t',
   Math.abs(w.RES.alocFinal.reduce((s,a)=>s+a.ton,0)-5915)<0.01);
 T('avisa o custo da troca', /fora da indicação/.test(d.querySelector('#avisos').textContent),
   d.querySelector('#avisos').textContent.replace(/\s+/g,' ').trim().slice(0,110));
 w.zerarManual(); await new Promise(r=>setTimeout(r,60));
 T('voltar ao ótimo restaura R$ 31.325.566', Math.round(w.RES.netFinal)===31325566,
   'R$ '+Math.round(w.RES.netFinal).toLocaleString('pt-BR'));
 // Mafra sem cotação
 set('JBS - BioPower Mafra',70); w.rodar(); await new Promise(r=>setTimeout(r,60));
 T('avisa que a Mafra não tem cotação',
   /Mafra.*não tem nenhuma cotação/.test(d.querySelector('#avisos').textContent.replace(/\s+/g,' ')),
   d.querySelector('#avisos').textContent.replace(/\s+/g,' ').trim().slice(0,120));
})().catch(e=>{console.error('ERRO:',e.message,e.stack);process.exit(1)});
