// Importar uma Programação já preenchida (destinos definidos na planilha)
// junto com o Mapa de ofertas: a distribuição vem da planilha, o Mapa só
// calcula NET/melhor terceiro/resultado. Cobre deteccão automática, a
// alocação batendo com a planilha, os avisos de "sem oferta no Mapa",
// "sem destino" e "soma diferente da produção", e o ciclo exportar ->
// reimportar. db.js/server.js (colunas novas, UNION) ficam por revisão de
// código, sem Postgres local, mesmo padrão das levas anteriores.
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync(PAINEL, 'utf8'), { runScripts: 'dangerously', url: 'https://x/' });
const w = dom.window;
w.DecompressionStream = DecompressionStream; w.CompressionStream = CompressionStream;
w.Response = Response; w.Blob = Blob; w.XMLSerializer = dom.window.XMLSerializer;
w.HTMLElement.prototype.scrollIntoView = function () {};
w.Element.prototype.scrollIntoView = function () {};
w.URL.createObjectURL = () => 'blob:x';
w.URL.revokeObjectURL = () => {};
w.btoa = s => Buffer.from(s, 'binary').toString('base64');
w.atob = s => Buffer.from(s, 'base64').toString('binary');
const fake = (n, p) => { const b = fs.readFileSync(p); return { name: n, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

async function importar(progArq, mapaArq) {
  w.PROD = null; w.MAPA = null; w.PROGBUF = null; w.ST = null;
  w.RES = null; w.DS = null; w.OPS = null; w.NEC = null; w.RAW = null;
  await w.receber('prog', fake('prog.xlsx', 'in/' + progArq));
  await w.receber('mapa', fake('mapa.xlsx', 'in/' + mapaArq));
  await new Promise(r => setTimeout(r, 150));
}

(async () => {
  await new Promise(r => setTimeout(r, 60));

  // ============ 1. Programação sem destinos: comportamento atual inalterado ============
  await importar('prog38.xlsx', 'mapa2.xlsx');
  T('Programação sem destino: destinosPreenchidos é null', w.PROD.destinosPreenchidos === null);
  const d = w.document;
  T('Programação sem destino: sem aviso de "Programação preenchida"',
    d.getElementById('avisos').innerHTML.indexOf('Programação preenchida') === -1);
  // com nenhuma necessidade digitada, RES.alocFinal vem do resolver "livre"
  // de fixos (nenhum manual) — so confere que continua sendo o modelo quem
  // decide, não uma cópia 1:1 de uma planilha inexistente.
  const alocSemDestino = w.RES.alocFinal.length;
  T('Programação sem destino: alocação existe e roda o modelo normalmente', alocSemDestino > 0);

  // ============ 2. Programação preenchida: detecção, aviso e distribuição batendo com a planilha ============
  await importar('prog38_preenchida.xlsx', 'mapa2.xlsx');
  T('detecta Programação preenchida', !!w.PROD.destinosPreenchidos);
  T('aviso "Programação preenchida" aparece na tela',
    d.getElementById('avisos').innerHTML.indexOf('Programação preenchida: a distribuição será a da planilha') >= 0);
  T('rodapé menciona Programação preenchida', d.getElementById('foot').textContent.indexOf('Programação preenchida') >= 0);

  // a distribuição da tela tem que bater com o que foi lido da planilha,
  // sigla a sigla e cliente a cliente — comparação independente de como
  // RES.alocFinal foi montado internamente.
  let bateComPlanilha = true, detalheBate = '';
  Object.keys(w.PROD.destinosPreenchidos).forEach(sg => {
    w.PROD.destinosPreenchidos[sg].forEach(dst => {
      const linha = w.RES.alocFinal.find(a => a.sigla === sg && a.cli === dst.cliente);
      if (!linha) { bateComPlanilha = false; detalheBate = 'faltou ' + sg + '->' + dst.cliente; return; }
      if (Math.abs(linha.ton - dst.ton) > 0.01) {
        bateComPlanilha = false;
        detalheBate = sg + '->' + dst.cliente + ': tela=' + linha.ton + ' planilha=' + dst.ton;
      }
    });
  });
  T('cada destino da planilha aparece na tela com a mesma tonelada', bateComPlanilha, detalheBate);

  const somaPlanilha = Object.values(w.PROD.destinosPreenchidos)
    .reduce((s, lista) => s + lista.reduce((s2, x) => s2 + x.ton, 0), 0);
  const somaTela = w.RES.alocFinal.reduce((s, a) => s + a.ton, 0);
  T('soma total da tela bate com a soma da planilha', Math.abs(somaPlanilha - somaTela) < 0.01,
    somaPlanilha + ' vs ' + somaTela);

  T('nenhum aviso de sobra/sem-oferta/diferença nesta planilha limpa',
    w.RES.sobra.length === 0 && w.RES.semOferta.length === 0 && w.RES.diferencas.length === 0);

  T('NET foi calculado a partir do Mapa (linhas com cotação têm net numérico)',
    w.RES.alocFinal.some(a => typeof a.net === 'number' && isFinite(a.net)));
  T('resultado final (netFinal) é um número calculado', typeof w.RES.netFinal === 'number' && isFinite(w.RES.netFinal));

  // "o que o modelo mandava" continua sendo calculado pelo modelo (mesma
  // Programação e Mapa), pra comparar com o que veio da planilha
  T('"o que o modelo mandava" (otimoAloc) também foi calculado', w.RES.otimoAloc.length > 0);
  T('otimoAloc não é uma cópia do que veio da planilha (é o modelo rodando de verdade)',
    JSON.stringify(w.RES.otimoAloc.map(a => a.ton).sort()) !== JSON.stringify(w.RES.alocFinal.map(a => a.ton).sort()) ||
    w.RES.otimoNet !== w.RES.netFinal, 'otimoNet=' + w.RES.otimoNet + ' netFinal=' + w.RES.netFinal);

  // ============ 3. Edição manual depois de importar continua funcionando ============
  const sigla0 = Object.keys(w.PROD.destinosPreenchidos)[0];
  const clienteOriginal = w.RES.alocFinal.find(a => a.sigla === sigla0).cli;
  const outraOpcao = (w.OPS[sigla0] || []).find(o => o.cli !== clienteOriginal);
  if (outraOpcao) {
    w.ST.manual[sigla0] = [{ cli: outraOpcao.cli, ton: w.PROD.plants.find(p => p.sigla === sigla0).ton }];
    w.recalcular();
    const agora = w.RES.alocFinal.filter(a => a.sigla === sigla0);
    T('edição manual depois de importar substitui a planilha para aquela unidade',
      agora.length === 1 && agora[0].cli === outraOpcao.cli, JSON.stringify(agora));
    delete w.ST.manual[sigla0];
    w.recalcular();
  } else {
    T('havia opção alternativa pra testar edição manual (achou pelo menos uma)', false, 'nenhuma opção alternativa encontrada para ' + sigla0);
  }

  // ============ 4. Exportar de novo e reimportar reproduz a mesma alocação ============
  const alocAntes = w.RES.alocFinal.map(a => ({ sigla: a.sigla, cli: a.cli, ton: Math.round(a.ton * 100) }))
    .sort((a, b) => a.sigla.localeCompare(b.sigla) || a.cli.localeCompare(b.cli));
  const exportado = await w.programacaoPreenchida(w.PROGBUF, w.PROD, w.RES.alocFinal, w.OPS, w.MAPA.data, w.MAPA.dataSerial);
  const bufExportado = await exportado.arquivo.arrayBuffer();

  await importar('prog38_preenchida.xlsx', 'mapa2.xlsx');  // zera estado global antes de reimportar
  const sheetsReimport = await w.readXlsx({ arrayBuffer: async () => bufExportado });
  const prodReimport = w.readProducao(sheetsReimport);
  w.PROD = prodReimport; w.iniciar(true);
  await new Promise(r => setTimeout(r, 60));

  T('reimportar o arquivo exportado também detecta Programação preenchida', !!w.PROD.destinosPreenchidos);
  const alocDepois = w.RES.alocFinal.map(a => ({ sigla: a.sigla, cli: a.cli, ton: Math.round(a.ton * 100) }))
    .sort((a, b) => a.sigla.localeCompare(b.sigla) || a.cli.localeCompare(b.cli));
  T('exportar e reimportar reproduz a mesma alocação',
    JSON.stringify(alocAntes) === JSON.stringify(alocDepois),
    alocAntes.length + ' vs ' + alocDepois.length + ' linhas');

  // ============ 5. alocarPreenchida(): casos sintéticos — sem oferta, sem destino, soma diferente ============
  const prodSint = {
    plants: [
      { sigla: 'AAA', cidade: 'Cidade A', uf: 'MT', ton: 100 },
      { sigla: 'BBB', cidade: 'Cidade B', uf: 'MT', ton: 50 },
      { sigla: 'CCC', cidade: 'Cidade C', uf: 'SP', ton: 70 }
    ],
    destinosPreenchidos: {
      AAA: [{ cliente: 'Cliente X', destino: 'Destino X, MT', ton: 100 }],
      BBB: [{ cliente: 'Fantasma Ltda', destino: 'Fantasma, MT', ton: 50 }],
      CCC: [{ cliente: 'Cliente Y', destino: 'Destino Y, SP', ton: 40 }]
    }
  };
  const mapaSint = { rows: [
    { i: 0, un: 'Cidade A', uf: 'MT', cli: 'Cliente X', dst: 'Destino X, MT',
      of: 5000, net: 4800, icms: 0, pis: 0.00925, fcli: 0, modal: 'CIF' },
    { i: 1, un: 'Cidade C', uf: 'SP', cli: 'Cliente Y', dst: 'Destino Y, SP',
      of: 4000, net: 3800, icms: 0, pis: 0.00925, fcli: 0, modal: 'CIF' }
  ] };
  const dsSint = w.montar(prodSint, [], mapaSint);
  const resSint = w.alocarPreenchida(prodSint, dsSint, {});

  T('sintético: as 3 linhas da planilha aparecem alocadas', resSint.aloc.length === 3,
    JSON.stringify(resSint.aloc.map(a => a.sigla + '->' + a.cli + '=' + a.ton)));
  const linhaComQuote = resSint.aloc.find(a => a.sigla === 'AAA');
  T('sintético: destino com oferta no Mapa tem NET calculado', linhaComQuote && linhaComQuote.net === 4800);
  const linhaSemQuote = resSint.aloc.find(a => a.sigla === 'BBB');
  T('sintético: destino sem oferta no Mapa continua alocado, sem NET',
    linhaSemQuote && linhaSemQuote.ton === 50 && linhaSemQuote.net === null);
  T('sintético: "sem oferta no Mapa" identifica a unidade/cliente certos',
    resSint.semOferta.length === 1 && resSint.semOferta[0].sigla === 'BBB' &&
    resSint.semOferta[0].cliente === 'Fantasma Ltda');
  T('sintético: unidade com soma de destino menor que a produção fica em "sobra"',
    resSint.sobra.indexOf('CCC') >= 0, JSON.stringify(resSint.sobra));
  T('sintético: unidade com soma batendo exatamente não fica em "sobra"',
    resSint.sobra.indexOf('AAA') < 0 && resSint.sobra.indexOf('BBB') < 0);
  T('sintético: diferença entre soma dos destinos e produção é reportada',
    resSint.diferencas.length === 1 && resSint.diferencas[0].sigla === 'CCC' &&
    Math.abs(resSint.diferencas[0].diferenca - (-30)) < 0.01,
    JSON.stringify(resSint.diferencas));

  // unidade sem NENHUM destino na planilha (nem no objeto destinosPreenchidos)
  // também tem que aparecer inteira em "sobra", pra tela listar "sem destino"
  const prodSemDestinoNenhum = {
    plants: [{ sigla: 'DDD', cidade: 'Cidade D', uf: 'GO', ton: 40 }],
    destinosPreenchidos: {}
  };
  const dsSemDestino = w.montar(prodSemDestinoNenhum, [], { rows: [] });
  const resSemDestino = w.alocarPreenchida(prodSemDestinoNenhum, dsSemDestino, {});
  T('sintético: unidade sem nenhum destino na planilha fica inteira em "sobra"',
    resSemDestino.sobra.indexOf('DDD') >= 0 && resSemDestino.aloc.length === 0);

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
