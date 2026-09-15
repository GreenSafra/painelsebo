// Cotacoes do Mapa: extracao (sem NET, sigla so quando resolve sozinha),
// e a regra de semana (casa com fechada, senao calcula pela ISO, senao
// pendente). Tudo puro em core.js — sem rede, sem banco. A gravacao em
// si (UNIQUE+ON CONFLICT, fecharSemana chamando gravarCotacoes, as
// rotas novas) fica por revisao de codigo, sem Postgres local, mesmo
// padrao das levas anteriores.
process.chdir(__dirname);
const path = require('path');
const PAINEL = path.join(__dirname, '..', 'public', 'index.html');
const fs = require('fs');
const { JSDOM } = require('jsdom');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

const html = fs.readFileSync(PAINEL, 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x/' });
const w = dom.window;
w.DecompressionStream = DecompressionStream;
w.CompressionStream = CompressionStream;
w.Response = Response;
w.Blob = Blob;
w.URL.createObjectURL = () => 'blob:x';
w.URL.revokeObjectURL = () => {};

function fake(name, p) {
  const b = fs.readFileSync(p);
  return { name, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
}

(async () => {
  await new Promise(r => setTimeout(r, 60));

  // ---- extracao pura: so mapa, sem programacao ----
  await w.receber('mapa', fake('mapa2.xlsx', 'in/mapa2.xlsx'));
  await new Promise(r => setTimeout(r, 60));
  const MAPA2 = w.MAPA;
  T('mapa2.xlsx leu linhas', MAPA2.rows.length > 0, MAPA2.rows.length + '');

  const cot = w.extrairCotacoes(MAPA2);
  T('extrai uma cotacao por linha com oferta', cot.length === MAPA2.rows.filter(r => r.of > 0).length);
  const primeira = MAPA2.rows.find(r => r.of > 0);
  const achada = cot.find(c => c.cliente === primeira.cli && c.origem === primeira.un);
  T('cliente/origem/oferta batem com a linha do Mapa', !!achada && achada.oferta === primeira.of);
  T('sem NET na cotacao extraida', achada && !('net' in achada));
  T('sem programacao, sigla sai nula', cot.every(c => c.sigla === null));
  const dataEsperada = w.serialToDate(MAPA2.dataSerial).toISOString().slice(0, 10);
  T('data da cotacao vem do dataSerial (sem bug de fuso)',
    cot.every(c => c.dataCotacao === dataEsperada));

  // reimportar o mesmo Mapa (chamar extrairCotacoes de novo) e deterministico
  // — mesma lista, mesma ordem. E o que faz o UNIQUE+ON CONFLICT do banco
  // (por cliente+origem+ano+semana) substituir em vez de duplicar, em vez
  // de depender da extracao "adivinhar" quem e repetido.
  const cot2 = w.extrairCotacoes(MAPA2);
  T('reimportar o mesmo Mapa extrai exatamente a mesma lista',
    JSON.stringify(cot) === JSON.stringify(cot2));

  // ---- sigla resolvida quando ha programacao (mesmo par usado em test_ui.js) ----
  await w.receber('prog', fake('prog3.xlsx', 'in/prog3.xlsx'));
  await w.receber('mapa', fake('mapa.xlsx', 'in/mapa.xlsx'));
  await new Promise(r => setTimeout(r, 60));
  const cotComSigla = w.extrairCotacoes(w.MAPA, w.PROD);
  T('com programacao, pelo menos uma sigla resolve', cotComSigla.some(c => c.sigla != null));
  T('sem passar prod, mesma extracao sai toda com sigla nula',
    w.extrairCotacoes(w.MAPA).every(c => c.sigla === null));

  // ---- regra de semana: casa com semana ja fechada ----
  const semanasFake = [{ ano: 2026, semana: 38, periodo: '14/09 a 20/09' }];
  // serial de 10/09/2026 (quinta esperada da semana 38) — mesma conta de 25569 usada em serialToDate
  const serialQuinta38 = Math.round(Date.UTC(2026, 8, 10) / 86400000) + 25569;
  const rCasada = w.resolverSemanaDoMapa(serialQuinta38, semanasFake);
  T('casa com a semana fechada certa', rCasada.status === 'casada' && rCasada.ano === 2026 && rCasada.semana === 38,
    JSON.stringify(rCasada));

  // ---- nao casa com nenhuma fechada, mas calcula pela ISO ----
  const rCalc = w.resolverSemanaDoMapa(MAPA2.dataSerial, semanasFake);
  T('nao bate com a semana fake e calcula (nao fica pendente)',
    rCalc.status === 'calculada' && rCalc.ano != null && rCalc.semana != null, JSON.stringify(rCalc));

  // conferencia contra as 9 semanas fechadas reais (producao, ver plano):
  // pra cada uma, a quinta esperada tem que casar exatamente com aquela semana.
  const serial = ymd => Math.round(Date.UTC(ymd[0], ymd[1] - 1, ymd[2]) / 86400000) + 25569;
  const reais = [
    { semana: 38, periodo: '14/09 a 20/09', quinta: [2026, 9, 10] },
    { semana: 37, periodo: '07/09 a 13/09', quinta: [2026, 9, 3] },
    { semana: 36, periodo: '31/08 a 06/09', quinta: [2026, 8, 27] },
    { semana: 34, periodo: '17/08 a 23/08', quinta: [2026, 8, 13] },
    { semana: 33, periodo: '10/08 a 16/08', quinta: [2026, 8, 6] },
    { semana: 31, periodo: '27/07 a 02/08', quinta: [2026, 7, 23] },
    { semana: 30, periodo: '20/07 a 26/07', quinta: [2026, 7, 16] },
    { semana: 29, periodo: '13/07 a 19/07', quinta: [2026, 7, 9] },
    { semana: 28, periodo: '06/07 a 12/07', quinta: [2026, 7, 2] }
  ];
  const todasSemanas = reais.map(x => ({ ano: 2026, semana: x.semana, periodo: x.periodo }));
  const todasBatem = reais.every(x => {
    const r = w.resolverSemanaDoMapa(serial(x.quinta), todasSemanas);
    return r.status === 'casada' && r.ano === 2026 && r.semana === x.semana;
  });
  T('as 9 semanas fechadas reais (28 a 38, sem 32/35) casam certo', todasBatem);

  // ---- data ilegivel vira pendente de verdade ----
  const rPendente = w.resolverSemanaDoMapa(null, semanasFake);
  T('dataSerial nulo vira pendente', rPendente.status === 'pendente');
  const rPendente2 = w.resolverSemanaDoMapa(999999, semanasFake); // fora do range de serialToDate
  T('dataSerial fora do range vira pendente', rPendente2.status === 'pendente');

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
