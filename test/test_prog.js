// caminhos relativos a esta pasta, funciona em qualquer maquina
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs=require('fs');const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync(PAINEL,'utf8'),{runScripts:'dangerously',url:'https://x/'});
const w=dom.window;
w.DecompressionStream=DecompressionStream;w.CompressionStream=CompressionStream;
w.Response=Response;w.Blob=Blob;w.XMLSerializer=dom.window.XMLSerializer;
w.HTMLElement.prototype.scrollIntoView=function(){};w.Element.prototype.scrollIntoView=function(){};
w.btoa=s=>Buffer.from(s,'binary').toString('base64');
w.atob=s=>Buffer.from(s,'base64').toString('binary');
const fake=(n,p)=>{const b=fs.readFileSync(p);return{name:n,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
const T=(n,c,x)=>console.log((c?'  ok  ':'  FALHA ')+n+(x?' — '+x:''));
const E=s=>s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
(async()=>{
 await new Promise(r=>setTimeout(r,60));
 await w.receber('prog',fake('prog.xlsx','in/prog4.xlsx'));
 await w.receber('mapa',fake('mapa.xlsx','in/mapa2.xlsx'));
 await new Promise(r=>setTimeout(r,120));
 const d=w.document;
 const set=(c,v)=>{const i=d.querySelector('[data-nec="'+E(c)+'"]');i.value=v;i.dispatchEvent(new w.Event('input'))};
 set('JBS - BioPower Lins',1050);set('JBS - BioPower Campo Verde',1540);
 set('Flora SP',300);set('Flora GO',1000);
 w.rodar(); await new Promise(r=>setTimeout(r,80));
 T('botão de exportar habilitado', !d.querySelector('#bProg').disabled);
 const totalT = w.PROD.plants.reduce((s,p)=>s+p.ton,0);
 T('leu a programação', w.PROD.linhas.length===103 && totalT===4970,
   w.PROD.linhas.length+' linhas, '+w.PROD.plants.length+' unidades, '+totalT+' t');
 const r=await w.programacaoPreenchida(w.PROGBUF,w.PROD,w.RES.alocFinal,w.OPS,w.MAPA.data,w.MAPA.dataSerial);
 const buf=Buffer.from(await r.arquivo.arrayBuffer());
 console.log('\ntrânsito estimado:',r.transito.length,'cargas CIF | sem rota:',r.semRota);
 const dd=r.transito.map(x=>x.dias);
 if(dd.length) console.log('  dias:',Math.min(...dd),'a',Math.max(...dd));
 fs.writeFileSync('saida.xlsx',buf);
 T('gerou o arquivo', buf.length>10000, (buf.length/1024).toFixed(1)+' KB');

 // relê a planilha gerada com o próprio leitor do painel
 const sh=await w.readXlsx({arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)});
 const rows=sh['Programação'];
 const cab=rows[0].map(x=>String(x).replace(/\s+/g,' ').trim());
 console.log('\ncabeçalho:',cab.join(' | '));
 T('cabeçalho intacto', cab.filter(Boolean).length===18 &&
   cab[9]==='Clientes' && cab[17]==='Nome 2º melhor Cliente', cab.filter(Boolean).length+' colunas');
 const CD=w.PROD.colDest;
 const ix=L=>L.charCodeAt(0)-65;
 T('achou as colunas pelo nome', !!(CD.cli&&CD.dst&&CD.of&&CD.icms&&CD.modal&&CD.cts&&CD.tonProd&&CD.emb),
   JSON.stringify(CD));
 const dados=rows.slice(1).filter(r=>r[3]);
 T('nenhuma linha perdida', dados.length>=w.PROD.linhas.length, dados.length+' linhas');
 const colTon = CD.ton || CD.tonProd;
 const somaTon=dados.reduce((s,r)=>s+(+r[ix(colTon)]||0),0);
 T('soma dos volumes fecha com a produção', Math.abs(somaTon-totalT)<0.01, somaTon+' t');
 T('nenhuma linha sem cliente', dados.every(r=>r[ix(CD.cli)]));
 T('todas com destino e modal',
   dados.every(r=>r[ix(CD.dst)]&&r[ix(CD.modal)]));
 T('ICMS preenchido em todas', dados.every(r=>typeof r[ix(CD.icms)]==='number'));
 const porCli={};dados.forEach(r=>porCli[r[ix(CD.cli)]]=(porCli[r[ix(CD.cli)]]||0)+(+r[ix(colTon)]||0));
 console.log('\npor cliente na planilha:');
 Object.entries(porCli).sort((a,b)=>b[1]-a[1]).forEach(([c,v])=>console.log('   ',c.padEnd(42),v));
 T('bate com a alocação do painel',
   Object.keys(porCli).every(c=>Math.abs(porCli[c]-w.RES.alocFinal.filter(a=>a.cli===c)
     .reduce((s,a)=>s+a.ton,0))<0.01));
 // aba Resumo
 const shR=sh['Resumo'];
 T('aba Resumo criada', !!shR, shR? shR.length+' linhas':'não existe');
 T('a Programação não tem mais o bloco',
   !rows.some(r=>String(r[0]||'').indexOf('Acumulado')===0));
 const cabR=shR[0].slice(0,5).map(x=>String(x||''));
 T('cabeçalho do resumo',
   cabR.join('|')==='UF Fornecedora|Clientes|Cidade/UF|$ Oferta|Toneladas', cabR.join(' | '));
 const res=[]; let iTot=-1;
 for(let i=1;i<shR.length;i++){
   if(String(shR[i][1]||'')==='TOTAL'){iTot=i;break;}
   if(shR[i][1]) res.push(shR[i]);
 }
 const todas=shR;
 T('uma linha por UF fornecedora e cliente',
   res.length===new Set(res.map(r=>r[0]+'|'+r[1])).size, res.length+' linhas');
 const somaRes=res.reduce((s,r)=>s+(+r[4]||0),0);
 T('acumulado fecha com a produção', Math.abs(somaRes-totalT)<0.01, somaRes+' t');
 T('linha de TOTAL confere', iTot>0 && Math.abs((+todas[iTot][4]||0)-totalT)<0.01);
 const porCliRes={}; res.forEach(r=>porCliRes[r[1]]=(porCliRes[r[1]]||0)+(+r[4]||0));
 T('volume por cliente bate com a alocação',
   Object.keys(porCliRes).every(c=>Math.abs(porCliRes[c]-w.RES.alocFinal
     .filter(a=>a.cli===c).reduce((s,a)=>s+a.ton,0))<0.01),
   Object.keys(porCliRes).length+' clientes');
 console.log('\naba Resumo:');
 res.forEach(r=>console.log('   ',String(r[0]).padEnd(3),String(r[1]).slice(0,38).padEnd(40),
   String(r[2]).slice(0,22).padEnd(24),'R$',Math.round(r[3]),'|',r[4],'t'));
 console.log('    TOTAL',todas[iTot][4],'t');

 // aba de vendas
 const shV=sh['Vendas'];
 T('aba Vendas criada', !!shV, shV? shV.length+' linhas':'não existe');
 const cabV=['Data','Sigla','Unidades','UF','Cliente','Cidade','Volume','A Faturar','ICMS','PIS/COFiNS','Frete','Pagamento'];
 const cabs=shV.map((r,i)=>[r,i]).filter(([r])=>String(r[0]||'')==='Data');
 T('um bloco por cliente', cabs.length===Object.keys(porCliRes).length,
   cabs.length+' blocos para '+Object.keys(porCliRes).length+' clientes');
 T('cabeçalho igual ao modelo',
   cabs.every(([r])=>cabV.every((t,i)=>String(r[i]||'')===t)), cabs[0][0].join('|'));
 const linhasV=shV.filter(r=>String(r[1]||'').indexOf('JBS - ')===0);
 T('volume da aba fecha com a produção',
   Math.abs(linhasV.reduce((s,r)=>s+(+r[6]||0),0)-totalT)<0.01,
   linhasV.reduce((s,r)=>s+(+r[6]||0),0)+' t em '+linhasV.length+' linhas');
 T('toda linha com pagamento e frete', linhasV.every(r=>r[11]&&r[10]));
 T('PIS/COFINS visível', linhasV.every(r=>String(r[9]).indexOf('%')>0), String(linhasV[0][9]));
 T('data da cotação em todas', linhasV.every(r=>+r[0]>40000));
 const z=await w.unzip(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
 const st=await w.entryText(z,'xl/styles.xml');
 const nomes=[...z.keys()].filter(x=>/xl\/worksheets\/sheet\d+\.xml/.test(x));
 let xmlV=null;
 for(const nm of nomes){ const t2=await w.entryText(z,nm);
   if(t2.indexOf('PIS/COFiNS')>=0||/r="L1"/.test(t2)) xmlV=t2; }
 const mx=/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/.exec(st);
 const xfs=mx[1].match(/<xf [^>]*\/>|<xf [^>]*>[\s\S]*?<\/xf>/g);
 const cel=/<c r="H2" s="(\d+)"/.exec(xmlV);
 const nfId=cel? /numFmtId="(\d+)"/.exec(xfs[+cel[1]])[1] : null;
 const code=nfId? (new RegExp('<numFmt numFmtId="'+nfId+'" formatCode="([^"]*)"').exec(st)||[])[1] : null;
 T('A Faturar em R$ sem centavos', !!code && code.indexOf('R$')>=0 && code.indexOf('.00')<0, code||'(sem formato)');

 // formato padronizado na aba Programação
 let xmlP=null;
 for(const nm of nomes){ const t3=await w.entryText(z,nm);
   if(/<row r="1"/.test(t3) && /<row r="20\d"/.test(t3)) xmlP=t3; }
 const nfBloco=(/<numFmts[^>]*>[\s\S]*?<\/numFmts>/.exec(st)||[''])[0];
 const fmtDe = ref => {
   const c=new RegExp('<c r="'+ref+'"[^>]*?\\ss="(\\d+)"').exec(xmlP);
   if(!c) return '(sem estilo)';
   const id=/numFmtId="(\d+)"/.exec(xfs[+c[1]])[1];
   const f=new RegExp('<numFmt numFmtId="'+id+'" formatCode="([^"]*)"').exec(nfBloco);
   return f? f[1] : 'builtin '+id;
 };
 const cd=w.PROD.colDest;
 const fTon=fmtDe(cd.tonProd+'2');
 T('Toneladas sem vírgula sobrando', fTon==='#,##0.##', fTon);
 const fIc=fmtDe(cd.icms+'2');
 T('ICMS em porcentagem', fIc==='0%'||fIc==='builtin 9', fIc);
 const fOf=fmtDe(cd.of+'2');
 T('$ Oferta em R$ sem centavos', fOf.indexOf('R$')>=0 && fOf.indexOf('.00')<0, fOf);
 const fNt=cd.net? fmtDe(cd.net+'2') : null;
 T('NET em R$ sem centavos', !cd.net || (fNt.indexOf('R$')>=0 && fNt.indexOf('.00')<0), fNt);
 const fEmb=fmtDe(cd.emb+'2');
 T('Data Embarque em dd/mm/aaaa', fEmb==='dd/mm/yyyy', fEmb);
 const fCts=fmtDe(cd.cts+'2');
 T('Nº CTS inteiro', fCts==='#,##0', fCts);
 T('nenhum formato herdado com decimal solto',
   !/formatCode="[^"]*#,##0\."/.test(nfBloco), nfBloco.slice(0,0)||'ok');
 console.log('\naba Vendas (3 primeiros blocos):');
 shV.slice(0,9).forEach(r=>console.log('   ',r.map(x=>String(x==null?'':x).slice(0,22)).join(' | ')));

 // 2a melhor oferta
 const i2=ix(CD.net2), r2=ix(CD.cli2);
 T('achou as colunas da 2ª melhor oferta', !!(CD.net2&&CD.cli2), CD.net2+'/'+CD.cli2);
 T('NET do escolhido preenchido', dados.every(r=>+r[ix(CD.net)]>0));
 const com2=dados.filter(r=>r[r2]);
 T('2ª melhor preenchida', com2.length>=dados.length-2, com2.length+' de '+dados.length);
 T('2º cliente é sempre diferente do escolhido',
   com2.every(r=>r[r2]!==r[ix(CD.cli)]));
 T('2ª melhor tem nome e valor juntos',
   dados.every(r=>(!!r[r2])===(+r[i2]>0)));
 console.log('\namostra da 2ª melhor:');
 dados.slice(0,5).forEach(r=>console.log('   ',r[3],'->',r[ix(CD.cli)].slice(0,26).padEnd(26),
   'NET',Math.round(r[ix(CD.net)]),'| 2ª:',String(r[r2]).slice(0,26).padEnd(26),Math.round(r[i2])));
 const semOf=dados.filter(r=>!(+r[ix(CD.of)]>0));
 T('todas com preço de oferta', semOf.length===0, semOf.length+' sem oferta');
 T('faturamento bruto confere',
   Math.round(dados.reduce((s,r)=>s+(+r[ix(colTon)]||0)*(+r[ix(CD.of)]||0),0))>0,
   'R$ '+Math.round(dados.reduce((s,r)=>s+(+r[ix(colTon)]||0)*(+r[ix(CD.of)]||0),0)).toLocaleString('pt-BR'));
 // data de entrega
 const cif=dados.filter(r=>/cif/i.test(String(r[ix(CD.modal)]||'')));
 const fob=dados.filter(r=>/fob/i.test(String(r[ix(CD.modal)]||'')));
 T('achou a coluna Data Entrega', !!CD.entrega, CD.entrega||'não');
 T('toda carga CIF com data de entrega',
   cif.length>0 && cif.every(r=>+r[ix(CD.entrega)]>0), cif.length+' cargas CIF');
 T('FOB sem data de entrega', fob.every(r=>!r[ix(CD.entrega)]), fob.length+' cargas FOB');
 const ie=ix(CD.emb);
 T('entrega sempre depois do embarque',
   cif.every(r=>+r[ix(CD.entrega)] > +r[ie]));
 const ex=cif.slice(0,6).map(r=>r[3]+' -> '+r[ix(CD.dst)]+' : '+((+r[ix(CD.entrega)])-(+r[ie]))+'d');
 console.log('  exemplos:',ex.join(' | '));
})().catch(e=>{console.error('ERRO:',e.message,e.stack);process.exit(1)});
