// Tela do consolidado (public/consolidado.html) — testa o lado do cliente
// (fetch mockado): troca entre os modos Semana e Mês, exclusao de semana
// (inclusive a que esta em tela), e URL com periodo invalido/inexistente
// caindo no padrao sem quebrar. A parte de banco (db.consolidado,
// apagarSemana, o ON DELETE CASCADE) fica por revisao de codigo, sem
// Postgres local, mesmo padrao das levas anteriores.
process.chdir(__dirname);
const path = require('path');
const CONSOLIDADO = path.join(__dirname, '..', 'public', 'consolidado.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => corpo
});

const consolFake = (modo, extra) => Object.assign({
  modo, mes: null, ano: null, semana: null,
  porUf: [], porPlanta: [], porPropria: [],
  semanasFechadas: [], total: { toneladas: 11620, net_medio: 5000, semanas: 1 }
}, extra);

const semana38 = {
  ano: 2026, semana: 38, periodo: '14/09 a 20/09', versao: 1,
  fechada_em: '2026-09-20T18:00:00.000Z', fechada_por: 'Ronaldo',
  linhas: 254, toneladas: 11620
};
const semana37 = {
  ano: 2026, semana: 37, periodo: '07/09 a 13/09', versao: 1,
  fechada_em: '2026-09-13T18:00:00.000Z', fechada_por: 'Ronaldo',
  linhas: 240, toneladas: 10500
};

function carregarPagina(url, mockFetch) {
  return new JSDOM(fs.readFileSync(CONSOLIDADO, 'utf8'), {
    runScripts: 'dangerously', url,
    beforeParse(window) { window.fetch = mockFetch; window.alert = () => {}; }
  });
}

