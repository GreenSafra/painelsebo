// Cabecalho com a semana aberta em destaque na Home (#semanaHome) — deixa
// claro, sem rolar, a qual semana o painel aberto se refere. Cobre: sem
// semana aberta (nao aparece), semana recem-importada (rascunho), semana
// fechada recem-aberta (ainda intocada) e a mesma semana depois de editada
// (reaberta). O subtitulo do topo (#sub) nao muda de comportamento — so
// conferido aqui de raspao pra provar que os dois convivem sem conflito.
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
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

function rotear(regras) {
  return async (url) => {
    for (const [prefixo, resp] of regras) {
      if (url.indexOf(prefixo) === 0) return typeof resp === 'function' ? resp(url) : resp;
    }
    return respFake(404, {});
  };
}

const semanaHome = () => w.document.getElementById('semanaHome');
const tituloHome = () => semanaHome().querySelector('.titulo');
const situacaoHome = () => semanaHome().querySelector('.situacao');

(async () => {
  await new Promise(r => setTimeout(r, 60));

  // ---------- item 3: sem semana aberta, o cabecalho nao aparece ----------
  T('#app comeca escondido (sem semana aberta)', w.document.getElementById('app').classList.contains('hide'));
  T('#semanaHome vazio sem semana aberta', semanaHome().innerHTML.trim() === '');

  // ---------- rascunho: semana recem-importada, nunca fechada ----------
  await w.receber('prog', fake('prog.xlsx', 'in/prog38.xlsx'));
  await w.receber('mapa', fake('mapa.xlsx', 'in/mapa2.xlsx'));
  await new Promise(r => setTimeout(r, 150));

  T('#app visivel com semana aberta', !w.document.getElementById('app').classList.contains('hide'));
  T('#semanaHome preenchido', semanaHome().innerHTML.trim() !== '');
  T('titulo mostra "Semana 38/2026" (com o ano, diferente do subtitulo do topo)',
    tituloHome().textContent.indexOf('Semana 38/2026') === 0, tituloHome().textContent);
  T('titulo inclui o periodo', tituloHome().textContent.indexOf('14/09 a 20/09') >= 0, tituloHome().textContent);
  T('situacao mostra "rascunho" (nunca fechada)', situacaoHome().textContent.trim() === 'rascunho');

  // item 4: o subtitulo do topo continua como sempre foi (nao mexi nele)
  T('subtitulo do topo (#sub) continua mostrando so "Semana 38", sem o ano',
    w.document.getElementById('sub').textContent.indexOf('Semana 38') === 0 &&
    w.document.getElementById('sub').textContent.indexOf('Semana 38/2026') === -1,
    w.document.getElementById('sub').textContent);

  // ---------- semana fechada, recem-aberta, ainda intocada ----------
  const pacote = w.montarPacoteDados();
  const ano = w.anoDaSemana(pacote.prod);
  const semana = pacote.prod.semana;
  w.fetch = rotear([
    ['/api/rascunho-recente', respFake(200, null)],
    ['/api/semana-recente', respFake(200, { ano, semana, versao: 8, fechada_em: '2026-09-20T18:00:00.000Z', fechada_por: 'Ronaldo' })],
    ['/api/semana?', respFake(200, { dados: pacote, versao: 8, periodo: null, fechadaEm: '2026-09-20T18:00:00.000Z', fechadaPor: 'Ronaldo' })],
    ['/api/semanas-salvas', respFake(200, [])]
  ]);
  w.PROD = null; w.MAPA = null; w.PROGBUF = null; w.ST = null;
  w.RES = null; w.DS = null; w.OPS = null; w.NEC = null; w.RAW = null;
  try { w.localStorage.clear(); } catch (e) {}
  await w.boot();

  T('semana fechada carregada', w.PROD && w.PROD.semana === semana);
  T('origem marcada como fechada v8', w.ORIGEM_FECHADA && w.ORIGEM_FECHADA.versao === 8);
  T('recem-aberta, sem editar nada: rascunho nao esta sujo', w.RASCUNHO_SUJO === false);
  T('situacao mostra "fechada v8" (intocada) — nao "reaberta"',
    situacaoHome().textContent.trim() === 'fechada v8', situacaoHome().textContent);
  T('subtitulo do topo continua com o texto de sempre ("reaberta da v8 por Ronaldo")',
    w.document.getElementById('sub').textContent.indexOf('reaberta da v8 por Ronaldo') >= 0,
    w.document.getElementById('sub').textContent);

  // ---------- a mesma semana, depois de editada: vira "reaberta" ----------
  const E = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  const algumaNec = w.document.querySelector('[data-nec]');
  T('ha campo de necessidade pra editar', !!algumaNec);
  if (algumaNec) {
    algumaNec.value = '35';
    algumaNec.dispatchEvent(new w.Event('input'));
    // digitar so marca a necessidade como "pendente de rodar" (SUJO, outro
    // sentido) — precisa rodar() de verdade pra passar por render() e
    // marcar RASCUNHO_SUJO (o que o selo "reaberta" depende).
    w.rodar();
    await new Promise(r => setTimeout(r, 120));
    T('depois de editar: rascunho fica sujo', w.RASCUNHO_SUJO === true);
    T('situacao muda pra "reaberta da v8"', situacaoHome().textContent.trim() === 'reaberta da v8',
      situacaoHome().textContent);
    T('titulo continua mostrando a mesma semana', tituloHome().textContent.indexOf('Semana ' + semana) === 0);
  }

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
