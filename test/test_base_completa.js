const assert = require('assert'), fs = require('fs'), {JSDOM} = require('jsdom'), db = require('../db');
(async()=>{
  let calls=[], released=false, fail=false;
  db.pool.connect=async()=>({query:async sql=>{calls.push(sql);if(fail && sql==='DELETE FROM cotacoes')throw Error('falha');return {rowCount:2}},release(){released=true}});
  const r=await db.apagarBaseCompleta();
  assert.deepEqual(Object.keys(r),['alocacoes','semanas','cotacoes','rascunhos']);
  assert.equal(calls[0],'BEGIN'); assert.equal(calls.at(-1),'COMMIT'); assert(released);
  assert(!calls.some(x=>/DELETE FROM (usuarios|sessoes)/.test(x)));
  calls=[];fail=true;released=false;
  await assert.rejects(db.apagarBaseCompleta());assert.equal(calls.at(-1),'ROLLBACK');assert(!calls.includes('COMMIT'));assert(released);
  const server=fs.readFileSync(require.resolve('../server'),'utf8');
  const vm=require('vm'); let handlers,mutations=0;
  const ctx={app:{delete:(url,...h)=>{handlers=h}}, db:{apagarBaseCompleta:async()=>{mutations++;return {semanas:2}}},console};
  vm.createContext(ctx);
  vm.runInContext(server.slice(server.indexOf('function exigeLogin('),server.indexOf('// ---------- rotas abertas')),ctx);
  vm.runInContext(server.slice(server.indexOf("app.delete('/api/base-completa'"),server.indexOf("app.delete('/api/semanas'")),ctx);
  async function request(usuario,confirmacao='EXCLUIR BASE COMPLETA'){
    const req={usuario,body:{confirmacao},is:()=>true},res={code:200,status(n){this.code=n;return this},json(v){this.value=v;return this}};
    let next=false; handlers[0](req,res,()=>{next=true});
    if(next)await handlers[1](req,res);
    return res;
  }
  assert.equal((await request(null)).code,401);
  for(const papel of ['usuario','admin'])assert.equal((await request({papel})).code,403);
  assert.equal((await request({papel:'master',senhaTemporaria:true})).code,403);
  assert.equal((await request({papel:'master'},'')).code,400);assert.equal(mutations,0);
  assert.equal((await request({papel:'master'})).value.ok,true);assert.equal(mutations,1);
  for (const role of ['master','admin']) {
    let deletes=0, allow=false, navigated=false;
    const html=fs.readFileSync(require.resolve('../public/admin.html'),'utf8');
    const dom=new JSDOM(html,{url:'https://example.test/usuarios',runScripts:'dangerously',beforeParse(w){
      w.confirm=()=>allow; w.fetch=async(url,opt)=>{
        if(opt && opt.method==='DELETE'){deletes++;return {ok:true,status:200,json:async()=>({ok:true})}}
        return {ok:true,status:200,json:async()=>url==='/api/eu'?{usuario:{id:1,nome:'Teste',papel:role}}:{usuarios:[]}};
      };
    }});
    await new Promise(r=>setTimeout(r,20));
    const w=dom.window, b=w.document.getElementById('btnExcluirBase');
    assert.equal(w.document.getElementById('baseCompleta').hidden,role!=='master');
    await b.onclick();assert.equal(deletes,0);
    if(role==='master'){
      w.navTopo=()=>{navigated=true}; w.localStorage.setItem('sebo_dados','antigo');
      allow=true;await b.onclick();assert.equal(deletes,1);assert.equal(w.localStorage.getItem('sebo_dados'),null);assert(navigated);
    }
    dom.window.close();
  }
  console.log('  ok  limpeza atomica, rollback, preservacao de contas, master, cancelamento e estado local');
  await db.pool.end();
})().catch(e=>{console.error(e);process.exit(1)});