(async () => {
  // ---------- bateria 1: fluxo normal — Mes -> Semana -> excluir a semana em tela ----------
  let semanasAbertas = [semana38, semana37]; // mais recente primeiro, como listarSemanas()
  const chamadas1 = [];
  const mockFetch1 = async (url, opts) => {
    chamadas1.push({ url, method: (opts && opts.method) || 'GET' });
    if (url === '/api/meses') return respFake(200, [{ mes: '2026-09', toneladas: 11620 }]);
    if (url === '/api/semanas') return respFake(200, semanasAbertas);
    if (url === '/api/consolidado?mes=2026-09') {
      return respFake(200, consolFake('mes', { mes: '2026-09', semanasFechadas: [semana38] }));
    }
    if (url === '/api/consolidado?semana=2026-38') {
      return respFake(200, consolFake('semana', { ano: 2026, semana: 38, semanasFechadas: [semana38] }));
    }
    if (url === '/api/consolidado?semana=2026-37') {
      return respFake(200, consolFake('semana', { ano: 2026, semana: 37, semanasFechadas: [semana37] }));
    }
    if (url.indexOf('/api/semanas?') === 0 && opts && opts.method === 'DELETE') {
      const p = new URLSearchParams(url.slice(url.indexOf('?')));
      const ano = Number(p.get('ano')), semana = Number(p.get('semana'));
      semanasAbertas = semanasAbertas.filter(s => !(s.ano === ano && s.semana === semana));
      return respFake(200, { ok: true, apagadas: 1 });
    }
    return respFake(404, {});
  };

  const dom1 = carregarPagina('https://x/', mockFetch1);
  const w1 = dom1.window;
  await new Promise(r => setTimeout(r, 150));
  const d1 = w1.document;

  T('pagina carregou sem quebrar', !!d1.querySelector('#conteudo'));
  T('boot cai no modo Mes por padrao (sem parametro na URL)',
    d1.querySelector('.modobtn[data-modo="mes"]').classList.contains('ativo'));
  T('mes populado no seletor de periodo', d1.querySelectorAll('#periodo option').length === 1);
  T('subtitulo mostra o mes por extenso',
    d1.querySelector('#sub').textContent.indexOf('setembro de 2026') === 0);

  const btnSemana1 = d1.querySelector('.modobtn[data-modo="semana"]');
  btnSemana1.dispatchEvent(new w1.Event('click'));
  await new Promise(r => setTimeout(r, 100));

  T('modo Semana marcado como ativo apos o clique', btnSemana1.classList.contains('ativo'));
  T('as duas semanas fechadas populam o seletor de periodo', d1.querySelectorAll('#periodo option').length === 2);
  T('a semana mais recente vem selecionada por padrao', d1.querySelector('#periodo').value === '2026-38');
  T('consolidado foi buscado pela semana fechada (ano+semana), nao pela data de embarque',
    chamadas1.some(c => c.url === '/api/consolidado?semana=2026-38'));
  T('subtitulo mostra a semana', d1.querySelector('#sub').textContent.indexOf('semana 38/2026') === 0);
  T('card de volume nao mostra "semana(s) fechada(s)" no modo Semana',
    d1.querySelector('#conteudo').innerHTML.indexOf('semana(s) fechada(s)') === -1);

  const btn1 = d1.querySelector('.excluir');
  T('botao excluir renderizado pra semana fechada', !!btn1);
  T('botao carrega ano/semana/linhas/toneladas certos',
    !!btn1 && btn1.dataset.ano === '2026' && btn1.dataset.semana === '38' &&
    btn1.dataset.linhas === '254' && btn1.dataset.toneladas === '11620');

  w1.confirm = () => false;
  btn1.dispatchEvent(new w1.Event('click'));
  await new Promise(r => setTimeout(r, 40));
  T('cancelar a confirmacao nao chama DELETE', !chamadas1.some(c => c.method === 'DELETE'));

  w1.confirm = () => true;
  btn1.dispatchEvent(new w1.Event('click'));
  await new Promise(r => setTimeout(r, 150));
  const dels1 = chamadas1.filter(c => c.method === 'DELETE');
  T('confirmar chama DELETE /api/semanas com ano e semana certos',
    dels1.length === 1 && dels1[0].url === '/api/semanas?ano=2026&semana=38',
    dels1.map(c => c.url).join(', '));
  T('so acontece depois da confirmacao (nao antes)', dels1.length === 1);

  T('apagar a semana em tela nao pula pro modo Mes — continua no modo Semana',
    d1.querySelector('.modobtn[data-modo="semana"]').classList.contains('ativo'));
  T('cai na outra semana que restou (37), nao trava na que foi apagada',
    d1.querySelector('#periodo').value === '2026-37');
  T('consolidado foi refeito pela semana que restou',
    chamadas1.some(c => c.url === '/api/consolidado?semana=2026-37'));

  // ---------- bateria 2: URL com semana inexistente/invalida cai no padrao ----------
  async function testeUrlInvalida(nome, url) {
    const chamadas = [];
    const mockFetch = async (u, opts) => {
      chamadas.push({ url: u, method: (opts && opts.method) || 'GET' });
      if (u === '/api/meses') return respFake(200, [{ mes: '2026-09', toneladas: 11620 }]);
      if (u === '/api/semanas') return respFake(200, [semana38]);
      if (u === '/api/consolidado?mes=2026-09') {
        return respFake(200, consolFake('mes', { mes: '2026-09', semanasFechadas: [semana38] }));
      }
      if (u === '/api/consolidado?semana=2026-38') {
        return respFake(200, consolFake('semana', { ano: 2026, semana: 38, semanasFechadas: [semana38] }));
      }
      return respFake(404, {});
    };
    const dom = carregarPagina(url, mockFetch);
    const w = dom.window;
    await new Promise(r => setTimeout(r, 150));
    const d = w.document;
    return { d, w, chamadas };
  }

  {
    const { d, chamadas } = await testeUrlInvalida('semana=abc', 'https://x/?semana=abc');
    T('?semana=abc: nao quebra a tela', !!d.querySelector('#conteudo'));
    T('?semana=abc: fica no modo Semana, mas cai na semana valida existente',
      d.querySelector('#periodo').value === '2026-38');
    T('?semana=abc: consolidado buscado pela semana valida, nao pelo texto invalido',
      chamadas.some(c => c.url === '/api/consolidado?semana=2026-38') &&
      !chamadas.some(c => c.url.indexOf('semana=abc') !== -1));
    T('?semana=abc: tela nao caiu em erro',
      d.querySelector('#conteudo').innerHTML.indexOf('vazio') === -1 || !!d.querySelector('.fab, .cards'));
  }

  {
    const { d, chamadas } = await testeUrlInvalida('semana=2026-99', 'https://x/?semana=2026-99');
    T('?semana=2026-99 (inexistente): cai na semana valida existente',
      d.querySelector('#periodo').value === '2026-38');
    T('?semana=2026-99 (inexistente): consolidado buscado pela semana valida',
      chamadas.some(c => c.url === '/api/consolidado?semana=2026-38'));
  }

  {
    const { d, chamadas } = await testeUrlInvalida('mes=lixo', 'https://x/?mes=lixo');
    T('?mes=lixo: fica no modo Mes, mas cai no mes valido existente',
      d.querySelector('.modobtn[data-modo="mes"]').classList.contains('ativo') &&
      d.querySelector('#periodo').value === '2026-09');
    T('?mes=lixo: consolidado buscado pelo mes valido, nao pelo texto invalido',
      chamadas.some(c => c.url === '/api/consolidado?mes=2026-09') &&
      !chamadas.some(c => c.url.indexOf('lixo') !== -1));
  }

  // ---------- bateria 3: link "abrir" de uma semana fechada ----------
  {
    const chamadas3 = [];
    const mockFetch3 = async (url, opts) => {
      chamadas3.push({ url, method: (opts && opts.method) || 'GET' });
      if (url === '/api/semanas') return respFake(200, [semana38]);
      if (url === '/api/consolidado?semana=2026-38') {
        return respFake(200, consolFake('semana', { ano: 2026, semana: 38, semanasFechadas: [semana38] }));
      }
      return respFake(404, {});
    };
    const dom3 = carregarPagina('https://x/?semana=2026-38', mockFetch3);
    const w3 = dom3.window;
    await new Promise(r => setTimeout(r, 150));
    const d3 = w3.document;

    const btnAbrir3 = d3.querySelector('.abrir');
    T('botao abrir renderizado ao lado do excluir', !!btnAbrir3 && !!d3.querySelector('.excluir'));
    T('botao abrir carrega ano/semana certos',
      !!btnAbrir3 && btnAbrir3.dataset.ano === '2026' && btnAbrir3.dataset.semana === '38');

    w3.localStorage.setItem('sebo_sujo', '1');
    let confirmMsg3 = null;
    w3.confirm = m => { confirmMsg3 = m; return false; };
    const hrefAntes = w3.location.href;
    btnAbrir3.dispatchEvent(new w3.Event('click'));
    T('com edição pendente no painel: avisa antes de navegar', !!confirmMsg3);
    T('cancelando o aviso: não navega', w3.location.href === hrefAntes);

    // jsdom nao implementa navegacao de verdade (location.href fica parado) —
    // o que da pra verificar aqui e que o gate NAO pergunta nada quando nao
    // ha edicao pendente, que e a parte que este teste existe para cobrir.
    w3.localStorage.setItem('sebo_sujo', '');
    confirmMsg3 = null;
    w3.confirm = () => { confirmMsg3 = 'nao deveria ter sido chamado'; return true; };
    btnAbrir3.dispatchEvent(new w3.Event('click'));
    T('sem edição pendente: não pergunta nada antes de navegar', !confirmMsg3);
  }

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
