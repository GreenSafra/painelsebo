// caminhos relativos a esta pasta, funciona em qualquer maquina
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');

const fs=require('fs');
eval(fs.readFileSync(require('path').join(__dirname,'..','src','core.js'),'utf8'));
let ok=0,bad=0;
function t(n,c){ if(c){ok++;console.log('  OK  '+n);} else {bad++;console.log('  FALHA '+n);} }

// cenario: 2 unidades, 1 propria (BioPower) e 1 terceiro.
// A propria paga NET pior. Em prioridade ela recebe; no mercado, nao.
const ds={
  plants:[{sigla:'AAA',uf:'MT',cidade:'Cuiaba',ton:100}],
  proprios:new Map([['JBS - BioPower Campo Verde',{cliente:'JBS - BioPower Campo Verde',cidade:'Campo Verde',uf:'MT',ton:70}]]),
  quotes:[
    {sigla:'AAA',cli:'JBS - BioPower Campo Verde',uf:'MT',net:4000,prop:true},
    {sigla:'AAA',cli:'Cliente Terceiro X',uf:'MT',net:5000,prop:false}
  ]
};
const travas={};

const pri=resolver(ds,travas,null,'prioridade');
const propPri=pri.aloc.filter(a=>a.prop).reduce((s,a)=>s+a.ton,0);
const terPri =pri.aloc.filter(a=>!a.prop).reduce((s,a)=>s+a.ton,0);
t('prioridade: propria recebe as 70 t pedidas', Math.abs(propPri-70)<0.01);
t('prioridade: terceiro fica com as 30 t restantes', Math.abs(terPri-30)<0.01);

const mer=resolver(ds,travas,null,'mercado');
const propMer=mer.aloc.filter(a=>a.prop).reduce((s,a)=>s+a.ton,0);
const terMer =mer.aloc.filter(a=>!a.prop).reduce((s,a)=>s+a.ton,0);
t('mercado: propria com NET pior nao recebe nada', propMer<0.01);
t('mercado: terceiro leva tudo pelo melhor NET', Math.abs(terMer-100)<0.01);
t('mercado rende mais que prioridade', mer.net>pri.net);
t('mercado nao acusa falta', mer.faltas.length===0);
t('prioridade sem falta quando atende', pri.faltas.length===0);

// propria pagando melhor: deve vencer nos dois modos
const ds2=JSON.parse(JSON.stringify({plants:ds.plants,quotes:ds.quotes}));
ds2.proprios=new Map([['JBS - BioPower Campo Verde',{cliente:'JBS - BioPower Campo Verde',cidade:'Campo Verde',uf:'MT',ton:70}]]);
ds2.quotes[0].net=6000;
const mer2=resolver(ds2,travas,null,'mercado');
const p2=mer2.aloc.filter(a=>a.prop).reduce((s,a)=>s+a.ton,0);
t('mercado: propria com melhor NET leva tudo, sem teto de necessidade', Math.abs(p2-100)<0.01);

// trava fiscal continua valendo no mercado livre
const ds3={
  plants:[{sigla:'BBB',uf:'SP',cidade:'Lins',ton:100}],
  proprios:new Map([['JBS - BioPower Campo Verde',{cliente:'JBS - BioPower Campo Verde',cidade:'Campo Verde',uf:'MT',ton:0}]]),
  quotes:[
    {sigla:'BBB',cli:'JBS - BioPower Campo Verde',uf:'SP',net:9000,prop:true},
    {sigla:'BBB',cli:'Cliente Terceiro X',uf:'SP',net:5000,prop:false}
  ]
};
const mer3=resolver(ds3,{'JBS - BioPower Campo Verde':'MT'},null,'mercado');
const p3=mer3.aloc.filter(a=>a.prop).reduce((s,a)=>s+a.ton,0);
t('mercado: trava fiscal barra a propria mesmo com NET muito melhor', p3<0.01);

// no modo prioridade, volume 0 nao puxa nada
const ds4={
  plants:[{sigla:'CCC',uf:'MT',cidade:'X',ton:50}],
  proprios:new Map([['JBS - Flora',{cliente:'JBS - Flora',cidade:'Y',uf:'MT',ton:0}]]),
  quotes:[
    {sigla:'CCC',cli:'JBS - Flora',uf:'MT',net:8000,prop:true},
    {sigla:'CCC',cli:'Terceiro Z',uf:'MT',net:3000,prop:false}
  ]
};
const pri4=resolver(ds4,{},null,'prioridade');
t('prioridade: destino com 0 t nao recebe, mesmo com NET melhor',
  pri4.aloc.filter(a=>a.prop).reduce((s,a)=>s+a.ton,0)<0.01);
const mer4=resolver(ds4,{},null,'mercado');
t('mercado: o mesmo destino com 0 t agora leva tudo',
  Math.abs(mer4.aloc.filter(a=>a.prop).reduce((s,a)=>s+a.ton,0)-50)<0.01);

// sem modo informado = comportamento antigo
const leg=resolver(ds,travas,null);
t('sem modo informado, mantem o comportamento de prioridade',
  Math.abs(leg.aloc.filter(a=>a.prop).reduce((s,a)=>s+a.ton,0)-70)<0.01);

console.log('\n'+ok+' OK, '+bad+' falhas');
process.exit(bad?1:0);
