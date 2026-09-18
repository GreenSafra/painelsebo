// Motivo pelo qual uma fabrica propria fica com ZERO no cenario do modelo
// (src/core.js:motivoModeloZero/textoMotivoZero) — antes a tela sempre
// dizia "porque havia terceiro pagando mais", mesmo quando o motivo real
// era outro. Caso real que gerou a correcao (semana 39): BioPower Lins e
// Flora SP com NET IGUAL nas origens ANF/BTG/LIF, as duas acima do melhor
// terceiro; o modelo mandou tudo pra Flora SP e a tela mentiu dizendo
// "terceiro pagando mais". Cobre os quatro motivos do pedido (terceiro com
// NET maior, empate perdido pra outra propria, sem necessidade digitada,
// sem oferta disponivel), mais os casos de fronteira (sem cotacao nenhuma,
// sobra sem disputa), e prova que o desempate de NET igual e deterministico
// (nao depende da ordem das linhas no Mapa).
process.chdir(__dirname);
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8'));

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); };

/* ====================== motivoModeloZero() puro ====================== */

// ---------- modo prioridade: nunca disputa NET, so necessidade/oferta ----------
{
  const m = motivoModeloZero('Flora GO', 'prioridade', 0, [], []);
  T('prioridade, necessidade digitada ZERO: motivo "semNecessidade"', m.tipo === 'semNecessidade', m);
  T('texto: fala em necessidade, nao em terceiro',
    textoMotivoZero(m) === 'porque não foi digitada necessidade para esta fábrica.', textoMotivoZero(m));
}
{
  const m = motivoModeloZero('Flora GO', 'prioridade', 500, [], []);
  T('prioridade, necessidade digitada POSITIVA (mas sem oferta): motivo "semOferta"', m.tipo === 'semOferta', m);
  T('texto: fala em oferta disponivel, nao em necessidade',
    textoMotivoZero(m) === 'porque não havia oferta disponível para essas origens.', textoMotivoZero(m));
}

// ---------- modo mercado: sem cotacao nenhuma pra essa fabrica ----------
{
  const quotes = [{ sigla: 'ANF', cli: 'Outra Fabrica', net: 5000 }];
  const m = motivoModeloZero('Flora GO', 'mercado', 0, quotes, []);
  T('mercado, sem cotacao nenhuma pra esta fabrica: motivo "semCotacao"', m.tipo === 'semCotacao', m);
  T('texto: fala em cotacao no Mapa',
    textoMotivoZero(m) === 'porque não havia cotação desta fábrica no Mapa.', textoMotivoZero(m));
}

// ---------- modo mercado: batida por terceiro com NET maior ----------
{
  const quotes = [{ sigla: 'ANF', cli: 'Flora GO', net: 5000 }];
  const alocOtimo = [{ sigla: 'ANF', cli: 'Cliente Terceiro', net: 5200, ton: 1000, prop: false }];
  const m = motivoModeloZero('Flora GO', 'mercado', 0, quotes, alocOtimo);
  T('mercado, terceiro com NET estritamente maior levou a origem: motivo "terceiro"', m.tipo === 'terceiro', m);
  T('texto do motivo "terceiro" e o classico "terceiro pagando mais"',
    textoMotivoZero(m) === 'porque havia terceiro pagando mais por essas cargas.', textoMotivoZero(m));
}

// ---------- modo mercado: batida por OUTRA PROPRIA com NET maior (sem empate) ----------
{
  const quotes = [{ sigla: 'ANF', cli: 'Flora GO', net: 5000 }];
  const alocOtimo = [{ sigla: 'ANF', cli: 'Flora SP', net: 5300, ton: 1000, prop: true }];
  const m = motivoModeloZero('Flora GO', 'mercado', 0, quotes, alocOtimo);
  T('mercado, outra propria com NET estritamente maior: motivo "propria" (nao "terceiro")',
    m.tipo === 'propria' && m.quem === 'Flora SP', m);
  T('texto nomeia quem tinha o NET maior, sem chamar de terceiro',
    textoMotivoZero(m) === 'porque a oferta de Flora SP tinha NET maior nessas origens.', textoMotivoZero(m));
}

// ---------- caso real (semana 39): empate entre duas proprias, tres origens ----------
{
  const quotesLins = [
    { sigla: 'ANF', cli: 'JBS - BioPower Lins', net: 5669 },
    { sigla: 'BTG', cli: 'JBS - BioPower Lins', net: 5663 },
    { sigla: 'LIF', cli: 'JBS - BioPower Lins', net: 5745 }
  ];
  // o cenario otimo de verdade: Flora SP levou as tres origens (mesmo NET
  // da Lins), o terceiro (5647 nas tres) nunca chegou a levar nada.
  const alocOtimo = [
    { sigla: 'ANF', cli: 'Flora SP', net: 5669, ton: 300, prop: true },
    { sigla: 'BTG', cli: 'Flora SP', net: 5663, ton: 250, prop: true },
    { sigla: 'LIF', cli: 'Flora SP', net: 5745, ton: 400, prop: true }
  ];
  const m = motivoModeloZero('JBS - BioPower Lins', 'mercado', 0, quotesLins, alocOtimo);
  T('caso real: motivo e "empate", nao "terceiro" (a tela mentia isso antes da correcao)',
    m.tipo === 'empate', m);
  T('caso real: nomeia a Flora SP como quem ficou com as cargas', m.quem === 'Flora SP', m);
  T('caso real: texto exatamente como pedido no enunciado',
    textoMotivoZero(m) === 'porque o NET era igual ao de Flora SP, que ficou com as cargas.', textoMotivoZero(m));
}

