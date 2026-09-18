// caminhos relativos a esta pasta, funciona em qualquer maquina
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs=require('fs');const {JSDOM}=require('jsdom');
const T=(n,c,x)=>console.log((c?'  ok  ':'  FALHA ')+n+(x?' — '+x:''));
const E=s=>s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
(async()=>{
const html=fs.readFileSync(PAINEL,'utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://x/'});
const w=dom.window;w.DecompressionStream=DecompressionStream;w.CompressionStream=CompressionStream;
w.Response=Response;w.Blob=Blob;w.HTMLElement.prototype.scrollIntoView=function(){};w.Element.prototype.scrollIntoView=function(){};
const fake=p=>{const b=fs.readFileSync(p);return{name:'x',arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
await new Promise(r=>setTimeout(r,60));
const d=w.document;
T('meta viewport presente', !!d.querySelector('meta[name=viewport]'),
  (d.querySelector('meta[name=viewport]')||{}).content);
await w.receber('prog',fake('in/prog4.xlsx'));await w.receber('mapa',fake('in/mapa2.xlsx'));
await new Promise(r=>setTimeout(r,150));
const set=(c,v)=>{const i=d.querySelector('[data-nec="'+E(c)+'"]');if(i){i.value=v;i.dispatchEvent(new w.Event('input'));}};
set('JBS - BioPower Lins',1015);set('JBS - BioPower Campo Verde',1400);set('Flora SP',300);set('Flora GO',1000);
w.rodar(); await new Promise(r=>setTimeout(r,80));
d.querySelector('#map path[data-uf="MT"]').dispatchEvent(new w.Event('click'));
await new Promise(r=>setTimeout(r,40));
d.querySelector('[data-ed]').click(); await new Promise(r=>setTimeout(r,40));

const css=html.match(/@media\(max-width:640px\)\{[\s\S]*?\n\}/)[0];
const seletores=[...css.matchAll(/\n\s{2}(\.[a-zA-Z][^{]*)\{/g)].map(m=>m[1].trim());
const faltando=[];
// o popover do usuario so existe no DOM quando o checkbox esta marcado
// (:checked ~ .hlinks) — marca antes de checar, senao o seletor bate certo
// mas nao acha nada porque o estado natural e desmarcado
const toggle=d.getElementById('userToggle'); if(toggle) toggle.checked=true;
seletores.forEach(sel=>{
  sel.split(',').map(s=>s.trim()).forEach(s=>{
    if(/#/.test(s)) return;
    try{ if(!d.querySelector(s)) faltando.push(s); }catch(e){ faltando.push('inválido: '+s); }
  });
});
if(toggle) toggle.checked=false;
T('todos os seletores do CSS móvel existem na página', faltando.length===0, faltando.join(' | '));
const areasNrow=['.nrow img.lg','.nrow .nm','.nrow .x','.nrow .cd','.nrow label.tv','.nrow input.v','.nrow .un','.nrow .cr'];
T('linha da necessidade com todas as áreas', areasNrow.every(s=>!!d.querySelector(s)),
  areasNrow.filter(s=>!d.querySelector(s)).join(','));
const areasOpt=['.opt .dot','.opt .nm','.opt .nt','.opt .gp','.opt input.of','.opt input.vol','.opt .cr'];
T('linha do editor com todas as áreas', areasOpt.every(s=>!!d.querySelector(s)),
  areasOpt.filter(s=>!d.querySelector(s)).join(','));
const inputs=[...d.querySelectorAll('input[type=number]')];
T('campos numéricos existem para receber o tamanho de 16px', inputs.length>0, inputs.length+' campos');
T('mapa em SVG escalável', d.querySelector('#map').getAttribute('viewBox')==='0 0 520 560');
const chaves=['.kpis{grid-template-columns:1fr}','table.t{font-size:12.5px;min-width:430px}','.cmp{grid-template-columns:1fr'];
chaves.forEach(k=>T('regra móvel: '+k.split('{')[0], css.indexOf(k)>=0));
T('regra móvel: .menu (linha rolável, não grade)', /\.menu\{[^}]*overflow-x:auto/.test(css));

 T('meta color-scheme travado em claro', /<meta name="color-scheme" content="light only">/.test(html));
 T('color-scheme only light no :root', /color-scheme:only light/.test(html));
 T('botao com fundo e cor explicitos',
   /\.btn\{background:var\(--paper\);color:var\(--ink\)/.test(html));
 T('sem fundo transparente no botao', !/\.btn\{background:transparent/.test(html));
 T('menu vira uma faixa rolável, não grade de botões (não ocupa metade da tela)',
   /\.menu\{flex-wrap:nowrap;overflow-x:auto/.test(css));
 T('botões do menu não quebram linha (rolagem horizontal)', /\.menu \.btn\{flex:none;white-space:nowrap/.test(css));
 // pedido explicito da tarefa de cabecalho compacto: menu mais baixo que
 // antes (era 40px). Mantem um piso ainda tocavel, so nao trava mais em 40.
 const alturasMenu=[...css.matchAll(/min-height:(\d+)px/g)].map(m=>+m[1]);
 T('alvo de toque com altura minima ainda razoavel (>=32px)', alturasMenu.length>=2 && alturasMenu.every(v=>v>=32), alturasMenu.join(','));
 T('wrap com fundo proprio contra inversao',
   /\.wrap\{[^}]*background:var\(--paper\)/.test(html));
 T('wrap cobre a tela toda', /\.wrap\{[^}]*min-height:100vh/.test(html));
 T('secoes com fundo declarado',
   /header,main,footer,\.sec,\.detail\{background:var\(--paper\)\}/.test(html));
 T('html com fundo declarado', /html,body\{margin:0;padding:0;background:var\(--paper\)\}/.test(html));
})().catch(e=>{console.error('ERRO:',e.message);process.exit(1)});
