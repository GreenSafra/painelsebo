// Menu fixo e navegação entre seções (Home, Importar, Consolidado, Análise,
// Usuários): URLs próprias, seção destacada no menu, iframe apontado pra
// versão "?frame=1" de Consolidado/Análise/Usuários, popstate (Voltar), e
// os três blocos de upload em /importar. server.js (as rotas /consolidado,
// /analise, /usuarios servindo a casca ou o frame, o redirecionamento de
// /mapas e /admin) fica por revisão de código — sem servidor rodando nem
// Postgres local, mesmo padrão das levas anteriores; aqui testa-se só o
// roteador do lado do cliente.
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

function carregarPagina(url) {
  return new JSDOM(fs.readFileSync(PAINEL, 'utf8'), {
    runScripts: 'dangerously', url,
    beforeParse(window) {
      window.fetch = async () => respFake(404, {});
      window.alert = () => {};
    }
  });
}

function preparar(w) {
  w.DecompressionStream = DecompressionStream; w.CompressionStream = CompressionStream;
  w.Response = Response; w.Blob = Blob; w.XMLSerializer = w.XMLSerializer;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.Element.prototype.scrollIntoView = function () {};
  w.btoa = s => Buffer.from(s, 'binary').toString('base64');
  w.atob = s => Buffer.from(s, 'base64').toString('binary');
}