// ---------- empate tem prioridade sobre "batida por NET maior" quando as
// duas coisas acontecem em origens diferentes da mesma fabrica ----------
{
  const quotes = [
    { sigla: 'AAA', cli: 'Flora GO', net: 5000 }, // batida por terceiro (5200)
    { sigla: 'BBB', cli: 'Flora GO', net: 5100 }  // empatada com Flora SP
  ];
  const alocOtimo = [
    { sigla: 'AAA', cli: 'Cliente Terceiro', net: 5200, ton: 500, prop: false },
    { sigla: 'BBB', cli: 'Flora SP', net: 5100, ton: 500, prop: true }
  ];
  const m = motivoModeloZero('Flora GO', 'mercado', 0, quotes, alocOtimo);
  T('empate numa origem preferido sobre "batida" noutra: motivo continua "empate"',
    m.tipo === 'empate' && m.quem === 'Flora SP', m);
}

// ---------- teve cotacao, ninguem pagou mais nem empatou: sobrou (sem demanda) ----------
{
  const quotes = [{ sigla: 'ANF', cli: 'Flora GO', net: 5000 }];
  const m = motivoModeloZero('Flora GO', 'mercado', 0, quotes, []);
  T('mercado, origem cotada mas ninguem disputou (producao sobrando): motivo "semDemanda"',
    m.tipo === 'semDemanda', m);
}

/* ====================== desempate deterministico (nao arbitrario) ====================== */
// A mesma disputa (Lins x Flora SP x terceiro, NET igual entre as duas
// proprias) resolvida com as linhas do Mapa em ORDEM DIFERENTE tem que dar
// SEMPRE o mesmo vencedor — a ordem das linhas no arquivo nao pode decidir
// quem leva a carga (ver CLAUDE.md).
(() => {
  const prod = { semana: 39, periodo: '21/09 a 27/09', plants: [{ sigla: 'ANF', uf: 'MT', cidade: 'Alta Floresta', ton: 1000 }] };
  const linhaLins = { i: 0, un: 'ANF', uf: 'MT', cli: 'JBS - BioPower Lins', dst: 'X, MT', of: 5669, net: 5669, icms: 0.12, pis: 0.00925, fcli: 0, modal: 'CIF' };
  const linhaFlora = { i: 1, un: 'ANF', uf: 'SP', cli: 'Flora SP', dst: 'Y, SP', of: 5669, net: 5669, icms: 0.12, pis: 0.00925, fcli: 0, modal: 'CIF' };
  const linhaTer = { i: 2, un: 'ANF', uf: 'MT', cli: 'Cliente Terceiro', dst: 'Z, MT', of: 5647, net: 5647, icms: 0.12, pis: 0.00925, fcli: 0, modal: 'CIF' };
  const nec = [{ cliente: 'JBS - BioPower Lins', ton: 0 }, { cliente: 'Flora SP', ton: 0 }];

  const vencedorDe = (ordem) => {
    const mapa = { rows: ordem, data: null, dataSerial: null };
    const ds = montar(prod, nec, mapa);
    const r = resolver(ds, {}, null, 'mercado');
    const linha = r.aloc.find(a => a.sigla === 'ANF' && a.ton > 0.01);
    return linha && linha.cli;
  };

  const vencedorOrdemA = vencedorDe([linhaLins, linhaFlora, linhaTer]);
  const vencedorOrdemB = vencedorDe([linhaFlora, linhaLins, linhaTer]);
  const vencedorOrdemC = vencedorDe([linhaTer, linhaFlora, linhaLins]);
  T('vencedor do empate e o mesmo com a Lins primeiro no Mapa', vencedorOrdemA === 'Flora SP', vencedorOrdemA);
  T('vencedor do empate e o mesmo com a Flora SP primeiro no Mapa', vencedorOrdemB === 'Flora SP', vencedorOrdemB);
  T('vencedor do empate e o mesmo com o terceiro primeiro no Mapa', vencedorOrdemC === 'Flora SP', vencedorOrdemC);
  T('desempate e por ordem alfabetica do cliente (Flora SP antes de JBS - BioPower Lins)',
    'Flora SP'.localeCompare('JBS - BioPower Lins') < 0);

  // a mesma disputa, resolvida pelo caminho de producao (motivoModeloZero
  // usando o resultado de verdade do resolver()) tem que achar "empate"
  // pra Lins nos tres casos.
  const dsA = montar(prod, nec, { rows: [linhaLins, linhaFlora, linhaTer], data: null, dataSerial: null });
  const rA = resolver(dsA, {}, null, 'mercado');
  const quotesLins = dsA.quotes.filter(q => q.cli === 'JBS - BioPower Lins');
  const motivo = motivoModeloZero('JBS - BioPower Lins', 'mercado', 0, dsA.quotes, rA.aloc);
  T('motivoModeloZero() sobre o resultado real do resolver(): "empate" com Flora SP',
    motivo.tipo === 'empate' && motivo.quem === 'Flora SP', motivo);
})();

console.log('\n' + ok + ' OK, ' + bad + ' falhas');
process.exit(bad ? 1 : 0);
