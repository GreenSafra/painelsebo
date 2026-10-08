const assert=require('assert');
const fs=require('fs');
const {JSDOM}=require('../test/node_modules/jsdom');
const db=require('../db');
(async()=>{
  const query=db.pool.query;
  const sql=[];
  db.pool.query=async q=>{sql.push(q);return {rows:[]};};
  try {
    await db.historicoEconomico();
    assert(sql[0].includes("cenario='realizado' AND NOT proprio"),'terceiros programados');
    assert(sql[0].includes('sum(net * toneladas)'),'ponderacao por volume');
    assert(sql[0].includes('t.sigla=a.sigla'),'origem equivalente');
    assert(sql[0].includes("a.cenario='realizado' AND a.proprio"),'somente plantas');
    assert(sql[0].includes("to_char(data_embarque,'YYYY-MM')"),'mes por embarque');
  }finally{db.pool.query=query;}
  const fonteDb=fs.readFileSync(__dirname+'/../db.js','utf8');
  assert(fonteDb.includes('WITH terceiros_programados AS ('),'consolidado consulta destinos programados');
  assert(fonteDb.includes('sum(tp.net_ref * a.toneladas)'),'consolidado pondera referencia por carga');
  const html=fs.readFileSync(__dirname+'/../public/consolidado.html','utf8');
  const dados=[{tipo:'mes',periodo:'2026-08',cliente:'Flora SP',desvio:'12000',volume:'100'},
    {tipo:'mes',periodo:'2026-09',cliente:'Flora SP',desvio:'-4000',volume:'80'},
    {tipo:'semana',periodo:'2026-W36',cliente:'Flora SP',desvio:'500',volume:'20'}];
  const dom=new JSDOM(html,{url:'https://example.com/consolidado',runScripts:'dangerously',beforeParse(w){
    w.fetch=async url=>({ok:true,status:200,json:async()=>url.includes('historico')?dados:url.includes('/api/meses')?[{mes:'2026-09'}]:{porPropria:[],porPlanta:[],semanasFechadas:[],total:{},modo:'mes',mes:'2026-09'}});
    w.HTMLElement.prototype.scrollIntoView=function(){};
    w.ResizeObserver=class{observe(){}};
  }});
  await new Promise(r=>setTimeout(r,100));
  await dom.window.abrirHistorico('Flora SP');
  const doc=dom.window.document;
  assert(!doc.querySelector('#painelHistorico').classList.contains('hide'));
  assert(doc.querySelectorAll('#histGrafico svg rect').length===2,'dois meses');
  assert(doc.querySelector('#histGrafico').textContent.includes('8.000'),'acumulado 12k-4k');
  doc.querySelector('#histModo').value='semana';
  doc.querySelector('#histModo').onchange();
  assert(doc.querySelectorAll('#histGrafico svg rect').length===1,'uma semana');
  assert(doc.querySelector('.metodologia'),'metodologia');
  dom.window.close();
  console.log('OK: referencia ponderada, mesma origem, historico mensal/semanal, acumulado e metodologia');
})().catch(e=>{console.error(e);process.exitCode=1});
