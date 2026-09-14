// caminhos relativos a esta pasta, funciona em qualquer maquina
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs=require('fs');const {JSDOM}=require('jsdom');
const SRC=fs.readFileSync(PAINEL,'utf8');
function mk(html){
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://x/'});const w=dom.window;
  w.DecompressionStream=DecompressionStream;w.CompressionStream=CompressionStream;
  w.Response=Response;w.Blob=Blob;w.XMLSerializer=dom.window.XMLSerializer;
  w.btoa=s=>Buffer.from(s,'binary').toString('base64');
  w.atob=s=>Buffer.from(s,'base64').toString('binary');
  w.HTMLElement.prototype.scrollIntoView=function(){};w.Element.prototype.scrollIntoView=function(){};
  w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
  const out=[];const oc=w.document.createElement.bind(w.document);
  w.document.createElement=t=>{const e=oc(t);if(t==='a')e.click=()=>out.push({n:e.download,b:e.__blob});return e};
  w.__cap=out;return {w,dom,out};
}
const fake=(n,p)=>{const b=fs.readFileSync(p);return{name:n,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString('utf8')}};
const T=(n,c,x)=>console.log((c?'  ok  ':'  FALHA ')+n+(x?' — '+x:''));
// O gerador (distribuir()) foi removido, mas arquivos painel_sebo_semana_*.html
// ja distribuidos por ai tem que continuar abrindo — o leitor (boot() lendo
// #bd) fica. Monta o mesmo #bd que distribuir() montava, na mao, com
// montarPacoteDados() (que continua existindo e e o que o Salvar no
// servidor usa tambem).
function montarBd(srcHtml, pacote){
  const json=JSON.stringify(pacote).replace(/</g,'\\u003c');
  return srcHtml.replace(
    '<script id="bd" type="application/json"></script>',
    '<script id="bd" type="application/json">'+json+'</script>'
  );
}
(async()=>{
  const A=mk(SRC);const w=A.w;
  await new Promise(r=>setTimeout(r,50));
  await w.receber('prog',fake('prog.xlsx','in/prog3.xlsx'));
  await w.receber('mapa',fake('mapa.xlsx','in/mapa.xlsx'));
  await new Promise(r=>setTimeout(r,100));
  Object.assign(w.ST.nec,{'JBS - BioPower Lins':1050,'JBS - BioPower Campo Verde':1540,
    'Flora SP':300,'Flora GO':1000});
  w.rodar();
  // faz uma alteração manual
  w.ST.manual['CFS']=[{cli:'Be8 MT At. Arag.(63.228.664/0001-22)',ton:210}];
  w.ST.usuario='Usuário 2'; w.recalcular();
  const pacote=w.montarPacoteDados();
  const html=montarBd(SRC,pacote);
  T('montou o pacote (prod+mapa+estado)', !!pacote.prod && !!pacote.mapa && !!pacote.estado);
  fs.writeFileSync('dist_test.html',html);

  const B=mk(html); const w2=B.w;
  await new Promise(r=>setTimeout(r,150));
  const d=w2.document;
  T('abriu direto, sem importar', !d.querySelector('#app').classList.contains('hide'));
  T('caixa de importação escondida', d.querySelector('#importBox').classList.contains('hide'));
  const k=[...d.querySelectorAll('.kpi .vl')].map(x=>x.textContent);
  T('mesmos números', k[0].indexOf('5.915')>=0 && k[2].indexOf('2.025')>=0, k.join(' | '));
  T('carimbo do Usuário 2', d.querySelector('#stamp').textContent.indexOf('Usuário 2')>0,
    d.querySelector('#stamp').textContent.replace(/\s+/g,' '));
  T('manteve a alteração manual', d.querySelector('#avisos').textContent.indexOf('fora da indicação')>0);
  T('mapa desenhou', d.querySelectorAll('#map path.uf').length===27);
  T('semana no subtítulo', d.querySelector('#sub').textContent.indexOf('Semana 36')===0,
    d.querySelector('#sub').textContent);
  T('painel distribuído mantém a necessidade editável',
    B.w.document.querySelectorAll('#necRows .nrow').length===5);
  T('painel distribuído ainda exporta a programação',
    !B.w.document.querySelector('#bProg').disabled && !!B.w.PROGBUF);
  const rr=await B.w.programacaoPreenchida(B.w.PROGBUF,B.w.PROD,B.w.RES.alocFinal,B.w.OPS);
  const bytes=Buffer.from(await rr.arquivo.arrayBuffer());
  T('planilha sai do painel fechado', bytes.length>10000 && bytes[0]===0x50,
    (bytes.length/1024).toFixed(1)+' KB');
})().catch(e=>{console.error('ERRO:',e.message,e.stack);process.exit(1)});
