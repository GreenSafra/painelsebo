// Travas fiscais "Dentro de UF" e "Fora de UF" nos destinos da semana —
// antes so existia "so recebe de UF" (renomeado pra "Dentro de UF"); agora
// tem a oposta, "Fora de UF" (so recebe de origem de UF DIFERENTE da dela),
// exclusiva com a primeira. Cobre: cada trava filtrando as cargas certas
// (Dentro e Fora), exclusividade entre as duas (marcar uma desmarca a
// outra, nos dois sentidos), nenhuma marcada = sem restricao, os dois modos
// de distribuicao, o resumo contando as duas, rotulos "Dentro de X"/"Fora
// de X" alinhados nas linhas, e a gravacao ao fechar a semana.
//
// Atencao: renderNecessidade() reconstroi #necRows (innerHTML) a cada
// rodar()/recalcular() — os elementos de linha/checkbox de antes ficam
// orfaos. Por isso as funcoes abaixo RE-CONSULTAM o DOM toda vez, nunca
// guardam uma referencia de elemento pra usar depois de um rodar().
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync(PAINEL, 'utf8'), { runScripts: 'dangerously', url: 'https://x/' });
const w = dom.window;
w.DecompressionStream = DecompressionStream; w.CompressionStream = CompressionStream;
w.Response = Response; w.Blob = Blob; w.XMLSerializer = dom.window.XMLSerializer;
w.HTMLElement.prototype.scrollIntoView = function () {}; w.Element.prototype.scrollIntoView = function () {};
w.btoa = s => Buffer.from(s, 'binary').toString('base64');
w.atob = s => Buffer.from(s, 'base64').toString('binary');
const fake = (n, p) => { const b = fs.readFileSync(p); return { name: n, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };
const E = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
const d = () => w.document;
const linhaDe = cli => [...d().querySelectorAll('.nrow')].find(r => r.querySelector('.nm') && r.querySelector('.nm').textContent.trim() === cli);
const cbDentro = cli => { const r = linhaDe(cli); return r && r.querySelector('[data-tv]'); };
const cbFora = cli => { const r = linhaDe(cli); return r && r.querySelector('[data-tv-fora]'); };
async function marcar(cb) { cb.checked = true; cb.dispatchEvent(new w.Event('change')); await new Promise(r => setTimeout(r, 20)); }
async function desmarcar(cb) { cb.checked = false; cb.dispatchEvent(new w.Event('change')); await new Promise(r => setTimeout(r, 20)); }
async function rodarEsperando() { w.rodar(); await new Promise(r => setTimeout(r, 60)); }

(async () => {
  await new Promise(r => setTimeout(r, 60));
  await w.receber('prog', fake('a', 'in/prog3.xlsx'));
  await w.receber('mapa', fake('c', 'in/mapa.xlsx'));
  await new Promise(r => setTimeout(r, 120));
  const set = (c, v) => { const i = d().querySelector('[data-nec="' + E(c) + '"]'); i.value = v; i.dispatchEvent(new w.Event('input')); };
  const CV = 'JBS - BioPower Campo Verde';
  set('JBS - BioPower Lins', 1050); set(CV, 1540);
  set('Flora SP', 300); set('Flora GO', 1000);
  await rodarEsperando();

  // ---------- item 1: rotulo "Dentro de UF", mesmo comportamento de sempre ----------
  T('rotulo da trava atual e "Dentro de MT" (nao mais "so recebe de MT")',
    cbDentro(CV).closest('label').textContent.trim() === 'Dentro de MT', cbDentro(CV).closest('label').textContent);
  T('checkbox "Dentro de UF" comeca marcado (BioPower com UF de producao, default de sempre)',
    cbDentro(CV).checked);
  T('checkbox "Fora de UF" comeca desmarcado', !cbFora(CV).checked);

  // ---------- item 8: as duas ficam alinhadas (mesmo container em todas as linhas) ----------
  const linhasComTrava = [...d().querySelectorAll('.nrow')].filter(r => r.querySelector('[data-tv]'));
  T('toda linha tem as duas travas dentro do mesmo container (.travas)',
    linhasComTrava.every(r => r.querySelector('.travas [data-tv]') && r.querySelector('.travas [data-tv-fora]')));
  T('as duas travas usam a mesma classe (.tv), pra alinhar na mesma posicao em todas as linhas',
    linhasComTrava.every(r => r.querySelector('.travas [data-tv]').closest('label').classList.contains('tv') &&
      r.querySelector('.travas [data-tv-fora]').closest('label').classList.contains('tv')));
  T('"Fora de UF" fica a ESQUERDA de "Dentro de UF" no markup (pedido item 2)',
    (() => {
      const html = linhaDe(CV).querySelector('.travas').innerHTML;
      return html.indexOf('data-tv-fora') < html.indexOf('data-tv=');
    })());

  // ---------- item 1: "Dentro de UF" continua com o mesmo comportamento (regressao) ----------
  const cvComDentro = w.RES.alocFinal.filter(a => a.cli === CV);
  T('com "Dentro de MT" marcada, so recebe origens de MT',
    cvComDentro.every(a => a.uf === 'MT'), [...new Set(cvComDentro.map(a => a.uf))].join(','));

  // ---------- item 2 e 3: marcar "Fora de UF" desmarca "Dentro de UF" e filtra o oposto ----------
  await marcar(cbFora(CV));
  T('marcar "Fora de UF" desmarca "Dentro de UF" na hora (sem esperar rodar)', !cbDentro(CV).checked);
  await rodarEsperando();
  const cvComFora = w.RES.alocFinal.filter(a => a.cli === CV);
  T('com "Fora de MT" marcada, ha alocacao pra conferir', cvComFora.length > 0, cvComFora.length);
  T('com "Fora de MT" marcada, NUNCA recebe origem de MT (so de outra UF)',
    cvComFora.every(a => a.uf !== 'MT'), [...new Set(cvComFora.map(a => a.uf))].join(','));

  // marcar "Dentro" de novo desmarca "Fora"
  await marcar(cbDentro(CV));
  T('marcar "Dentro de UF" de volta desmarca "Fora de UF"', !cbFora(CV).checked);
  await rodarEsperando();

  // ---------- item 3: nenhuma marcada = sem restricao ----------
  await desmarcar(cbDentro(CV));
  await rodarEsperando();
  const cvSemTrava = w.RES.alocFinal.filter(a => a.cli === CV);
  T('sem nenhuma trava marcada: recebe de mais de uma UF (sem restricao, como antes)',
    new Set(cvSemTrava.map(a => a.uf)).size > 1, [...new Set(cvSemTrava.map(a => a.uf))].join(','));

  // ---------- item 6: resumo conta as duas travas juntas ----------
  await marcar(cbFora(CV));
  const LINS = 'JBS - BioPower Lins';
  if (!cbDentro(LINS).checked) await marcar(cbDentro(LINS));
  const numTravas = (d().querySelector('#necResumoTxt').textContent.match(/(\d+) (?:trava fiscal|travas fiscais) ativ/) || [])[1];
  T('duas travas de tipos diferentes (Fora na Campo Verde + Dentro na Lins) somam 2 no resumo',
    numTravas === '2', d().querySelector('#necResumoTxt').textContent);

  // ---------- item 5: as duas travas valem nos dois modos ----------
  const modoMer = d().querySelector('#modoMer');
  T('achou o radio do modo Mercado livre', !!modoMer);
  if (modoMer) {
    modoMer.checked = true; modoMer.dispatchEvent(new w.Event('change'));
    await new Promise(r => setTimeout(r, 60));
    const cvMercadoComFora = w.RES.alocFinal.filter(a => a.cli === CV);
    T('modo mercado: trava "Fora de MT" continua excluindo origem MT',
      cvMercadoComFora.every(a => a.uf !== 'MT'), [...new Set(cvMercadoComFora.map(a => a.uf))].join(','));
    const modoPri = d().querySelector('#modoPri');
    modoPri.checked = true; modoPri.dispatchEvent(new w.Event('change'));
    await new Promise(r => setTimeout(r, 60));
  }

  // deixa a Campo Verde como estava (Dentro de MT) e a Lins sem trava, antes
  // de seguir — evita vazar estado pro resto do arquivo.
  await desmarcar(cbFora(CV));
  await marcar(cbDentro(CV));
  if (cbDentro(LINS).checked) await desmarcar(cbDentro(LINS));

  // ---------- item 4: as cinco fabricas proprias tem a opcao (com UF delas) ----------
  const cincoProprias = ['Flora GO', 'Flora SP', 'JBS - BioPower Campo Verde', 'JBS - BioPower Lins', 'JBS - BioPower Mafra'];
  const presentes = cincoProprias.filter(c => !!linhaDe(c));
  T('pelo menos uma das cinco fabricas proprias esta na lista de destinos desta massa de teste',
    presentes.length > 0, presentes.join(', '));
  presentes.forEach(c => {
    T('"' + c + '" tem as duas opcoes de trava (Dentro e Fora)', !!cbDentro(c) && !!cbFora(c));
  });

  // ---------- item 7: a trava escolhida entra no que e gravado ao fechar ----------
  await marcar(cbFora('Flora GO'));
  const pac = w.montarSemana(w.PROD, w.RES.alocFinal, w.RES.otimoAloc, w.OPS, w.MAPA, w.DS);
  pac.cabecalho.modo = w.ST.modo;
  pac.cabecalho.necessidades = Object.assign({}, w.ST.nec);
  pac.cabecalho.travas = Object.assign({}, w.ST.travas);
  T('pac.cabecalho.travas existe e carrega o estado atual das travas',
    !!pac.cabecalho.travas && pac.cabecalho.travas['Flora GO'] === '!GO' && pac.cabecalho.travas[CV] === 'MT',
    JSON.stringify(pac.cabecalho.travas));

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
