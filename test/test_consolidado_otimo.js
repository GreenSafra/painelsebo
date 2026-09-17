// Regressao: o volume por fabrica propria que a tela mostra (ton_otimo,
// devolvido por agregarSemana() em core.js — a mesma conta que a CTE
// "dados" de db.js:consolidado() replica em SQL) tem que ser EXATAMENTE a
// soma das toneladas das linhas do cenario otimo com aquele cliente e
// proprio=true. Nasceu de uma investigacao onde a tela mostrava "o modelo
// mandaria 735 t" pra Flora GO numa semana cujo banco tinha ZERO linhas
// proprias no cenario otimo (as 126 linhas, 5.775 t, eram todas de
// terceiro). Reproduzindo esse exato padrao aqui, agregarSemana() devolve
// ton_otimo=0 pra Flora GO — bate com o banco, nao com o "735 t" visto na
// tela (a causa mais provavel: modo Mes soma VARIAS semanas fechadas, e o
// numero visto era do mes inteiro, nao so desta semana — nao um bug nesta
// conta). Esta bateria trava que a conta continua batendo com o banco.
process.chdir(__dirname);
const core = require('../src/core.js');
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); };

// Soma "como se fosse a consulta no banco": toneladas das linhas com este
// cliente e proprio=true, no cenario passado.
function somaBanco(linhas, cliente) {
  return linhas.filter(l => l.cliente === cliente && l.proprio)
    .reduce((s, l) => s + l.toneladas, 0);
}

function linhaFake(cliente, proprio, toneladas, extra) {
  return Object.assign({ cliente, proprio, toneladas, net: 5000,
    netTerMed: proprio ? 5100 : null, netTer: proprio ? 5200 : null, nTer: proprio ? 3 : 0 }, extra);
}

// ---------- 1. reproduz o padrao exato investigado: otimo 100% terceiro ----------
{
  const linhasOtimo = [];
  for (let i = 0; i < 126; i++) linhasOtimo.push(linhaFake('Minerva Foods Biodiesel', false, 5775 / 126));
  const linhasRealizado = [];
  for (let i = 0; i < 53; i++) linhasRealizado.push(linhaFake('Flora GO', true, 3045 / 53));
  for (let i = 0; i < 73; i++) linhasRealizado.push(linhaFake('Be8', false, 2730 / 73));

  const ag = core.agregarSemana(linhasRealizado, linhasOtimo, []);
  const florago = ag.porPropria.find(p => p.cliente === 'Flora GO');

  T('banco: cenario otimo nao tem NENHUMA linha propria pra Flora GO',
    somaBanco(linhasOtimo, 'Flora GO') === 0);
  T('tela (ton_otimo) bate com o banco: 0 t, nao 735 t',
    florago.ton_otimo === somaBanco(linhasOtimo, 'Flora GO'), florago.ton_otimo);
  T('net_ter_otimo/saving_otimo tambem ficam nulos (nao ha carga pra comparar)',
    florago.net_ter_otimo == null && florago.saving_otimo == null);
  T('ton_realizado bate com a soma das linhas proprias do realizado (3.045 t)',
    Math.abs(florago.ton_realizado - somaBanco(linhasRealizado, 'Flora GO')) < 0.01,
    florago.ton_realizado);
}

// ---------- 2. caso normal: otimo tem carga propria de verdade — ton_otimo
// bate com a soma exata, nem a mais nem a menos ----------
{
  const linhasOtimo = [
    linhaFake('Flora GO', true, 400),
    linhaFake('Flora GO', true, 335),
    linhaFake('Minerva Foods Biodiesel', false, 5040)
  ];
  const linhasRealizado = [linhaFake('Flora GO', true, 300)];
  const ag = core.agregarSemana(linhasRealizado, linhasOtimo, []);
  const florago = ag.porPropria.find(p => p.cliente === 'Flora GO');
  T('caso normal: ton_otimo bate exatamente com a soma das linhas proprias do banco (735 t)',
    florago.ton_otimo === somaBanco(linhasOtimo, 'Flora GO') && florago.ton_otimo === 735,
    florago.ton_otimo);
}

// ---------- 3. varias fabricas proprias ao mesmo tempo — cada uma bate com
// a sua propria soma, sem vazar volume de uma pra outra ----------
{
  const linhasOtimo = [
    linhaFake('Flora GO', true, 200),
    linhaFake('JBS - BioPower Lins', true, 150),
    linhaFake('Cliente Terceiro', false, 1000)
  ];
  const linhasRealizado = [];
  const ag = core.agregarSemana(linhasRealizado, linhasOtimo, []);
  ['Flora GO', 'JBS - BioPower Lins'].forEach(cliente => {
    const p = ag.porPropria.find(x => x.cliente === cliente);
    T('ton_otimo de ' + cliente + ' bate com a soma so das linhas dele',
      p.ton_otimo === somaBanco(linhasOtimo, cliente), cliente + ':' + p.ton_otimo);
  });
  const flora = ag.porPropria.find(p => p.cliente === 'Flora GO');
  T('Flora GO nao herda volume do BioPower Lins nem do terceiro', flora.ton_otimo === 200, flora.ton_otimo);
}

// ---------- 4. o mesmo vale pro cenario realizado (regressao simetrica) ----------
{
  const linhasRealizado = [linhaFake('Flora SP', true, 70), linhaFake('Flora SP', true, 35)];
  const ag = core.agregarSemana(linhasRealizado, [], []);
  const florasp = ag.porPropria.find(p => p.cliente === 'Flora SP');
  T('ton_realizado tambem bate exatamente com a soma das linhas do banco (105 t)',
    florasp.ton_realizado === somaBanco(linhasRealizado, 'Flora SP') && florasp.ton_realizado === 105,
    florasp.ton_realizado);
}

console.log('\n' + ok + ' OK, ' + bad + ' falhas');
process.exit(bad ? 1 : 0);
