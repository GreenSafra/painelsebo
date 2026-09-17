// Ferramenta de diagnostico da media de terceiros (nao e bateria de teste,
// nao entra em rodar.js): pra cada carga de fabrica propria que fica SEM
// media (netTerMed nulo), mostra a sigla de origem, o destino, quantas
// ofertas existiam no Mapa pra aquela sigla e quantas foram descartadas por
// cada motivo — fabrica propria, destino da propria carga, trava fiscal,
// unidade nao reconhecida no Mapa, oferta sem NET. Roda os dois cenarios
// (realizado e o que o modelo mandava) e fecha com o motivo predominante.
//
// Uso (a partir de test/):
//   node diagnostico_terceiros.js
//     -> usa as planilhas reais da semana 38 (test/in/Programacao10_09_teste.xlsx
//        + "test/in/Mapa de ofertas 10 09_Teste.xlsx"), com necessidade alta
//        (1820 t) em cada fabrica propria pra reproduzir volume real de disputa.
//   node diagnostico_terceiros.js caminho/prog.xlsx caminho/mapa.xlsx [necessidade]
//     -> planilhas e necessidade (por fabrica) a escolher.
process.chdir(__dirname);
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PAINEL = path.join(__dirname, '..', 'public', 'index.html');
const argProg = process.argv[2] || path.join('in', 'Programacao10_09_teste.xlsx');
const argMapa = process.argv[3] || path.join('in', 'Mapa de ofertas 10 09_Teste.xlsx');
const NECESSIDADE = process.argv[4] ? Number(process.argv[4]) : 1820;

function carregarPainel() {
  const dom = new JSDOM(fs.readFileSync(PAINEL, 'utf8'), { runScripts: 'dangerously', url: 'https://x/' });
  const w = dom.window;
  w.DecompressionStream = DecompressionStream; w.CompressionStream = CompressionStream;
  w.Response = Response; w.Blob = Blob; w.XMLSerializer = w.XMLSerializer;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.Element.prototype.scrollIntoView = function () {};
  w.btoa = s => Buffer.from(s, 'binary').toString('base64');
  w.atob = s => Buffer.from(s, 'base64').toString('binary');
  return w;
}

