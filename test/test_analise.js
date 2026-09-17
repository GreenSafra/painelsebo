// Analise de cotacoes (public/analise.html) — ranking com as tres ultimas
// semanas por cliente, agora em colunas alinhadas a direita (rotulo, preco,
// variacao em reais), ao lado do selo de variacao percentual. Testa so o
// lado do cliente (fetch mockado): colunas alinhadas, sinal e cor da
// variacao em reais (alta/baixa/igual), primeira coluna sem variacao,
// cliente sem cotacao numa semana, primeira semana da base, e que a
// consulta ao banco continua unica (nunca uma por semana/cliente). A parte
// de banco (db.cotacoesDeSemanas) fica por revisao de codigo, sem Postgres
// local, mesmo padrao das levas anteriores.
process.chdir(__dirname);
const path = require('path');
const ANALISE = path.join(__dirname, '..', 'public', 'analise.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

// Base: 4 semanas com cotacao (2026), da mais antiga pra mais recente.
const SEMANAS_API = [ // API devolve DESC
  { ano: 2026, semana: 38, linhas: 5, clientes: 4, data_cotacao: '2026-09-10' },
  { ano: 2026, semana: 37, linhas: 4, clientes: 3, data_cotacao: '2026-09-03' },
  { ano: 2026, semana: 36, linhas: 3, clientes: 3, data_cotacao: '2026-08-27' },
  { ano: 2026, semana: 35, linhas: 1, clientes: 1, data_cotacao: '2026-08-20' }
];

// linha crua: {ano, semana, cliente, origem, oferta}
const COTACOES = [
  // Cliente A: subiu nas 3 semanas (caso "alta", verde) e tem as 4 semanas
  { ano: 2026, semana: 35, cliente: 'Cliente A', origem: 'X', oferta: 6000 },
  { ano: 2026, semana: 36, cliente: 'Cliente A', origem: 'X', oferta: 6380 },
  { ano: 2026, semana: 37, cliente: 'Cliente A', origem: 'X', oferta: 6483 },
  { ano: 2026, semana: 38, cliente: 'Cliente A', origem: 'X', oferta: 6619 },
  // Cliente B: cotou 36 e 38, faltou a 37 (buraco no meio)
  { ano: 2026, semana: 36, cliente: 'Cliente B', origem: 'X', oferta: 5900 },
  { ano: 2026, semana: 38, cliente: 'Cliente B', origem: 'X', oferta: 6100 },
  // Cliente C: caiu (caso "baixa", vermelho)
  { ano: 2026, semana: 36, cliente: 'Cliente C', origem: 'X', oferta: 7200 },
  { ano: 2026, semana: 37, cliente: 'Cliente C', origem: 'X', oferta: 7100 },
  { ano: 2026, semana: 38, cliente: 'Cliente C', origem: 'X', oferta: 6900 },
  // Cliente D: manteve o preco (caso "igual", cinza, "R$ 0")
  { ano: 2026, semana: 37, cliente: 'Cliente D', origem: 'X', oferta: 5000 },
  { ano: 2026, semana: 38, cliente: 'Cliente D', origem: 'X', oferta: 5000 }
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

function cardDe(doc, cliente) {
  return [...doc.querySelectorAll('.card')].find(c => c.querySelector('.nome').textContent.trim() === cliente);
}
function colsDe(card) { return [...card.querySelectorAll('.semanas > .col')]; }
function txt(el, sel) { return el.querySelector(sel).textContent.trim(); }

(async () => {
  // ---------- boot: cai na semana mais recente (38), colunas de 36 a 38 ----------
  const chamadas1 = [];
  const dom1 = carregarPagina('https://x/', mockPadrao(chamadas1));
  const w1 = dom1.window;
  await new Promise(r => setTimeout(r, 150));
  const d1 = w1.document;

  T('pagina carregou sem quebrar', !!d1.querySelector('#conteudo'));
  const cards1 = [...d1.querySelectorAll('.card')];
  T('ranking com os 4 clientes que cotaram na semana 38', cards1.length === 4, cards1.length);

  // ---------- item consulta unica ao banco (mantido desta leva anterior) ----------
  const chamadasVarias = chamadas1.filter(u => u.indexOf('/api/cotacoes/varias') === 0);
  T('so uma chamada a /api/cotacoes/varias (nunca uma por semana)', chamadasVarias.length === 1, chamadasVarias);
  T('a unica chamada pede as 3 semanas de uma vez (36,37,38)',
    /pares=2026-36%2C2026-37%2C2026-38/.test(chamadasVarias[0]), chamadasVarias[0]);

  // ---------- item 1: colunas alinhadas a direita, rotulo/preco/variacao, atual em destaque ----------
  const cardA = cardDe(d1, 'Cliente A');
  T('card do Cliente A encontrado', !!cardA);
  if (cardA) {
    const cols = colsDe(cardA);
    T('3 colunas, uma por semana (mais antiga -> mais recente)', cols.length === 3, cols.length);
    T('rotulos na ordem certa: S36, S37, S38',
      JSON.stringify(cols.map(c => txt(c, '.rot'))) === JSON.stringify(['S36', 'S37', 'S38']));
    T('precos das semanas anteriores sem "R$" (so o numero)',
      txt(cols[0], '.pr') === '6.380' && txt(cols[1], '.pr') === '6.483');
    T('a ultima coluna (semana selecionada) tem "R$" e a classe "atual"',
      txt(cols[2], '.pr') === 'R$ 6.619' && cols[2].classList.contains('atual'));
    T('as colunas anteriores nao tem a classe "atual"',
      !cols[0].classList.contains('atual') && !cols[1].classList.contains('atual'));
  }

  // ---------- item 2 (variacao em reais): sinal e cor certos ----------
  if (cardA) {
    const cols = colsDe(cardA);
    T('1a coluna sem variacao (nao ha semana anterior carregada), espaco reservado',
      txt(cols[0], '.dif') === '' && cols[0].querySelector('.dif').classList.contains('ausente'));
    T('2a coluna: 6380 -> 6483, "+R$ 103", verde (alta)',
      txt(cols[1], '.dif') === '+R$ 103' && cols[1].querySelector('.dif').classList.contains('alta'));
    T('3a coluna: 6483 -> 6619, "+R$ 136", verde (alta)',
      txt(cols[2], '.dif') === '+R$ 136' && cols[2].querySelector('.dif').classList.contains('alta'));
  }

  const cardC = cardDe(d1, 'Cliente C');
  T('card do Cliente C encontrado (caso de queda)', !!cardC);
  if (cardC) {
    const cols = colsDe(cardC);
    T('queda de preco: "-R$ 200", vermelho (baixa)',
      txt(cols[2], '.dif') === '-R$ 200' && cols[2].querySelector('.dif').classList.contains('baixa'),
      txt(cols[2], '.dif'));
  }

  const cardD = cardDe(d1, 'Cliente D');
  T('card do Cliente D encontrado (preco igual)', !!cardD);
  if (cardD) {
    const cols = colsDe(cardD);
    T('preco igual: "R$ 0", cinza (igual)',
      txt(cols[2], '.dif') === 'R$ 0' && cols[2].querySelector('.dif').classList.contains('igual'),
      txt(cols[2], '.dif'));
  }

  // ---------- item: cliente sem cotacao numa semana (Cliente B, faltou S37) ----------
  const cardB = cardDe(d1, 'Cliente B');
  T('card do Cliente B encontrado', !!cardB);
  if (cardB) {
    const cols = colsDe(cardB);
    T('mesmo numero de colunas que os demais clientes (alinhamento mantido)', cols.length === 3, cols.length);
    T('semana sem cotacao (S37): preco "-"', txt(cols[1], '.pr') === '-');
    T('semana sem cotacao: sem variacao propria',
      txt(cols[1], '.dif') === '' && cols[1].querySelector('.dif').classList.contains('ausente'));
    T('coluna seguinte (S38): sem variacao tambem, porque a anterior (S37) nao tem preco',
      txt(cols[2], '.dif') === '' && cols[2].querySelector('.dif').classList.contains('ausente'),
      txt(cols[2], '.dif'));
    T('mas o preco de S38 aparece normalmente (R$ 6.100)', txt(cols[2], '.pr') === 'R$ 6.100');
  }

  // ---------- ordenacao e variacao percentual continuam como estavam ----------
  const nomesNaOrdem = cards1.map(c => c.querySelector('.nome').textContent.trim());
  T('ranking ordenado pelo preco da semana selecionada',
    JSON.stringify(nomesNaOrdem) === JSON.stringify(['Cliente C', 'Cliente A', 'Cliente B', 'Cliente D']),
    nomesNaOrdem);
  T('selo de variacao percentual do Cliente A continua existindo, calculado contra a semana anterior',
    !!cardA.querySelector('.var.alta'));
  T('selo de variacao percentual do Cliente B fica ausente (nao cotou a semana anterior)',
    !!cardB.querySelector('.var.ausente'));

  // ---------- primeira semana da base: uma coluna so, sem variacao ----------
  const chamadas2 = [];
  const dom2 = carregarPagina('https://x/', mockPadrao(chamadas2));
  const w2 = dom2.window;
  await new Promise(r => setTimeout(r, 150));
  const inputSemana2 = w2.document.querySelector('#semana');
  inputSemana2.value = '2026-W35';
  inputSemana2.dispatchEvent(new w2.Event('change'));
  await new Promise(r => setTimeout(r, 150));
  const d2 = w2.document;
  T('na primeira semana da base, so o Cliente A aparece (unico que cotou)',
    d2.querySelectorAll('.card').length === 1);
  const cardA35 = cardDe(d2, 'Cliente A');
  if (cardA35) {
    const cols = colsDe(cardA35);
    T('sem semana anterior: uma unica coluna, em destaque', cols.length === 1 &&
      cols[0].classList.contains('atual') && txt(cols[0], '.rot') === 'S35' && txt(cols[0], '.pr') === 'R$ 6.000',
      cols.map(c => c.outerHTML));
    T('unica coluna tambem sem variacao (nao ha semana anterior nenhuma)',
      txt(cols[0], '.dif') === '' && cols[0].querySelector('.dif').classList.contains('ausente'));
  }
  T('variacao percentual tambem ausente (nao ha semana anterior pra comparar)',
    !!cardA35 && !!cardA35.querySelector('.var.ausente'));

  // ---------- markup: sequencia fica na propria .card, ao lado do selo, nao sob o nome ----------
  T('.semanas e irmao de .nome e .var dentro do .card (lado a lado), nao aninhado no nome',
    !!cardA.querySelector(':scope > .nome') && !!cardA.querySelector(':scope > .semanas') &&
    !!cardA.querySelector(':scope > .var'));

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
