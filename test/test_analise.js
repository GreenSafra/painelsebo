// Analise de cotacoes (public/analise.html) — ranking com os tres ultimos
// precos por cliente (nao so o da semana selecionada). Testa so o lado do
// cliente (fetch mockado): historico completo, cliente faltando uma semana
// no meio, primeira semana da base (sem anteriores), consulta unica ao
// banco (nunca uma por semana/cliente), e que ordenacao/variacao continuam
// batendo pela semana selecionada vs a anterior. A parte de banco
// (db.cotacoesDeSemanas, a clausula IN de pares) fica por revisao de
// codigo, sem Postgres local, mesmo padrao das levas anteriores.
process.chdir(__dirname);
const path = require('path');
const ANALISE = path.join(__dirname, '..', 'public', 'analise.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

// Base: 4 semanas com cotacao (2026), da mais antiga pra mais recente.
const SEMANAS_API = [ // API devolve DESC
  { ano: 2026, semana: 38, linhas: 3, clientes: 3, data_cotacao: '2026-09-10' },
  { ano: 2026, semana: 37, linhas: 2, clientes: 2, data_cotacao: '2026-09-03' },
  { ano: 2026, semana: 36, linhas: 2, clientes: 2, data_cotacao: '2026-08-27' },
  { ano: 2026, semana: 35, linhas: 1, clientes: 1, data_cotacao: '2026-08-20' }
];

// linha crua: {ano, semana, cliente, origem, oferta}
const COTACOES = [
  // Cliente A cotou nas quatro semanas (uma origem so, sem duplicidade de criterio a testar aqui)
  { ano: 2026, semana: 35, cliente: 'Cliente A', origem: 'X', oferta: 6000 },
  { ano: 2026, semana: 36, cliente: 'Cliente A', origem: 'X', oferta: 6380 },
  { ano: 2026, semana: 37, cliente: 'Cliente A', origem: 'X', oferta: 6483 },
  { ano: 2026, semana: 38, cliente: 'Cliente A', origem: 'X', oferta: 6619 },
  // Cliente B: cotou 36 e 38, faltou a 37 (buraco no meio)
  { ano: 2026, semana: 36, cliente: 'Cliente B', origem: 'X', oferta: 5900 },
  { ano: 2026, semana: 38, cliente: 'Cliente B', origem: 'X', oferta: 6100 }
];

function carregarPagina(url, mockFetch) {
  return new JSDOM(fs.readFileSync(ANALISE, 'utf8'), {
    runScripts: 'dangerously', url,
    beforeParse(window) { window.fetch = mockFetch; window.alert = () => {}; }
  });
}

function mockPadrao(chamadas) {
  return async (url) => {
    chamadas.push(url);
    if (url === '/api/cotacoes/semanas') return respFake(200, SEMANAS_API);
    const m = /^\/api\/cotacoes\/varias\?pares=(.+)$/.exec(url);
    if (m) {
      const pares = decodeURIComponent(m[1]).split(',').map(tok => {
        const [ano, semana] = tok.split('-').map(Number);
        return { ano, semana };
      });
      const linhas = COTACOES.filter(l => pares.some(p => p.ano === l.ano && p.semana === l.semana));
      return respFake(200, linhas);
    }
    return respFake(404, {});
  };
}

(async () => {
  // ---------- boot: cai na semana mais recente (38), historico de 3 ----------
  const chamadas1 = [];
  const dom1 = carregarPagina('https://x/', mockPadrao(chamadas1));
  const w1 = dom1.window;
  await new Promise(r => setTimeout(r, 150));
  const d1 = w1.document;

  T('pagina carregou sem quebrar', !!d1.querySelector('#conteudo'));
  const cards1 = [...d1.querySelectorAll('.card')];
  T('ranking com os 2 clientes que cotaram na semana 38', cards1.length === 2, cards1.length);

  // ---------- item 4: consulta unica ao banco (nao uma por semana/cliente) ----------
  const chamadasVarias = chamadas1.filter(u => u.indexOf('/api/cotacoes/varias') === 0);
  T('so uma chamada a /api/cotacoes/varias (nunca uma por semana)', chamadasVarias.length === 1, chamadasVarias);
  T('a unica chamada pede as 3 semanas de uma vez (36,37,38)',
    /pares=2026-36%2C2026-37%2C2026-38/.test(chamadasVarias[0]), chamadasVarias[0]);
  T('endpoint antigo por semana nao e mais chamado',
    !chamadas1.some(u => u.indexOf('/api/cotacoes?ano=') === 0));

  function cardDe(doc, cliente) {
    return [...doc.querySelectorAll('.card')].find(c => c.querySelector('.nome').textContent.trim() === cliente);
  }

  // ---------- item 1: cliente com as 3 semanas, mais antiga pra mais recente, atual em destaque ----------
  const cardA = cardDe(d1, 'Cliente A');
  T('card do Cliente A encontrado', !!cardA);
  if (cardA) {
    const seq = cardA.querySelector('.seq');
    T('sequencia mostra as 3 semanas na ordem certa (mais antiga -> mais recente)',
      seq.textContent.replace(/\s+/g, ' ').trim() === 'S36 6.380 · S37 6.483 · S38 6.619',
      seq.textContent);
    T('a semana atual (S38) vem destacada em <b>', /<b>S38 6\.619<\/b>/.test(seq.innerHTML), seq.innerHTML);
    T('as semanas anteriores nao estao em <b>', !/<b>S36/.test(seq.innerHTML) && !/<b>S37/.test(seq.innerHTML));
  }

  // ---------- item 2: cliente faltando uma semana no meio mostra "-", mantem alinhamento ----------
  const cardB = cardDe(d1, 'Cliente B');
  T('card do Cliente B encontrado', !!cardB);
  if (cardB) {
    const seq = cardB.querySelector('.seq');
    T('semana sem cotacao (S37) aparece como "-", sem pular a posicao',
      seq.textContent.replace(/\s+/g, ' ').trim() === 'S36 5.900 · S37 - · S38 6.100',
      seq.textContent);
    T('mesmo numero de semanas no historico do Cliente A e do Cliente B (alinhamento)',
      cardA.querySelectorAll('.seq').length === cardB.querySelectorAll('.seq').length);
  }

  // ---------- item 3: ordenacao e variacao continuam pela semana selecionada vs a anterior ----------
  const nomesNaOrdem = cards1.map(c => c.querySelector('.nome').textContent.trim());
  T('ranking ordenado pelo preco da semana selecionada (Cliente A 6619 > Cliente B 6100)',
    JSON.stringify(nomesNaOrdem) === JSON.stringify(['Cliente A', 'Cliente B']), nomesNaOrdem);
  T('variacao do Cliente A calculada contra a semana 37 (6483 -> 6619, alta)',
    !!cardA.querySelector('.var.alta'));
  T('variacao do Cliente B calculada contra a semana 37, onde ele nao cotou (ausente)',
    !!cardB.querySelector('.var.ausente'));

  // ---------- item 8: primeira semana da base, sem anteriores ----------
  const chamadas2 = [];
  const dom2 = carregarPagina('https://x/', mockPadrao(chamadas2));
  const w2 = dom2.window;
  await new Promise(r => setTimeout(r, 150));
  const inputSemana2 = w2.document.querySelector('#semana');
  inputSemana2.value = '2026-W35';
  inputSemana2.dispatchEvent(new w2.Event('change'));
  await new Promise(r => setTimeout(r, 150));
  const d2 = w2.document;
  const cardA35 = cardDe(d2, 'Cliente A');
  T('na primeira semana da base, so o Cliente A aparece (unico que cotou)',
    d2.querySelectorAll('.card').length === 1);
  if (cardA35) {
    const seq = cardA35.querySelector('.seq');
    T('sem semana anterior: historico com uma unica entrada, em destaque',
      seq.textContent.trim() === 'S35 6.000' && /<b>S35 6\.000<\/b>/.test(seq.innerHTML), seq.innerHTML);
  }
  T('variacao tambem ausente (nao ha semana anterior pra comparar)',
    !!cardA35 && !!cardA35.querySelector('.var.ausente'));

  // ---------- markup mobile: .info agrupa nome+seq numa coluna, fora de .card direto ----------
  T('.seq mora dentro de .info (junto com .nome), nao solto na .card',
    !!cardA.closest('.card').querySelector('.info > .seq'));

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
