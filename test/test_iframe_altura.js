// Rolagem interna das secoes embutidas (Consolidado/Analise/Usuarios): o
// iframe nao pode ter altura fixa nem rolagem propria — quem manda na
// altura e o conteudo de dentro, via ResizeObserver + postMessage (com
// checagem de origem) pro painel (src/ui.js: ligarMensagensFrame). Links
// que navegam de dentro do iframe (abrir semana, sessao expirada) tem que
// trocar a pagina inteira (window.top), nunca so o iframe. Cobre os tres
// pontos: sem rolagem propria, altura reajustada, navegacao no painel
// principal — nao mexe em servidor nem banco.
process.chdir(__dirname);
const path = require('path');
const fs = require('fs'); const { JSDOM } = require('jsdom');
const PAINEL = path.join(__dirname, '..', 'public', 'index.html');
const CONSOLIDADO = path.join(__dirname, '..', 'public', 'consolidado.html');
const ANALISE = path.join(__dirname, '..', 'public', 'analise.html');
const ADMIN = path.join(__dirname, '..', 'public', 'admin.html');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

(async () => {
  // ============ 1. markup: iframe sem rolagem propria, sem altura fixa ============
  const htmlPainel = fs.readFileSync(PAINEL, 'utf8');
  T('nenhuma altura fixa tipo 100vh sobrando pro iframe (rolagem propria)',
    htmlPainel.indexOf('height:calc(100vh') === -1 && htmlPainel.indexOf('min-height:520px') === -1);
  ['frameConsolidado', 'frameAnalise', 'frameUsuarios'].forEach(id => {
    const re = new RegExp('<iframe id="' + id + '"[^>]*>');
    const m = re.exec(htmlPainel);
    T('iframe #' + id + ' existe', !!m, htmlPainel.slice(0, 0));
    T('iframe #' + id + ' com scrolling="no" (so a barra do navegador rola)',
      !!m && m[0].indexOf('scrolling="no"') >= 0, m && m[0]);
  });

  // ============ 2. painel: listener de altura (ligarMensagensFrame) ============
  const domPainel = new JSDOM(htmlPainel, {
    runScripts: 'dangerously', url: 'https://x/',
    beforeParse(window) {
      window.fetch = async () => respFake(404, {});
      window.alert = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.Element.prototype.scrollIntoView = function () {};
    }
  });
  const wP = domPainel.window;
  await new Promise(r => setTimeout(r, 150));
  const dP = wP.document;
  const fConsolidado = dP.getElementById('frameConsolidado');
  const fAnalise = dP.getElementById('frameAnalise');

  T('antes de qualquer mensagem, iframe nao tem altura fixada inline (CSS decide o default)',
    fConsolidado.style.height === '');

  const mandarMensagem = (data, origin) =>
    wP.dispatchEvent(new wP.MessageEvent('message', { data, origin: origin || 'https://x' }));

  mandarMensagem({ tipo: 'alturaFrame', secao: 'consolidado', altura: 999 }, 'https://malicioso.example');
  T('mensagem de origem diferente e ignorada (nao muda a altura)', fConsolidado.style.height === '');

  mandarMensagem({ tipo: 'alturaFrame', secao: 'consolidado', altura: 842 });
  T('mensagem da mesma origem ajusta a altura do iframe certo', fConsolidado.style.height === '842px');
  T('so o iframe da secao mencionada muda, os outros ficam quietos', fAnalise.style.height === '');

  mandarMensagem({ tipo: 'alturaFrame', secao: 'analise', altura: '533' });
  T('altura aceita como string numerica tambem', fAnalise.style.height === '533px');

  mandarMensagem({ tipo: 'outracoisa', secao: 'consolidado', altura: 111 });
  T('mensagem com tipo diferente e ignorada', fConsolidado.style.height === '842px');

  mandarMensagem({ tipo: 'alturaFrame', secao: 'secaoQueNaoExiste', altura: 111 });
  T('mensagem com secao desconhecida nao quebra nem afeta outros frames',
    fConsolidado.style.height === '842px' && fAnalise.style.height === '533px');

  mandarMensagem({ tipo: 'alturaFrame', secao: 'consolidado', altura: 0 });
  T('altura zero/invalida e ignorada (nao some o conteudo)', fConsolidado.style.height === '842px');

  // ---- a secao muda de novo depois de reajustada: novo valor sobrescreve o anterior ----
  mandarMensagem({ tipo: 'alturaFrame', secao: 'consolidado', altura: 1500 });
  T('altura e reajustada de novo quando o conteudo muda outra vez', fConsolidado.style.height === '1500px');

  // ============ 3. links dentro do iframe navegam o painel principal, nao o iframe ============
  // jsdom nao implementa navegacao de verdade (mesma limitacao ja documentada
  // em test_consolidado.js) e window.top nao pode ser substituido (propriedade
  // nao-configuravel) — entao a prova aqui e em duas partes: (a) a funcao
  // navTopo() de cada pagina realmente usa window.top.location.href, nunca so
  // location.href (senao o clique navegaria dentro do proprio iframe); (b) os
  // pontos que precisam navegar (abrir semana, sessao expirada) de fato
  // chamam navTopo() com a URL certa — verificado trocando window.navTopo por
  // um espiao depois da pagina carregada.
  function carregarPagina(arquivo, mockFetch, urlInicial) {
    const dom = new JSDOM(fs.readFileSync(arquivo, 'utf8'), {
      runScripts: 'dangerously', url: urlInicial || 'https://x/',
      beforeParse(window) { window.fetch = mockFetch; window.alert = () => {}; }
    });
    return dom.window;
  }

  [CONSOLIDADO, ANALISE, ADMIN].forEach(arquivo => {
    const w = carregarPagina(arquivo, async () => respFake(404, {}));
    const src = String(w.navTopo);
    T(path.basename(arquivo) + ': navTopo() navega window.top (painel principal), nao so a janela do iframe',
      /top\s*\.\s*location\s*\.\s*href/.test(src), src);
  });

  const semana38 = {
    ano: 2026, semana: 38, periodo: '14/09 a 20/09', versao: 1,
    fechada_em: '2026-09-20T18:00:00.000Z', fechada_por: 'Ronaldo', linhas: 254, toneladas: 11620
  };
  const consolFake = extra => Object.assign({
    modo: 'semana', mes: null, ano: 2026, semana: 38,
    porUf: [], porPlanta: [], porPropria: [], semanasFechadas: [semana38],
    total: { toneladas: 11620, net_medio: 5000, semanas: 1 }
  }, extra);

  {
    const mockFetch = async url => {
      if (url === '/api/semanas') return respFake(200, [semana38]);
      if (url === '/api/consolidado?semana=2026-38') return respFake(200, consolFake());
      return respFake(404, {});
    };
    const w = carregarPagina(CONSOLIDADO, mockFetch, 'https://x/?semana=2026-38');
    await new Promise(r => setTimeout(r, 150));
    const btnAbrir = w.document.querySelector('.abrir');
    T('botao "abrir" renderizado', !!btnAbrir);
    const chamadas = [];
    w.navTopo = url => chamadas.push(url);
    btnAbrir.dispatchEvent(new w.Event('click'));
    T('clicar em "abrir" chama navTopo com a URL da semana (vai pro painel principal)',
      chamadas.length === 1 && chamadas[0] === '/?abrirSemana=2026-38', chamadas.join(', '));
  }

  // ---- sessao expirada (401) durante o uso: redireciona o painel inteiro pro login ----
  // o espiao precisa entrar ANTES do boot assincrono terminar (por isso nao
  // ha await entre criar a pagina e substituir navTopo).
  {
    const mockFetch = async () => respFake(401, { erro: 'Faça login para continuar.' });
    const w = carregarPagina(CONSOLIDADO, mockFetch);
    const chamadas = [];
    w.navTopo = url => chamadas.push(url);
    await new Promise(r => setTimeout(r, 150));
    T('consolidado.html: 401 chama navTopo("/entrar") (nao so o iframe)',
      chamadas.indexOf('/entrar') >= 0, chamadas.join(', '));
  }

  // ============ 4. analise.html: mesma checagem de sessao expirada ============
  {
    const mockFetch = async () => respFake(401, { erro: 'Faça login para continuar.' });
    const w = carregarPagina(ANALISE, mockFetch);
    const chamadas = [];
    w.navTopo = url => chamadas.push(url);
    await new Promise(r => setTimeout(r, 150));
    T('analise.html: 401 chama navTopo("/entrar")', chamadas.indexOf('/entrar') >= 0);
  }

  // ============ 5. admin.html: mesma checagem, tanto na carga quanto numa acao ============
  {
    const mockFetch = async () => respFake(401, { erro: 'Faça login para continuar.' });
    const w = carregarPagina(ADMIN, mockFetch);
    const chamadas = [];
    w.navTopo = url => chamadas.push(url);
    await new Promise(r => setTimeout(r, 150));
    T('admin.html: /api/eu com 401 chama navTopo("/entrar")', chamadas.indexOf('/entrar') >= 0);
  }
  {
    const EU = { id: 10, nome: 'Eu Mesmo', email: 'eu@exemplo.com', papel: 'admin', situacao: 'ativo' };
    const COMUM = { id: 30, nome: 'Fulano Comum', email: 'fulano@exemplo.com', papel: 'usuario', situacao: 'ativo', criado_em: '2026-01-01' };
    const mockFetch = async (url, opts) => {
      if (url === '/api/eu') return respFake(200, { usuario: EU });
      if (url === '/api/usuarios') return respFake(200, { usuarios: [EU, COMUM] });
      if (url.indexOf('/api/usuarios/') === 0 && opts && opts.method === 'POST') return respFake(401, { erro: 'sessao' });
      return respFake(404, {});
    };
    const w = carregarPagina(ADMIN, mockFetch);
    await new Promise(r => setTimeout(r, 150));
    const btn = w.document.querySelector('button[data-acao="bloquear"][data-id="30"]');
    T('botao de acao encontrado (sessao valida no boot)', !!btn);
    if (btn) {
      const chamadas = [];
      w.navTopo = url => chamadas.push(url);
      btn.dispatchEvent(new w.Event('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      T('acao que retorna 401 no meio do uso tambem chama navTopo("/entrar")',
        chamadas.indexOf('/entrar') >= 0, chamadas.join(', '));
    }
  }

  // ============ 6. altura reportada pro painel (ResizeObserver + postMessage) ============
  // jsdom nao tem motor de layout: document.documentElement.scrollHeight e
  // sempre 0 de verdade, entao o teste fixa um valor (842) pra provar que a
  // mensagem carrega o numero que a pagina leu, nao um valor fixo do codigo.
  function carregarComIframeFake(arquivo, mockFetch) {
    const postMsgs = [];
    const dom = new JSDOM(fs.readFileSync(arquivo, 'utf8'), {
      runScripts: 'dangerously', url: 'https://x/',
      beforeParse(window) {
        window.fetch = mockFetch; window.alert = () => {};
        const parentFake = { postMessage: (data, origin) => postMsgs.push({ data, origin }) };
        Object.defineProperty(window, 'parent', { value: parentFake, configurable: true });
        window.ResizeObserver = function (cb) { this.observe = () => {}; this.disconnect = () => {}; };
        Object.defineProperty(window.Element.prototype, 'scrollHeight', { configurable: true, get() { return 842; } });
      }
    });
    return { window: dom.window, postMsgs };
  }

  {
    const mockFetch = async url => {
      if (url === '/api/semanas') return respFake(200, [semana38]);
      if (url === '/api/consolidado?semana=2026-38') return respFake(200, consolFake());
      return respFake(404, {});
    };
    const { postMsgs } = carregarComIframeFake(CONSOLIDADO, mockFetch);
    await new Promise(r => setTimeout(r, 200));
    const msg = postMsgs.find(m => m.data && m.data.tipo === 'alturaFrame');
    T('consolidado.html avisa a propria altura por postMessage quando embutido',
      !!msg, JSON.stringify(postMsgs));
    T('mensagem de altura identifica a secao certa', !!msg && msg.data.secao === 'consolidado');
    T('mensagem de altura manda a altura real do conteudo (nao um valor fixo)',
      !!msg && Number(msg.data.altura) === 842, msg && msg.data.altura);
    T('postMessage restrito a propria origem (nao usa "*")', !!msg && msg.origin === 'https://x');
  }

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
