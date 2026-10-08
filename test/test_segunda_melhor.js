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

// ---------- grupo JBS: JBS (BioPower) e Flora nao concorrem entre si ----------
// Cenarios do pedido de correcao. As proprias vem SEM a flag prop de
// proposito: e o caso da Flora/BioPower retirada de "Destinos da semana",
// que antes passava a contar como terceiro (BioPower com 2º melhor = Flora SP).
{
  const T3 = (nome, lista, destino, cli, net) => {
    const [m, s] = melhoresAlternativas(lista, destino);
    T(nome, !!m && m.cli === cli && m.net === net, m);
    return [m, s];
  };
  T3('A: JBS 5500, Flora 5450, Terceiro A 5400 -> Terceiro A 5400',
    [q('JBS - BioPower Lins', 5500), q('Flora SP', 5450), q('Terceiro A', 5400)],
    'JBS - BioPower Lins', 'Terceiro A', 5400);
  T3('B: Flora 5500, JBS 5450, Terceiro A 5400 -> Terceiro A 5400',
    [q('Flora SP', 5500), q('JBS - BioPower Lins', 5450), q('Terceiro A', 5400)],
    'Flora SP', 'Terceiro A', 5400);
  T3('C: JBS 5500, Terceiro A 5450, Flora 5400 -> Terceiro A 5450',
    [q('JBS - BioPower Campo Verde', 5500), q('Terceiro A', 5450), q('Flora GO', 5400)],
    'JBS - BioPower Campo Verde', 'Terceiro A', 5450);
  // D: carga de terceiro — mesma metodologia de antes (proprias fora, o
  // proprio destino fora, ordem por NET); outro terceiro continua valendo
  const [mD, sD] = T3('D: carga de terceiro -> melhor outro terceiro, sem exclusao indevida',
    [q('Flora SP', 5600), q('Terceiro A', 5500), q('Terceiro B', 5450), q('Terceiro C', 5300)],
    'Terceiro A', 'Terceiro B', 5450);
  T('D: segunda e o terceiro seguinte (Terceiro C)', !!sD && sD.cli === 'Terceiro C', sD);
  // terceiro acrescentado na lista de destinos vem com prop=true, mas nao e
  // do grupo: continua sendo alternativa
  T3('terceiro acrescentado (prop=true na lista) continua elegivel',
    [q('JBS - BioPower Lins', 5500), q('Terceiro Acrescentado', 5300, { prop: true })],
    'JBS - BioPower Lins', 'Terceiro Acrescentado', 5300);
  const [mE, sE] = melhoresAlternativas(
    [q('JBS - BioPower Lins', 5500), q('Flora SP', 5450), q('Flora GO', 5400)], 'JBS - BioPower Lins');
  T('E: sem terceiro elegivel -> Q/R vazias (null), nada inventado', mE === null && sE === null, { mE, sE });
  T('grupo: BioPower, Flora e nome com "JBS" sao do grupo',
    ehGrupoJBS('JBS - BioPower Mafra') && ehGrupoJBS('Flora SP') && ehGrupoJBS('Flora GO') &&
    ehGrupoJBS('JBS S/A'), null);
  T('grupo: nomes parecidos de terceiros nao sao confundidos',
    !ehGrupoJBS('JBSX Comercio') && !ehGrupoJBS('Oleoplan RO') && !ehGrupoJBS('Minerva Foods Biodiesel'), null);
}

