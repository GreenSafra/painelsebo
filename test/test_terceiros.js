// comparacaoTerceiros() e recalcularTerceirosSemana() (src/core.js) — a
// apuracao do ganho sobre o mercado passou de "melhor terceiro" para "media
// entre terceiros da mesma sigla". Testa a funcao pura direto (sem jsdom:
// core.js agora e isomorfico, "require" funciona em Node puro), cobrindo
// media com varias ofertas, cliente repetido, fabrica propria na lista,
// trava fiscal e ausencia total de oferta.
process.chdir(__dirname);
const core = require('../src/core.js');
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); };

const ehPropria = core.ehPropriaFabrica;

// ---------- 1. media simples entre varios clientes terceiros ----------
{
  const quotes = [
    { cli: 'Cliente A', net: 5000 },
    { cli: 'Cliente B', net: 6000 },
    { cli: 'Cliente C', net: 4000 }
  ];
  const c = core.comparacaoTerceiros(quotes, 'JBS - BioPower Lins', ehPropria);
  T('media simples entre 3 ofertas de clientes distintos', c.netTerMed === 5000, c);
  T('n_ter conta os 3 clientes', c.nTer === 3);
  T('melhor terceiro e o de maior NET (informativo)', c.netTer === 6000 && c.clienteTer === 'Cliente B');
  T('menor NET considerado', c.netTerMin === 4000);
  T('maior NET considerado', c.netTerMax === 6000);
}

// ---------- 2. cliente com mais de uma oferta: conta so a melhor dele ----------
{
  const quotes = [
    { cli: 'Cliente A', net: 5000 },
    { cli: 'Cliente A', net: 5800 },   // mesma sigla, outra linha do Mapa
    { cli: 'Cliente A', net: 4200 },
    { cli: 'Cliente B', net: 5000 }
  ];
  const c = core.comparacaoTerceiros(quotes, 'JBS - BioPower Lins', ehPropria);
  T('cliente repetido conta uma vez so, com a maior oferta dele',
    c.nTer === 2 && c.netTerMed === (5800 + 5000) / 2, c);
}

// ---------- 3. fabrica propria na lista: excluida da media inteira ----------
{
  const quotes = [
    { cli: 'Cliente A', net: 4000 },
    { cli: 'JBS - BioPower Campo Verde', net: 9999 },   // propria, NET altissimo
    { cli: 'Flora GO', net: 8888 }                        // propria tambem
  ];
  const c = core.comparacaoTerceiros(quotes, 'JBS - BioPower Lins', ehPropria);
  T('propria nunca entra na media, mesmo com NET muito maior',
    c.nTer === 1 && c.netTerMed === 4000, c);
  T('melhor terceiro tambem ignora propria', c.netTer === 4000 && c.clienteTer === 'Cliente A');
}

// ---------- 4. trava fiscal: propria excluida independe de UF/trava ----------
// comparacaoTerceiros nem recebe travas — a exclusao de propria (ehPropria)
// e incondicional, entao uma propria "destravada" para aquela UF continua
// de fora da media de terceiros do mesmo jeito.
{
  const quotes = [
    { cli: 'Cliente X', uf: 'MT', net: 4500 },
    { cli: 'Flora SP', uf: 'MT', net: 7000 }  // propria "destravada" (uf bate), ainda assim fora
  ];
  const c = core.comparacaoTerceiros(quotes, 'JBS - BioPower Lins', ehPropria);
  T('trava fiscal nao muda nada aqui: propria sempre fora, trava ou nao',
    c.nTer === 1 && c.netTerMed === 4500, c);
}

// ---------- 5. a propria carga nao compete contra si mesma ----------
{
  const quotes = [
    { cli: 'JBS - BioPower Lins', net: 9000 },  // a propria carga, mesmo destino
    { cli: 'Cliente A', net: 4000 }
  ];
  const c = core.comparacaoTerceiros(quotes, 'JBS - BioPower Lins', ehPropria);
  T('a propria carga (clienteProprio) nunca conta contra si mesma',
    c.nTer === 1 && c.netTerMed === 4000);
}

// ---------- 6. sem nenhuma oferta elegivel: tudo nulo/zero ----------
{
  T('lista vazia: tudo nulo', JSON.stringify(core.comparacaoTerceiros([], 'X', ehPropria)) ===
    JSON.stringify({ netTer: null, clienteTer: null, netTerMed: null, nTer: 0, netTerMin: null, netTerMax: null }));
  T('so tem propria(s) na lista: tudo nulo', (() => {
    const c = core.comparacaoTerceiros(
      [{ cli: 'Flora GO', net: 5000 }, { cli: 'JBS - BioPower Mafra', net: 6000 }], 'X', ehPropria);
    return c.netTerMed === null && c.nTer === 0 && c.netTer === null;
  })());
  T('so tem a propria carga na lista: tudo nulo', (() => {
    const c = core.comparacaoTerceiros([{ cli: 'JBS - BioPower Lins', net: 5000 }], 'JBS - BioPower Lins', ehPropria);
    return c.netTerMed === null && c.nTer === 0;
  })());
  T('lista undefined nao quebra', core.comparacaoTerceiros(undefined, 'X', ehPropria).nTer === 0);
}

// ---------- 7. recalcularTerceirosSemana(): reconstroi a media a partir do
// pacote guardado (dados.prod + dados.mapa), sem re-rodar a alocacao ----------
{
  const prod = { plants: [{ sigla: 'AAA', uf: 'MT', cidade: 'Cuiaba' }] };
  const mapa = { rows: [
    { i: 0, un: 'Cuiaba', uf: 'MT', cli: 'JBS - BioPower Campo Verde', dst: 'Campo Verde, MT', of: 5000, net: 3000 },
    { i: 1, un: 'Cuiaba', uf: 'MT', cli: 'Cliente A', dst: 'X, MT', of: 5000, net: 5000 },
    { i: 2, un: 'Cuiaba', uf: 'MT', cli: 'Cliente B', dst: 'Y, MT', of: 5000, net: 7000 }
  ] };
  const linhas = [{ id: 101, sigla: 'AAA', cliente: 'JBS - BioPower Campo Verde' }];
  const r = core.recalcularTerceirosSemana({ prod, mapa }, linhas);
  T('recalcularTerceirosSemana devolve uma atualizacao por linha', r.length === 1, r);
  T('media bate com Cliente A (5000) e Cliente B (7000): 6000',
    r[0].id === 101 && r[0].netTerMed === 6000 && r[0].nTer === 2, r[0]);

  T('sem prod/mapa no pacote (semana sem pacote): devolve lista vazia, nao quebra',
    core.recalcularTerceirosSemana({}, linhas).length === 0);
  T('pacote null: devolve lista vazia', core.recalcularTerceirosSemana(null, linhas).length === 0);
}

console.log('\n' + ok + ' OK, ' + bad + ' falhas');
process.exit(bad ? 1 : 0);
