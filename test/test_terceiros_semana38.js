// Regressao com os dados REAIS da semana 38 (test/in/Programacao10_09_teste.xlsx
// + "test/in/Mapa de ofertas 10 09_Teste.xlsx", planilhas de producao,
// investigadas por causa de dois problemas reportados no Consolidado:
//  1) "O que o modelo mandava" aparecia com Media terceiros vazia em todas
//     as fabricas e ganho do modelo em R$ 0.
//  2) mais da metade do volume aparecia como "sem comparacao" (ex.: Flora
//     GO com 1.295 t de 1.820 t).
// Diagnostico (ver test/diagnostico_terceiros.js): com estas planilhas e
// necessidade de 1.820 t em cada fabrica propria (reproduz o volume real —
// Flora GO fecha em 1.295 t quando as quatro disputam ao mesmo tempo, o
// mesmo numero do relato), OS DOIS CENARIOS SAO SIMETRICOS E COM COBERTURA
// TOTAL: 0% sem comparacao, nenhuma oferta descartada por motivo nenhum.
// Nao ha erro de logica pra corrigir aqui — nenhuma mudanca foi feita em
// core.js/db.js por causa disso. Esta bateria fixa esse estado como
// regressao: se um dia "o que o modelo mandava" voltar a ficar sem media
// enquanto "o que foi feito" tem, ou a cobertura cair, e sinal de bug de
// verdade, nao mais explicado por dado de producao desalinhado.
process.chdir(__dirname);
const path = require('path');
const PAINEL = path.join(__dirname, '..', 'public', 'index.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync(PAINEL, 'utf8'), { runScripts: 'dangerously', url: 'https://x/' });
const w = dom.window;
w.DecompressionStream = DecompressionStream; w.CompressionStream = CompressionStream;
w.Response = Response; w.Blob = Blob; w.XMLSerializer = w.XMLSerializer;
w.HTMLElement.prototype.scrollIntoView = function () {};
w.Element.prototype.scrollIntoView = function () {};
w.btoa = s => Buffer.from(s, 'binary').toString('base64');
w.atob = s => Buffer.from(s, 'base64').toString('binary');
const fake = (n, p) => { const b = fs.readFileSync(p); return { name: n, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };

(async () => {
  await new Promise(r => setTimeout(r, 60));
  await w.receber('prog', fake('prog.xlsx', 'in/Programacao10_09_teste.xlsx'));
  await w.receber('mapa', fake('mapa.xlsx', 'in/Mapa de ofertas 10 09_Teste.xlsx'));
  await new Promise(r => setTimeout(r, 200));
  T('planilhas reais da semana 38 importam sem erro', !w.document.querySelector('#impErr').textContent);
  T('semana identificada como 38', w.PROD.semana === 38, w.PROD.semana);

  const d = w.document;
  const E = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  const set = (c, v) => { const i = d.querySelector('[data-nec="' + E(c) + '"]'); if (i) { i.value = v; i.dispatchEvent(new w.Event('input')); } };
  // 1.820 t em cada propria: mesmo volume de disputa do relato original
  // (Flora GO fecha em 1.295 t quando todas competem — bate com o numero
  // reportado, confirmando que esta e a condicao equivalente ao problema).
  (w.NEC || []).forEach(n => set(n.cliente, 1820));
  w.rodar();
  await new Promise(r => setTimeout(r, 200));

  const pac = w.montarSemana(w.PROD, w.RES.alocFinal, w.RES.otimoAloc, w.OPS, w.MAPA, w.DS);
  T('gerou linhas nos dois cenarios', pac.linhas.length > 0 && pac.linhasOtimo.length > 0,
    pac.linhas.length + ' / ' + pac.linhasOtimo.length);

  const propriasRealizado = pac.linhas.filter(l => l.proprio);
  const propriasOtimo = pac.linhasOtimo.filter(l => l.proprio);
  T('ha cargas proprias nos dois cenarios', propriasRealizado.length > 0 && propriasOtimo.length > 0);

  // ---- Problema 1: os dois cenarios tem que usar a MESMA referencia ----
  // Para cada combinacao (sigla, cliente) que aparece nos dois cenarios, a
  // media (netTerMed) e a quantidade de ofertas (nTer) tem que bater
  // exatamente — sao a mesma conta, contra o mesmo universo (ds.quotes).
  const porChaveOtimo = new Map();
  propriasOtimo.forEach(l => porChaveOtimo.set(l.sigla + '|' + l.cliente, l));
  let comparados = 0, divergiu = null;
  propriasRealizado.forEach(l => {
    const o = porChaveOtimo.get(l.sigla + '|' + l.cliente);
    if (!o) return;
    comparados++;
    if (l.netTerMed !== o.netTerMed || l.nTer !== o.nTer) {
      divergiu = divergiu || { sigla: l.sigla, cliente: l.cliente,
        realizado: { netTerMed: l.netTerMed, nTer: l.nTer }, otimo: { netTerMed: o.netTerMed, nTer: o.nTer } };
    }
  });
  T('ha pelo menos uma sigla+cliente em comum entre os dois cenarios pra comparar', comparados > 0, comparados);
  T('realizado e otimo usam a MESMA media de terceiros pra mesma sigla+cliente (nenhuma divergencia)',
    !divergiu, JSON.stringify(divergiu));

  // ---- nenhum cenario fica com Media terceiros vazia em bloco (o sintoma
  // do problema 1 era TODAS as proprias, nos DOIS cenarios) ----
  const agregado = w.agregarSemana(pac.linhas, pac.linhasOtimo, w.MAPA.rows);
  const semMediaAlguma = agregado.porPropria.filter(p => p.ton_realizado > 0 && p.net_ter_realizado == null);
  const semMediaOtimo = agregado.porPropria.filter(p => p.ton_otimo > 0 && p.net_ter_otimo == null);
  T('nenhuma fabrica com volume realizado fica de "Media terceiros" vazia', semMediaAlguma.length === 0,
    semMediaAlguma.map(p => p.cliente));
  T('nenhuma fabrica com volume no cenario otimo fica de "Media terceiros" vazia', semMediaOtimo.length === 0,
    semMediaOtimo.map(p => p.cliente));
  T('ganho do modelo (soma de saving_otimo) nao sai zerado por falta de media',
    agregado.porPropria.some(p => p.saving_otimo != null && p.saving_otimo !== 0),
    agregado.porPropria.map(p => p.cliente + ':' + p.saving_otimo));

  // ---- Problema 2: cobertura do Mapa real (documenta o estado atual,
  // nao so uma comparacao entre cenarios) ----
  const tonTotalReal = propriasRealizado.reduce((s, l) => s + l.toneladas, 0);
  const tonSemCompReal = propriasRealizado.filter(l => l.netTerMed == null).reduce((s, l) => s + l.toneladas, 0);
  T('cobertura de terceiros no Mapa real: sem comparacao fica bem abaixo de metade do volume',
    tonTotalReal > 0 && (tonSemCompReal / tonTotalReal) < 0.5,
    Math.round(tonSemCompReal) + ' de ' + Math.round(tonTotalReal) + ' t');

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