// ---------- ponta a ponta: exportacao real (colunas Q/R e "segunda melhor") ----------
(async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'),
    { runScripts: 'dangerously', url: 'https://x/' });
  const w = dom.window;
  w.DecompressionStream = DecompressionStream; w.CompressionStream = CompressionStream;
  w.Response = Response; w.Blob = Blob; w.XMLSerializer = dom.window.XMLSerializer;
  w.HTMLElement.prototype.scrollIntoView = function () {}; w.Element.prototype.scrollIntoView = function () {};
  w.btoa = s => Buffer.from(s, 'binary').toString('base64');
  w.atob = s => Buffer.from(s, 'base64').toString('binary');
  const fake = (n, p) => { const b = fs.readFileSync(p); return { name: n, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const ler = async buf => w.readXlsx({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  await new Promise(r => setTimeout(r, 60));
  await w.receber('prog', fake('prog.xlsx', 'in/prog4.xlsx'));
  await w.receber('mapa', fake('mapa.xlsx', 'in/mapa2.xlsx'));
  await new Promise(r => setTimeout(r, 120));
  // mercado livre e TODAS as proprias fora de "Destinos da semana": cada uma
  // vira prop=false no ranking — o caso que gerava "2º melhor = Flora SP"
  w.ST.modo = 'mercado';
  w.ST.fora = w.NEC.map(n => n.cliente);
  w.rodar(); await new Promise(r => setTimeout(r, 80));
  T('cenario de risco montado: alguma propria no ranking sem a flag prop',
    Object.values(w.OPS).some(l => l.some(o => w.ehGrupoJBS(o.cli) && !o.prop)));
  const r = await w.programacaoPreenchida(w.PROGBUF, w.PROD, w.RES.alocFinal, w.OPS, w.MAPA.data, w.MAPA.dataSerial);
  const buf = Buffer.from(await r.arquivo.arrayBuffer());
  const rows = (await ler(buf))['Programação'];
  const orig = (await ler(fs.readFileSync('in/prog4.xlsx')))['Programação'];
  T('cabecalho identico ao do modelo (Q e R presentes, mesmo texto)',
    JSON.stringify(rows[0]) === JSON.stringify(orig[0]) &&
    /2º melhor oferta/.test(rows[0][16]) && /2º melhor Cliente/.test(rows[0][17]), rows[0][16] + ' / ' + rows[0][17]);
  const CD = w.PROD.colDest;
  const ix = L => L.charCodeAt(0) - 65;
  T('colunas Q/R sao as de 2º melhor (CD.net2/cli2)', CD.net2 === 'Q' && CD.cli2 === 'R', CD.net2 + '/' + CD.cli2);
  const dados = rows.slice(1).filter(x => x[ix(CD.cli)]);
  const comQ = dados.filter(x => x[ix(CD.cli2)]);
  T('exportacao gerou linhas com 2º melhor', comQ.length > 0, comQ.length + ' de ' + dados.length);
  T('nenhum 2º melhor (R) e do grupo JBS/Flora', comQ.every(x => !w.ehGrupoJBS(x[ix(CD.cli2)])),
    comQ.map(x => x[ix(CD.cli2)]).filter(w.ehGrupoJBS).join(', '));
  const cargasGrupo = comQ.filter(x => w.ehGrupoJBS(x[ix(CD.cli)]));
  T('ha cargas do grupo com 2º melhor terceiro (o teste prova algo)', cargasGrupo.length > 0, cargasGrupo.length);
  // G: valor e nome sao da MESMA oferta (NET do cliente R no Mapa = Q)
  const netDe = (sigla, cli) => { const o = (w.OPS[sigla] || []).find(o => o.cli === cli); return o ? o.net : null; };
  const siglaDe = {}; w.RES.alocFinal.forEach(a => (siglaDe[a.cli] = siglaDe[a.cli] || new Set()).add(a.sigla));
  const consist = comQ.every(x => {
    const q2 = x[ix(CD.net2)], c2 = x[ix(CD.cli2)];
    return typeof q2 === 'number' && [...(siglaDe[x[ix(CD.cli)]] || [])].some(sg => Math.abs((netDe(sg, c2) || -1) - q2) < 1e-6);
  });
  T('G: Q (NET) e R (nome) sempre da mesma oferta', consist);
  T('G: linha sem nome em R tambem sem valor em Q',
    dados.every(x => !!x[ix(CD.cli2)] === (x[ix(CD.net2)] !== '' && x[ix(CD.net2)] != null)));
  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('  FALHA erro: ' + e.stack); process.exit(1); });
