// Analise de cotacoes separada por regime de ICMS (public/analise.html) —
// a oferta bruta nao e comparavel entre origens com ICMS diferente, entao
// cada regime do cliente vira uma linha propria do ranking. Cobre: cliente
// com dois regimes (duas linhas, rotulo em cada), cliente com um regime so
// (uma linha, sem rotulo extra), sequencia das 3 semanas casando por
// cliente+regime (nao so por cliente), regime ausente numa semana anterior
// sem vazar pro outro regime do mesmo cliente, aliquota diferente de 12% no
// rotulo, e o subtitulo contando clientes e linhas.
process.chdir(__dirname);
const path = require('path');
const ANALISE = path.join(__dirname, '..', 'public', 'analise.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

// 3 semanas com cotacao (API devolve DESC).
const SEMANAS_API = [
  { ano: 2026, semana: 38, linhas: 5, clientes: 3, data_cotacao: '2026-09-10' },
  { ano: 2026, semana: 37, linhas: 4, clientes: 3, data_cotacao: '2026-09-03' },
  { ano: 2026, semana: 36, linhas: 3, clientes: 2, data_cotacao: '2026-08-27' }
];

// linha crua: {ano, semana, cliente, origem, oferta, icms}
const COTACOES = [
  // Campo Verde: dois regimes toda semana (o caso do enunciado) — com ICMS
  // 12% sobe, diferido cai um pouco, pra confirmar que cada serie e
  // independente.
  { ano: 2026, semana: 36, cliente: 'JBS - BioPower Campo Verde', origem: 'X', oferta: 6400, icms: 0.12 },
  { ano: 2026, semana: 36, cliente: 'JBS - BioPower Campo Verde', origem: 'Y', oferta: 5900, icms: 0 },
  { ano: 2026, semana: 37, cliente: 'JBS - BioPower Campo Verde', origem: 'X', oferta: 6500, icms: 0.12 },
  { ano: 2026, semana: 37, cliente: 'JBS - BioPower Campo Verde', origem: 'Y', oferta: 5850, icms: 0 },
  { ano: 2026, semana: 38, cliente: 'JBS - BioPower Campo Verde', origem: 'X', oferta: 6600, icms: 0.12 },
  { ano: 2026, semana: 38, cliente: 'JBS - BioPower Campo Verde', origem: 'Y', oferta: 5808, icms: 0 },
  // Cliente Unico: um regime so (diferido) nas 3 semanas — nao pode ganhar rotulo.
  { ano: 2026, semana: 36, cliente: 'Cliente Unico', origem: 'Z', oferta: 5000, icms: 0 },
  { ano: 2026, semana: 37, cliente: 'Cliente Unico', origem: 'Z', oferta: 5100, icms: 0 },
  { ano: 2026, semana: 38, cliente: 'Cliente Unico', origem: 'Z', oferta: 5200, icms: 0 },
  // Cliente Sete: diferido as 3 semanas, mas ICMS 7% so passou a ofertar a
  // partir da semana 37 (ausente na 36) — testa aliquota fora do 12% no
  // rotulo e regime ausente numa semana sem vazar pro outro regime.
  { ano: 2026, semana: 36, cliente: 'Cliente Sete', origem: 'W', oferta: 4500, icms: 0 },
  { ano: 2026, semana: 37, cliente: 'Cliente Sete', origem: 'W', oferta: 4550, icms: 0 },
  { ano: 2026, semana: 37, cliente: 'Cliente Sete', origem: 'V', oferta: 4700, icms: 0.07 },
  { ano: 2026, semana: 38, cliente: 'Cliente Sete', origem: 'W', oferta: 4600, icms: 0 },
  { ano: 2026, semana: 38, cliente: 'Cliente Sete', origem: 'V', oferta: 4750, icms: 0.07 }
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

function cardsPorTexto(doc, textoInicio) {
  return [...doc.querySelectorAll('.card')].filter(c => c.querySelector('.nome').textContent.trim().indexOf(textoInicio) === 0);
}
function colsDe(card) { return [...card.querySelectorAll('.semanas > .col')]; }
function txt(el, sel) { return el.querySelector(sel).textContent.trim(); }

(async () => {
  const chamadas = [];
  const dom = carregarPagina('https://x/', mockPadrao(chamadas));
  const w = dom.window;
  await new Promise(r => setTimeout(r, 150));
  const d = w.document;

  T('pagina carregou sem quebrar', !!d.querySelector('#conteudo'));

  // ---------- item 2: cliente com dois regimes vira duas linhas do ranking ----------
  const cardsCV = cardsPorTexto(d, 'JBS - BioPower Campo Verde');
  T('Campo Verde aparece em duas linhas (uma por regime)', cardsCV.length === 2, cardsCV.length);
  const nomesCV = cardsCV.map(c => c.querySelector('.nome').textContent.trim()).sort();
  T('uma linha rotulada "com ICMS 12%", outra "diferido"',
    JSON.stringify(nomesCV) === JSON.stringify([
      'JBS - BioPower Campo Verde · com ICMS 12%',
      'JBS - BioPower Campo Verde · diferido'
    ].sort()), nomesCV);

  const cardCV12 = cardsCV.find(c => /com ICMS 12%/.test(c.querySelector('.nome').textContent));
  const cardCVdif = cardsCV.find(c => /diferido/.test(c.querySelector('.nome').textContent));
  T('linha "com ICMS 12%" achada', !!cardCV12);
  T('linha "diferido" achada', !!cardCVdif);
  if (cardCV12) {
    const cols = colsDe(cardCV12);
    T('regime com ICMS 12%: preco da semana atual e o do enunciado (6.600)',
      txt(cols[2], '.pr') === 'R$ 6.600', txt(cols[2], '.pr'));
  }
  if (cardCVdif) {
    const cols = colsDe(cardCVdif);
    T('regime diferido: preco da semana atual e o do enunciado (5.808)',
      txt(cols[2], '.pr') === 'R$ 5.808', txt(cols[2], '.pr'));
  }

  // ---------- item 4: cada regime tem sua PROPRIA sequencia de 3 semanas, sem misturar ----------
  if (cardCV12) {
    const cols = colsDe(cardCV12);
    T('regime com ICMS 12%: sequencia das 3 semanas e so desse regime (6.400, 6.500, 6.600)',
      txt(cols[0], '.pr') === '6.400' && txt(cols[1], '.pr') === '6.500' && txt(cols[2], '.pr') === 'R$ 6.600',
      cols.map(c => txt(c, '.pr')));
  }
  if (cardCVdif) {
    const cols = colsDe(cardCVdif);
    T('regime diferido: sequencia das 3 semanas e so desse regime (5.900, 5.850, 5.808), nao mistura com o outro regime',
      txt(cols[0], '.pr') === '5.900' && txt(cols[1], '.pr') === '5.850' && txt(cols[2], '.pr') === 'R$ 5.808',
      cols.map(c => txt(c, '.pr')));
  }

  // ---------- item 2: cliente com um regime so continua com uma linha, sem rotulo extra ----------
  const cardsUnico = cardsPorTexto(d, 'Cliente Unico');
  T('Cliente Unico aparece em uma linha so', cardsUnico.length === 1, cardsUnico.length);
  if (cardsUnico.length === 1) {
    T('sem rotulo de regime no nome (um regime so)',
      cardsUnico[0].querySelector('.nome').textContent.trim() === 'Cliente Unico',
      cardsUnico[0].querySelector('.nome').textContent);
  }

  // ---------- item 1: aliquota diferente de 12% usa o proprio valor no rotulo ----------
  const cardsSete = cardsPorTexto(d, 'Cliente Sete');
  T('Cliente Sete aparece em duas linhas (diferido e ICMS 7%)', cardsSete.length === 2, cardsSete.length);
  const nomesSete = cardsSete.map(c => c.querySelector('.nome').textContent.trim()).sort();
  T('rotulo usa a aliquota real (7%), nao trava em 12%',
    nomesSete.some(n => /com ICMS 7%/.test(n)), nomesSete);

  // ---------- item 5: regime ausente numa semana anterior mostra "-", sem variacao, sem vazar pro outro regime ----------
  const card7 = cardsSete.find(c => /com ICMS 7%/.test(c.querySelector('.nome').textContent));
  T('linha do regime ICMS 7% encontrada', !!card7);
  if (card7) {
    const cols = colsDe(card7);
    T('semana 36 (regime 7% ainda nao existia pra este cliente): preco "-"',
      txt(cols[0], '.pr') === '-', txt(cols[0], '.pr'));
    T('semana 36: sem variacao (espaco reservado)',
      txt(cols[0], '.dif') === '' && cols[0].querySelector('.dif').classList.contains('ausente'));
    T('semana 37 (primeira oferta deste regime): preco 4.700, sem "R$" (nao e a atual)',
      txt(cols[1], '.pr') === '4.700', txt(cols[1], '.pr'));
    T('semana 37: sem variacao tambem (a coluna anterior, S36, nao tem preco NESTE regime)',
      txt(cols[1], '.dif') === '' && cols[1].querySelector('.dif').classList.contains('ausente'));
    T('semana 38 (atual): preco 4.750, com "R$", em destaque',
      txt(cols[2], '.pr') === 'R$ 4.750' && cols[2].classList.contains('atual'));
    T('semana 38: variacao contra a 37 deste MESMO regime (+R$ 50), nao contra o diferido',
      txt(cols[2], '.dif') === '+R$ 50', txt(cols[2], '.dif'));
  }
  const cardDif = cardsSete.find(c => /diferido/.test(c.querySelector('.nome').textContent));
  if (cardDif) {
    const cols = colsDe(cardDif);
    T('linha diferido do mesmo cliente nao foi afetada pelo regime 7% (4.500, 4.550, R$ 4.600)',
      txt(cols[0], '.pr') === '4.500' && txt(cols[1], '.pr') === '4.550' && txt(cols[2], '.pr') === 'R$ 4.600',
      cols.map(c => txt(c, '.pr')));
  }

  // ---------- item 6: ranking continua ordenado pelo preco (agora por linha, nao por cliente) ----------
  const cards = [...d.querySelectorAll('.card')];
  const precos = cards.map(c => {
    const atual = [...c.querySelectorAll('.col.atual .pr')][0].textContent.trim();
    return Number(atual.replace(/[^\d]/g, ''));
  });
  const ordenado = precos.every((v, i) => i === 0 || precos[i - 1] >= v);
  T('ranking continua ordenado do maior pro menor preco, linha por linha', ordenado, precos);

  // ---------- item 7: subtitulo reflete clientes E linhas (2 unidades diferentes agora) ----------
  const sub = d.querySelector('#sub').textContent;
  T('subtitulo conta clientes (3) e linhas (5, porque dois deles tem 2 regimes)',
    sub.indexOf('3 clientes cotaram em 5 linhas') >= 0, sub);

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