const fake = (n, p) => {
  const b = fs.readFileSync(p);
  return { name: n, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

// Pra uma sigla e o cliente da carga: todas as linhas do Mapa cujo texto de
// unidade resolve pra ela, com o motivo de cada uma ter ficado de fora do
// universo de comparacao (mesma ordem de filtros de montar()+comparacaoTerceiros()).
function diagnosticoSigla(w, resolve, sigla, clienteCarga) {
  const linhasMapa = w.MAPA.rows.filter(r => resolve(r.un).indexOf(sigla) >= 0);
  const motivos = { propria: 0, destinoDaCarga: 0, travaFiscal: 0, ofertaSemNet: 0, validas: 0 };
  const ufDe = {}; w.PROD.plants.forEach(p => ufDe[p.sigla] = p.uf);
  linhasMapa.forEach(r => {
    const of = r.of, n = w.netDe(r);
    if (!(of > 0) || !(n > 0)) { motivos.ofertaSemNet++; return; }
    if (w.ehPropriaFabrica(r.cli)) {
      motivos.propria++;
      const tv = w.ST.travas[r.cli];
      if (tv && ufDe[sigla] !== tv) motivos.travaFiscal++;
      return;
    }
    if (r.cli === clienteCarga) { motivos.destinoDaCarga++; return; }
    motivos.validas++;
  });
  return { totalNoMapa: linhasMapa.length, motivos };
}

async function diagnosticar() {
  const w = carregarPainel();
  await new Promise(r => setTimeout(r, 60));
  await w.receber('prog', fake('prog', argProg));
  await w.receber('mapa', fake('mapa', argMapa));
  await new Promise(r => setTimeout(r, 200));
  const erro = w.document.querySelector('#impErr').textContent;
  if (erro) { console.error('Falha ao importar as planilhas:', erro); process.exit(1); }

  console.log('Semana', w.PROD.semana, '(' + (w.PROD.periodo || '?') + ')',
    '—', w.PROD.plants.length, 'unidades,', w.MAPA.rows.length, 'linhas no Mapa.');
  console.log('Necessidade usada em cada fabrica propria: ' + NECESSIDADE + ' t\n');

  const d = w.document;
  const E = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  const set = (c, v) => { const i = d.querySelector('[data-nec="' + E(c) + '"]'); if (i) { i.value = v; i.dispatchEvent(new w.Event('input')); } };
  (w.NEC || []).forEach(n => set(n.cliente, NECESSIDADE));
  w.rodar();
  await new Promise(r => setTimeout(r, 200));

  const resolve = w.criarResolvedor(w.PROD.plants);
  const pac = w.montarSemana(w.PROD, w.RES.alocFinal, w.RES.otimoAloc, w.OPS, w.MAPA, w.DS);

  const motivosGlobais = { propria: 0, destinoDaCarga: 0, travaFiscal: 0, ofertaSemNet: 0, naoReconhecida: 0 };

  [['O QUE FOI FEITO', pac.linhas], ['O QUE O MODELO MANDAVA', pac.linhasOtimo]].forEach(([rotulo, lista]) => {
    const props = lista.filter(l => l.proprio);
    const semComp = props.filter(l => l.netTerMed == null);
    const tonTotal = props.reduce((s, l) => s + l.toneladas, 0);
    const tonSemComp = semComp.reduce((s, l) => s + l.toneladas, 0);
    console.log('=== ' + rotulo + ' ===');
    console.log('Volume próprio total: ' + Math.round(tonTotal) + ' t | sem média: ' +
      Math.round(tonSemComp) + ' t (' + (tonTotal ? Math.round(tonSemComp / tonTotal * 100) : 0) + '%)');

    if (!semComp.length) { console.log('Nenhuma carga sem média — cobertura completa.\n'); return; }

    const porSiglaCliente = new Map();
    semComp.forEach(l => {
      const k = l.cliente + '|' + l.sigla;
      const e = porSiglaCliente.get(k) || { cliente: l.cliente, sigla: l.sigla, destino: l.destino, ton: 0 };
      e.ton += l.toneladas;
      porSiglaCliente.set(k, e);
    });
    [...porSiglaCliente.values()].sort((a, b) => b.ton - a.ton).forEach(e => {
      const diag = diagnosticoSigla(w, resolve, e.sigla, e.cliente);
      console.log('  ' + e.cliente + ' | sigla ' + e.sigla + ' | destino ' + e.destino + ' | ' +
        Math.round(e.ton) + ' t');
      console.log('    ofertas no Mapa p/ esta sigla: ' + diag.totalNoMapa +
        ' | própria: ' + diag.motivos.propria + ' (trava fiscal: ' + diag.motivos.travaFiscal + ')' +
        ' | destino da própria carga: ' + diag.motivos.destinoDaCarga +
        ' | oferta sem NET: ' + diag.motivos.ofertaSemNet +
        ' | válidas (deveriam ter contado): ' + diag.motivos.validas);
      if (diag.totalNoMapa === 0) {
        console.log('    Sigla ' + e.sigla + ' sem nenhuma linha no Mapa — unidade não reconhecida.');
        motivosGlobais.naoReconhecida++;
      }
      motivosGlobais.propria += diag.motivos.propria;
      motivosGlobais.destinoDaCarga += diag.motivos.destinoDaCarga;
      motivosGlobais.travaFiscal += diag.motivos.travaFiscal;
      motivosGlobais.ofertaSemNet += diag.motivos.ofertaSemNet;
    });
    console.log('');
  });

  const maior = Object.keys(motivosGlobais).reduce((a, b) => motivosGlobais[a] >= motivosGlobais[b] ? a : b);
  console.log('Motivos agregados (contagem de ofertas descartadas, somando os dois cenários):',
    JSON.stringify(motivosGlobais));
  if (Object.values(motivosGlobais).some(v => v > 0)) {
    console.log('Motivo predominante:', maior);
  } else {
    console.log('Nenhuma oferta descartada em nenhum motivo — não há carga sem média pra explicar.');
  }
}

diagnosticar().catch(e => { console.error(e); process.exit(1); });
