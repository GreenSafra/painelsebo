// Pacote que montarSemana() produz para o banco quando a semana e fechada.
// Sem banco: valida so a forma do pacote (cabecalho + linhas ao nivel de
// embarque), que e o que a rota /api/semanas espera receber.
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync(PAINEL, 'utf8'), { runScripts: 'dangerously', url: 'https://x/' });
const w = dom.window;
w.DecompressionStream = DecompressionStream; w.CompressionStream = CompressionStream;
w.Response = Response; w.Blob = Blob; w.XMLSerializer = dom.window.XMLSerializer;
w.HTMLElement.prototype.scrollIntoView = function () {};
w.Element.prototype.scrollIntoView = function () {};
w.btoa = s => Buffer.from(s, 'binary').toString('base64');
w.atob = s => Buffer.from(s, 'base64').toString('binary');
const fake = (n, p) => { const b = fs.readFileSync(p); return { name: n, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

(async () => {
  await new Promise(r => setTimeout(r, 60));
  await w.receber('prog', fake('prog.xlsx', 'in/prog38.xlsx'));
  await w.receber('mapa', fake('mapa.xlsx', 'in/mapa2.xlsx'));
  await new Promise(r => setTimeout(r, 150));
  const d = w.document;
  const E = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  const set = (c, v) => { const i = d.querySelector('[data-nec="' + E(c) + '"]'); if (i) { i.value = v; i.dispatchEvent(new w.Event('input')); } };
  set('JBS - BioPower Lins', 900); set('JBS - BioPower Campo Verde', 900);
  set('Flora SP', 900); set('Flora GO', 900);
  w.rodar(); await new Promise(r => setTimeout(r, 120));

  const pac = w.montarSemana(w.PROD, w.RES.alocFinal, w.RES.otimoAloc, w.OPS, w.MAPA, w.DS);

  T('cabecalho.semana e 38', pac.cabecalho.semana === 38, 'veio ' + pac.cabecalho.semana);
  T('cabecalho.ano e um inteiro entre 2020 e 2100',
    Number.isInteger(pac.cabecalho.ano) && pac.cabecalho.ano >= 2020 && pac.cabecalho.ano <= 2100,
    'veio ' + pac.cabecalho.ano);
  T('o pacote tem linhas', pac.linhas.length > 0, 'linhas: ' + pac.linhas.length);
  T('toda linha tem toneladas > 0', pac.linhas.every(l => l.toneladas > 0));
  T('toda linha tem cliente preenchido', pac.linhas.every(l => !!l.cliente));
  T('toda linha tem dataEmbarque no formato AAAA-MM-DD',
    pac.linhas.every(l => /^\d{4}-\d{2}-\d{2}$/.test(l.dataEmbarque || '')));

  const somaPac = pac.linhas.reduce((s, l) => s + l.toneladas, 0);
  const somaAloc = w.RES.alocFinal.reduce((s, a) => s + a.ton, 0);
  T('a soma das toneladas do pacote bate com RES.alocFinal',
    Math.abs(somaPac - somaAloc) <= 0.05, somaPac + ' vs ' + somaAloc);

  T('existe ao menos uma linha com proprio === true', pac.linhas.some(l => l.proprio === true));
  T('nenhuma linha tem proprio undefined',
    pac.linhas.every(l => l.proprio === true || l.proprio === false));

  const meses = new Set(pac.linhas.map(l => (l.dataEmbarque || '').slice(0, 7)));
  T('as datas de embarque caem em no maximo dois meses distintos',
    meses.size <= 2, [...meses].join(','));

  T('linhasOtimo e um array com pelo menos uma linha',
    Array.isArray(pac.linhasOtimo) && pac.linhasOtimo.length > 0,
    'linhasOtimo: ' + (pac.linhasOtimo || []).length);
  T('nenhuma linha tem clienteTer batendo em uma planta propria',
    pac.linhas.every(l => !l.clienteTer || !/biopower|flora/i.test(l.clienteTer)));
  const somaOtimo = pac.linhasOtimo.reduce((s, l) => s + l.toneladas, 0);
  T('a soma das toneladas de linhasOtimo bate com a soma de linhas',
    Math.abs(somaOtimo - somaPac) <= 0.05, somaOtimo + ' vs ' + somaPac);

  // --- net_ter_med/nTer: toda linha comparavel (netTer != null) tambem tem
  // netTerMed/nTer, e a media cai entre o menor e o maior NET considerados.
  const comparaveis = pac.linhas.filter(l => l.proprio && l.netTer != null);
  T('ha pelo menos uma linha propria comparavel (com terceiro na mesma sigla)',
    comparaveis.length > 0, comparaveis.length);
  T('toda linha com netTer tambem tem netTerMed e nTer > 0',
    comparaveis.every(l => l.netTerMed != null && l.nTer > 0),
    comparaveis.filter(l => l.netTerMed == null).length + ' sem netTerMed');
  T('netTerMed cai entre netTerMin e netTerMax (ou os tres iguais, com 1 oferta so)',
    comparaveis.every(l => l.netTerMed >= l.netTerMin - 0.01 && l.netTerMed <= l.netTerMax + 0.01),
    comparaveis.filter(l => l.netTerMed < l.netTerMin - 0.01 || l.netTerMed > l.netTerMax + 0.01).length);
  T('com nTer === 1, a media bate exatamente com o melhor (netTer)',
    comparaveis.filter(l => l.nTer === 1).every(l => Math.abs(l.netTerMed - l.netTer) < 0.01));
  T('toda linha sem netTer (nenhum terceiro na sigla) tambem tem netTerMed nulo',
    pac.linhas.filter(l => l.proprio && l.netTer == null).every(l => l.netTerMed == null && l.nTer === 0));

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
