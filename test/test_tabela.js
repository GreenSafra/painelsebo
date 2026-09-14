// Integridade da Tabela do Excel (xl/tables/*.xml) na programacao exportada.
// Bug de origem: a linha de totais usa SUBTOTAL(109,Tabela1[Toneladas]) e mora
// na coluna de Toneladas. A regra que troca a formula por CTS*35 destruia esse
// SUBTOTAL, e o Excel abria pedindo reparo porque a tabela declara
// totalsRowCount="1" mas a ultima linha ja nao era de totais.
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

// leitor de zip simples, so o suficiente para ler as partes em texto
async function partes(buf) {
  const b = new Uint8Array(buf); const out = {};
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('nao achei o fim do zip');
  let p = dv.getUint32(eocd + 16, true);
  const n = dv.getUint16(eocd + 10, true);
  for (let k = 0; k < n; k++) {
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const metodo = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true);
    const nome = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
    const lo = dv.getUint32(p + 42, true);
    const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true);
    const ini = lo + 30 + lnl + lel;
    const cru = b.subarray(ini, ini + tam);
    let txt;
    if (metodo === 0) txt = new TextDecoder().decode(cru);
    else {
      const ds = new DecompressionStream('deflate-raw');
      const r = new Response(new Blob([cru]).stream().pipeThrough(ds));
      txt = await r.text();
    }
    out[nome] = txt;
    p += 46 + nl + el + cl;
  }
  return out;
}

(async () => {
  await new Promise(r => setTimeout(r, 60));
  await w.receber('prog', fake('prog.xlsx', 'in/prog38.xlsx'));
  await w.receber('mapa', fake('mapa.xlsx', 'in/mapa2.xlsx'));
  await new Promise(r => setTimeout(r, 150));
  const d = w.document;
  const E = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  const set = (c, v) => { const i = d.querySelector('[data-nec="' + E(c) + '"]'); if (i) { i.value = v; i.dispatchEvent(new w.Event('input')); } };
  // volumes altos forcam divisoes e portanto linhas novas — e so ai a tabela e mexida
  set('JBS - BioPower Lins', 900); set('JBS - BioPower Campo Verde', 900);
  set('Flora SP', 900); set('Flora GO', 900);
  w.rodar(); await new Promise(r => setTimeout(r, 120));

  const r = await w.programacaoPreenchida(w.PROGBUF, w.PROD, w.RES.alocFinal, w.OPS, w.MAPA.data, w.MAPA.dataSerial);
  const buf = Buffer.from(await r.arquivo.arrayBuffer());
  const P = await partes(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const O = await partes(fs.readFileSync('in/prog38.xlsx').buffer);

  const nomeTab = Object.keys(P).find(n => /^xl\/tables\/.+\.xml$/.test(n));
  T('a exportacao manteve a parte de Tabela', !!nomeTab, nomeTab || 'sumiu');
  const tab = P[nomeTab], tabO = O[nomeTab];
  const aba = Object.keys(P).find(n => /^xl\/worksheets\/sheet1\.xml$/.test(n));
  const sh = P[aba];

  const linhas = [...sh.matchAll(/<row[^>]*\sr="(\d+)"/g)].map(m => +m[1]);
  const ultimaLinha = linhas[linhas.length - 1];
  const nOrig = [...O[aba].matchAll(/<row[^>]*\sr="(\d+)"/g)].length;
  T('a exportacao acrescentou linhas (senao o teste nao prova nada)',
    linhas.length > nOrig, nOrig + ' -> ' + linhas.length + ' linhas');

  const ref = /<table[^>]*\sref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/.exec(tab);
  const af = /autoFilter ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/.exec(tab);
  T('a tabela tem intervalo valido', !!ref, ref ? ref[0] : 'ausente');
  const ultTab = +ref[4];
  T('o intervalo da tabela cabe dentro da planilha', ultTab <= ultimaLinha,
    'tabela ate ' + ultTab + ', planilha ate ' + ultimaLinha);

  const nCols = [...tab.matchAll(/<tableColumn /g)].length;
  const declar = +/tableColumns count="(\d+)"/.exec(tab)[1];
  const larg = (c => { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; });
  T('numero de colunas bate com o intervalo',
    nCols === declar && nCols === larg(ref[3]) - larg(ref[1]) + 1,
    nCols + ' colunas, intervalo ' + ref[1] + '..' + ref[3]);

  // o coracao do bug
  const tot = /totalsRowCount="(\d+)"/.exec(tab);
  T('a fixture tem linha de totais declarada', !!tot && +tot[1] === 1,
    tot ? tot[1] : 'sem totalsRowCount');
  const subs = [...sh.matchAll(/<c r="([A-Z]+)(\d+)"[^>]*>\s*<f[^>]*>((?:SUBTOTAL|AGGREGATE)[^<]*)<\/f>/g)];
  T('a formula de totais sobreviveu a exportacao', subs.length === 1,
    subs.length + ' encontrada(s)');
  T('a linha de totais ficou na ultima linha da tabela',
    subs.length === 1 && +subs[0][2] === ultTab,
    subs.length ? 'SUBTOTAL na linha ' + subs[0][2] + ', tabela termina em ' + ultTab : 'nenhuma');
  T('a formula de totais nao virou CTS*35',
    subs.length === 1 && /Tabela1\[/.test(subs[0][3]), subs.length ? subs[0][3] : '-');
  T('nenhuma linha da planilha virou CTS*35 no lugar do total',
    !/<f[^>]*>[A-Z]{1,3}(\d+)\*35<\/f>/.test(sh.slice(sh.indexOf('r="' + ultTab + '"'))) ||
    subs.length === 1);

  // autofilter acompanha o intervalo, uma linha acima quando ha totais
  T('autoFilter termina uma linha antes da de totais',
    !!af && +af[4] === ultTab - 1, af ? af[2] + '..' + af[4] : 'ausente');

  // o intervalo cresceu junto com as linhas
  const refO = /<table[^>]*\sref="[A-Z]+\d+:[A-Z]+(\d+)"/.exec(tabO);
  T('o intervalo da tabela cresceu igual ao numero de linhas novas',
    ultTab - +refO[1] === linhas.length - nOrig,
    'tabela +' + (ultTab - +refO[1]) + ', planilha +' + (linhas.length - nOrig));

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
