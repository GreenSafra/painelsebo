// Segunda melhor oferta na Exportar programacao (src/core.js:
// melhoresAlternativas(), usada por programacaoPreenchida() pras colunas
// "2º melhor"/CD.net2,cli2 (ja existia) e "segunda melhor"/CD.net3,cli3
// (nova). Mesmos filtros de sempre pra achar uma alternativa: mesma sigla
// (o pool ja vem filtrado por opcoes()), fora o cliente da propria carga,
// e nunca uma fabrica propria contando como oferta de terceiro. Cobre:
// carga com varias ofertas (melhor e segunda corretas, por NET), carga com
// uma so oferta elegivel (segunda fica vazia), cliente repetido no pool
// contando uma vez, e uma fabrica propria no pool nunca sendo escolhida.
process.chdir(__dirname);
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8'));

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); };

const q = (cli, net, extra) => Object.assign({ sigla: 'ANF', cli, net, uf: 'MT' }, extra);

// ---------- item 1: varias ofertas, melhor e segunda corretas (por NET) ----------
{
  const lista = [q('Cliente A', 5000), q('Cliente B', 5300), q('Cliente C', 4800), q('Cliente D', 5100)];
  const [m, s] = melhoresAlternativas(lista, 'Destino Escolhido');
  T('melhor e a de maior NET entre as elegiveis (Cliente B, 5300)', !!m && m.cli === 'Cliente B' && m.net === 5300, m);
  T('segunda e a proxima maior (Cliente D, 5100)', !!s && s.cli === 'Cliente D' && s.net === 5100, s);
}

// ---------- item 2: carga com uma so oferta elegivel: segunda fica vazia ----------
{
  const lista = [q('Cliente Unico', 5200)];
  const [m, s] = melhoresAlternativas(lista, 'Destino Escolhido');
  T('com uma so oferta: melhor e ela', !!m && m.cli === 'Cliente Unico', m);
  T('sem segunda oferta elegivel: fica null, nao inventa valor', s === null, s);
}
{
  const [m, s] = melhoresAlternativas([], 'Destino Escolhido');
  T('sem nenhuma oferta: melhor e segunda ficam null', m === null && s === null, { m, s });
}

// ---------- exclui o destino da propria carga (mesmo cliente que recebeu) ----------
{
  const lista = [q('Destino Escolhido', 9999), q('Cliente B', 5300), q('Cliente C', 4800)];
  const [m, s] = melhoresAlternativas(lista, 'Destino Escolhido');
  T('o proprio destino (mesmo NET altissimo) nunca vira "alternativa" dele mesmo',
    !!m && m.cli === 'Cliente B', m);
  T('segunda tambem nunca e o proprio destino', !!s && s.cli === 'Cliente C', s);
}

// ---------- exclui fabrica propria do pool (nunca conta como oferta de terceiro) ----------
{
  const lista = [
    q('JBS - BioPower Lins', 6000, { prop: true }), // maior NET de todos, mas e propria
    q('Cliente Terceiro X', 5300),
    q('Flora SP', 5900, { prop: true }),            // tambem propria, tambem maior que o terceiro
    q('Cliente Terceiro Y', 4800)
  ];
  const [m, s] = melhoresAlternativas(lista, 'Destino Escolhido');
  T('melhor ignora as duas proprias (mesmo tendo NET maior) e pega o terceiro de verdade',
    !!m && m.cli === 'Cliente Terceiro X', m);
  T('segunda tambem ignora propria', !!s && s.cli === 'Cliente Terceiro Y', s);
  T('nem melhor nem segunda sao fabrica propria',
    !m.prop && !s.prop);
}

// ---------- item 3: cliente repetido no pool conta uma vez (fica com a
// melhor oferta dele, nao duplica como melhor E segunda) ----------
{
  const lista = [
    q('Cliente Repetido', 5000),
    q('Cliente Repetido', 5400), // mesma origem, oferta melhor pro mesmo cliente
    q('Cliente Unico B', 4900)
  ];
  const [m, s] = melhoresAlternativas(lista, 'Destino Escolhido');
  T('cliente repetido conta uma vez, com a MELHOR oferta dele (5400, nao 5000)',
    !!m && m.cli === 'Cliente Repetido' && m.net === 5400, m);
  T('segunda nao repete o mesmo cliente (o repetido ja virou o "melhor")',
    !!s && s.cli === 'Cliente Unico B', s);
}

console.log('\n' + ok + ' OK, ' + bad + ' falhas');
process.exit(bad ? 1 : 0);
