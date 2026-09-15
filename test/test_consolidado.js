// Tela do consolidado (public/consolidado.html) — primeiro teste a tocar
// esse arquivo nesta sessao. So testa o lado do cliente (fetch mockado);
// a parte de banco (apagarSemana, o DELETE FROM semanas, o ON DELETE
// CASCADE) fica por revisao de codigo, sem Postgres local, mesmo padrao
// das levas anteriores.
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

const semanaFake = {
  ano: 2026, semana: 38, periodo: '14/09 a 20/09', versao: 1,
  fechada_em: '2026-09-20T18:00:00.000Z', fechada_por: 'Ronaldo',
  linhas: 254, toneladas: 11620
};

(async () => {
  const chamadas = [];
  const mockFetch = async (url, opts) => {
    chamadas.push({ url, method: (opts && opts.method) || 'GET' });
    if (url === '/api/meses') return respFake(200, [{ mes: '2026-09', toneladas: 11620 }]);
    if (url.indexOf('/api/consolidado?mes=') === 0) {
      return respFake(200, {
        mes: '2026-09', porUf: [], porPlanta: [], porPropria: [],
        semanasFechadas: [semanaFake],
        total: { toneladas: 11620, net_medio: 5000, semanas: 1 }
      });
    }
    if (url.indexOf('/api/semanas?') === 0 && opts && opts.method === 'DELETE') {
      return respFake(200, { ok: true, apagadas: 1 });
    }
    return respFake(404, {});
  };
  // o IIFE de boot do consolidado.html roda sincrono no parse (sem
  // DOMContentLoaded) — fetch precisa existir ANTES do parse, via beforeParse.
  const dom = new JSDOM(fs.readFileSync(CONSOLIDADO, 'utf8'), {
    runScripts: 'dangerously', url: 'https://x/',
    beforeParse(window) { window.fetch = mockFetch; window.alert = () => {}; }
  });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 150));
  const d = w.document;

  const linha = d.querySelector('tr'); // so pra confirmar que alguma tabela renderizou
  T('pagina carregou sem quebrar', !!d.querySelector('#conteudo'));
  T('mes populado no seletor', d.querySelectorAll('#mes option').length === 1);

  const btn = d.querySelector('.excluir');
  T('botao excluir renderizado pra semana fechada', !!btn);
  T('botao carrega ano/semana/linhas/toneladas certos',
    !!btn && btn.dataset.ano === '2026' && btn.dataset.semana === '38' &&
    btn.dataset.linhas === '254' && btn.dataset.toneladas === '11620');

  // cancelar a confirmacao: nao chama DELETE
  w.confirm = () => false;
  btn.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 40));
  T('cancelar a confirmacao nao chama DELETE',
    !chamadas.some(c => c.method === 'DELETE'));

  // confirmar: chama DELETE com ano e semana certos
  w.confirm = () => true;
  btn.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 60));
  const dels = chamadas.filter(c => c.method === 'DELETE');
  T('confirmar chama DELETE /api/semanas com ano e semana certos',
    dels.length === 1 && dels[0].url === '/api/semanas?ano=2026&semana=38',
    dels.map(c => c.url).join(', '));
  T('so acontece depois da confirmacao (nao antes)', dels.length === 1);

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