(async () => {
  // ============ 1. Menu: ordem, seções com URL própria, seção atual destacada ============
  const dom1 = carregarPagina('https://x/');
  const w1 = dom1.window; preparar(w1);
  await new Promise(r => setTimeout(r, 100));
  const d1 = w1.document;

  const itensMenu = [...d1.querySelectorAll('#menu [data-rota], #menu button, #menu a')]
    .map(el => (el.textContent || '').trim()).filter(Boolean);
  const ordemEsperada = ['Home', 'Nova semana', 'Importar planilhas', 'Salvar', 'Fechar semana',
    'Exportar programação', 'Consolidado', 'Análise de cotações'];
  T('menu segue a ordem pedida (Usuários fica escondido por padrão)',
    ordemEsperada.every((nome, i) => itensMenu[i] === nome), itensMenu.join(' | '));
  T('não existe mais botão "Cotações do Mapa" no menu',
    !itensMenu.some(t => t.indexOf('Cotações do Mapa') >= 0));
  T('Usuários começa escondido (gated por papel)',
    d1.querySelector('#lnkUsuarios').classList.contains('hide'));

  T('boot em "/" mostra a Home destacada no menu',
    d1.querySelector('[data-rota="/"]').classList.contains('ativo') &&
    !d1.querySelector('#secaoHome').classList.contains('hide'));
  ['#importBox', '#secaoConsolidado', '#secaoAnalise', '#secaoUsuarios'].forEach(sel => {
    T('só a Home fica visível: ' + sel + ' escondido', d1.querySelector(sel).classList.contains('hide'));
  });

  T('Salvar/Fechar/Exportar desabilitados sem semana aberta',
    d1.querySelector('#bSave').disabled && d1.querySelector('#bFechar').disabled &&
    d1.querySelector('#bProg').disabled);

  // ---- clicar em "Consolidado": muda a seção, a URL, e aponta o iframe pro frame ----
  d1.querySelector('[data-rota="/consolidado"]').dispatchEvent(new w1.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  T('clicar em Consolidado troca a URL', w1.location.pathname === '/consolidado');
  T('clicar em Consolidado mostra a seção e esconde a Home',
    !d1.querySelector('#secaoConsolidado').classList.contains('hide') &&
    d1.querySelector('#secaoHome').classList.contains('hide'));
  T('Consolidado fica destacado no menu, Home não',
    d1.querySelector('[data-rota="/consolidado"]').classList.contains('ativo') &&
    !d1.querySelector('[data-rota="/"]').classList.contains('ativo'));
  T('iframe do Consolidado aponta pra versão sem casca (?frame=1)',
    d1.querySelector('#frameConsolidado').getAttribute('src') === '/consolidado?frame=1');

  // ---- voltar pra Home, ir pra Análise, o iframe da análise também é apontado ----
  d1.querySelector('[data-rota="/"]').dispatchEvent(new w1.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  d1.querySelector('[data-rota="/analise"]').dispatchEvent(new w1.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  T('iframe da Análise aponta pra versão sem casca', d1.querySelector('#frameAnalise').getAttribute('src') === '/analise?frame=1');
  T('Análise fica destacada, Consolidado não',
    d1.querySelector('[data-rota="/analise"]').classList.contains('ativo') &&
    !d1.querySelector('[data-rota="/consolidado"]').classList.contains('ativo'));

  // ---- "voltar" do navegador: a URL muda primeiro (como o navegador faz), so depois
  // dispara popstate — o handler tem que reagir a URL, nao empilhar de novo ----
  w1.history.pushState(null, '', '/');
  w1.dispatchEvent(new w1.Event('popstate'));
  T('popstate (voltar) mostra a Home de novo, a partir da URL',
    !d1.querySelector('#secaoHome').classList.contains('hide') &&
    d1.querySelector('#secaoAnalise').classList.contains('hide') &&
    d1.querySelector('[data-rota="/"]').classList.contains('ativo'));

  // ============ 2. Home: com e sem semana aberta ============
  const dom2 = carregarPagina('https://x/');
  const w2 = dom2.window; preparar(w2);
  await new Promise(r => setTimeout(r, 100));
  const d2 = w2.document;
  const fake = (n, p) => { const b = fs.readFileSync(p); return { name: n, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };

  T('Home sem semana: só o aviso, sem a alocação',
    !d2.querySelector('#avisoSemSemana').classList.contains('hide') &&
    d2.querySelector('#app').classList.contains('hide'));

  await w2.receber('prog', fake('prog.xlsx', 'in/prog3.xlsx'));
  await w2.receber('mapa', fake('mapa.xlsx', 'in/mapa2.xlsx'));
  await new Promise(r => setTimeout(r, 150));

  T('completar Programação + Mapa manda pra Home', w2.location.pathname === '/');
  T('Home com semana: alocação aparece, aviso some',
    !d2.querySelector('#app').classList.contains('hide') &&
    d2.querySelector('#avisoSemSemana').classList.contains('hide'));
  T('Salvar/Fechar/Exportar habilitados com semana aberta',
    !d2.querySelector('#bSave').disabled && !d2.querySelector('#bFechar').disabled);
  T('Semanas salvas fica na Home, não na tela de Importar',
    d2.querySelector('#secaoHome').contains(d2.querySelector('#salvasBox')) &&
    !d2.querySelector('#importBox').contains(d2.querySelector('#salvasBox')));

  // "Nova semana" manda pra Importar
  w2.RASCUNHO_SUJO = false;
  w2.novaSemana();
  T('Nova semana manda pra /importar', w2.location.pathname === '/importar');
  T('/importar mostra a seção de importação', !d2.querySelector('#importBox').classList.contains('hide'));

  // ============ 3. Importar: os três blocos de upload ============
  T('bloco Programação presente em /importar', !!d2.querySelector('.drop[data-k="prog"]'));
  T('bloco Mapa de ofertas presente em /importar', !!d2.querySelector('.drop[data-k="mapa"]'));
  T('bloco Cotações do Mapa presente em /importar (terceiro upload)',
    !!d2.querySelector('#cotArquivos') && d2.querySelector('.cotmapa').textContent.indexOf('Cotações do Mapa') >= 0);
  T('nota explica que Programação/Mapa abrem a semana e Cotações só grava histórico',
    d2.querySelector('#importBox .note').textContent.indexOf('abrem a semana') >= 0 &&
    d2.querySelector('.cotmapa .note').textContent.indexOf('não abre nenhuma semana') >= 0);

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
