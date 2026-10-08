const db=require('../db'),{JSDOM}=require('jsdom'),fs=require('fs');
let ok=0,bad=0;const T=(n,c)=>{c?ok++:bad++;console.log((c?'  ok  ':'  FALHA ')+n)};
(async()=>{
 const original=db.pool.connect,calls=[];
 db.pool.connect=async()=>({query:async(sql,params=[])=>{calls.push({sql,params});if(sql.includes('max(versao)'))return {rows:[{v:2}]};if(sql.includes('INSERT INTO semanas'))return {rows:[{id:42,versao:2}]};return {rows:[],rowCount:0}},release(){}});
 const own={cliente:'Flora GO',sigla:'AAA',toneladas:120,net:4500.123456789,proprio:false,netTerMed:9999,cliente2:'JBS Industrial',net2:9999};
 const third={cliente:'Cliente A',sigla:'AAA',toneladas:30,net:5000,proprio:true};
 const third2={cliente:'Cliente B',sigla:'AAA',toneladas:90,net:5400,proprio:false};
 try{
  await db.fecharSemana({ano:2026,semana:10,linhasOtimo:[]},[own,third,third2],1,null);
  const inserts=calls.filter(c=>c.sql.includes('INSERT INTO alocacoes')),a=inserts[0].params;
  T('close corrects internal group classification',a[8]===true);
  T('close corrects independent classification',inserts[1].params[8]===false);
  T('close ignores received stale reference and computes weighted one',a[18]===5300);
  T('close forbids internal JBS versus Flora alternative',a[14]===null&&a[15]===null);
  T('close preserves calculated NET precision',a[13]===4500.123456789);
  T('close retains programmed volume',a[11]===120);
  T('close does not mutate caller records',own.proprio===false&&own.netTerMed===9999&&third.proprio===true);
  T('transaction locks version before inserting',calls.findIndex(c=>c.sql.includes('pg_advisory'))<calls.findIndex(c=>c.sql.includes('INSERT INTO semanas')));
  T('successful close commits',calls.some(c=>c.sql==='COMMIT'));
  const before=calls.length;
  let rejected=false;try{await db.fecharSemana({ano:2026,semana:10},[{...own,net:null}],1,null)}catch(e){rejected=/NET válido/.test(e.message)}
  T('missing NET is rejected before any database mutation',rejected&&calls.length===before);
  for(const [name,lock,uf] of [['inside','SP','MT'],['outside','!MT','MT'],['missingUF','SP',null]]){
    const before=calls.length;let rejected=false;
    try{await db.fecharSemana({ano:2026,semana:10,travas:{'Flora GO':lock}},[{...own,origemUf:uf}],1,null)}
    catch(e){rejected=/fora da trava configurada/.test(e.message)}
    T('close rejects '+name+' restriction violation before database mutation',rejected&&calls.length===before);
  }
 }finally{db.pool.connect=original}
 const originalQuery=db.pool.query;
 db.pool.query=async(sql)=>({rows:sql.includes('SELECT s.id, s.dados')?[{id:42,dados:JSON.stringify({prod:{},mapa:{}}),versao:2}]:[
  {cliente:'Flora GO',sigla:'AAA',toneladas:'120',net:'4500.12',cenario:'realizado'},
  {cliente:'Cliente A',sigla:'AAA',toneladas:'30',net:'5000',cenario:'realizado'},
  {cliente:'Cliente B',sigla:'AAA',toneladas:'90',net:'5400',cenario:'realizado'}]});
 try{
  const saved=await db.lerSemanaAtual(2026,10);
  T('reopening reads persisted historical NET without recalculating quotation',saved.linhas[0].net===4500.12);
  T('reopening derives reference from persisted scheduled loads',saved.linhas[0].netTerMed===5300);
 }finally{db.pool.query=originalQuery}
 const dom=new JSDOM(fs.readFileSync(__dirname+'/../public/index.html','utf8'),{runScripts:'dangerously',url:'https://audit.local/',beforeParse(w){w.fetch=async()=>({ok:false,status:404,json:async()=>({})});w.HTMLElement.prototype.scrollIntoView=function(){}}});
 const w=dom.window;
 await new Promise(r=>setTimeout(r,60));
 // A pristine closed snapshot must be distinguishable from new edits.
 w.ST={manual:{},nec:{},travas:{},ofEdits:{},modo:'mercado',fora:[],extras:[]};
 const signature=w.assinaturaProgramacao();
 w.ST.usuario='Outro operador';w.ST.salvoEm='agora';w.ST.verDest=true;
 T('operator and presentation changes do not invalidate historical economic base',w.assinaturaProgramacao()===signature);
 w.ST.manual.AAA=[{cli:'Flora GO',ton:100}];
 T('editing programmed destinations invalidates historical economic snapshot',w.assinaturaProgramacao()!==signature);
 dom.window.close();
 console.log('\n'+ok+' OK, '+bad+' falhas');process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
