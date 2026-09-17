// db.js: corrigirFlagPropria() + migrarNetTerMedio() — reproduz em memoria
// (pool falso) o bug real encontrado em producao na semana 38 (v8): o
// cenario "otimo" inteiro gravado com proprio=false, inclusive em cargas
// pra fabrica propria de verdade, enquanto "realizado" estava certo. Sem a
// flag certa a carga nunca entra na agregacao (core.js/db.js so somam onde
// proprio e verdadeiro), entao fica sem media de terceiros e sem ganho.
// Testa db.js de verdade (nao uma reimplementacao) — so a camada de SQL e
// simulada em memoria, o resto (a logica de quais linhas mexer, a
// comparacao antes de gravar) e o codigo real de db.js. A parte de SQL em
// si (a sintaxe de "~*", o EXISTS) fica por revisao de codigo, sem
// Postgres local, mesmo padrao das levas anteriores.
process.chdir(__dirname);
const db = require('../db.js');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); };

// ---------- banco falso em memoria, so o suficiente pras consultas que
// corrigirFlagPropria()/migrarNetTerMedio() realmente fazem ----------
function montarBancoFalso() {
  const dadosPacote = JSON.stringify({
    prod: { plants: [{ sigla: 'SEN', uf: 'GO', cidade: 'Senador Canedo' }] },
    mapa: { rows: [
      { i: 0, un: 'Senador Canedo', uf: 'GO', cli: 'Flora GO', dst: 'X, GO', of: 5000, net: 5000 },
      { i: 1, un: 'Senador Canedo', uf: 'GO', cli: 'Cliente Terceiro A', dst: 'Y, GO', of: 5200, net: 5200 },
      { i: 2, un: 'Senador Canedo', uf: 'GO', cli: 'Cliente Terceiro B', dst: 'Z, GO', of: 4800, net: 4800 }
    ] }
  });
  const semanas = [{ id: 38, atual: true, dados: dadosPacote }];
  const alocacoes = [
    // realizado: ja migrado certo antes (situacao real da semana 38 —
    // "3.045 t de 5.775 t" com media, o resto legitimamente sem terceiro)
    { id: 1, semana_id: 38, cenario: 'realizado', proprio: true, cliente: 'Flora GO', sigla: 'SEN',
      toneladas: 35, net: 4900, net_ter: 5200, net_ter_med: 5000, n_ter: 2 },
    // otimo: O BUG — mesma carga (mesma sigla, mesmo cliente propria de
    // verdade), mas proprio gravado FALSO e net_ter_med nunca calculado.
    { id: 2, semana_id: 38, cenario: 'otimo', proprio: false, cliente: 'Flora GO', sigla: 'SEN',
      toneladas: 35, net: 4950, net_ter: null, net_ter_med: null, n_ter: null },
    // terceiro de verdade no otimo — tem que CONTINUAR proprio=false.
    { id: 3, semana_id: 38, cenario: 'otimo', proprio: false, cliente: 'Cliente Terceiro A', sigla: 'SEN',
      toneladas: 35, net: 5200, net_ter: null, net_ter_med: null, n_ter: null }
  ];
  return { semanas, alocacoes };
}

function poolFalso(banco) {
  const ehPropria = c => /biopower|flora/i.test(String(c || ''));
  return {
    chamadas: [],
    async query(sql, params) {
      params = params || [];
      this.chamadas.push(sql.replace(/\s+/g, ' ').trim().slice(0, 60));
      if (/UPDATE alocacoes SET proprio/.test(sql)) {
        let n = 0;
        banco.alocacoes.forEach(a => {
          const certo = ehPropria(a.cliente);
          if (a.proprio !== certo) { a.proprio = certo; n++; }
        });
        return { rowCount: n, rows: [] };
      }
      if (/SELECT s\.id, s\.dados FROM semanas s/.test(sql)) {
        const rows = banco.semanas.filter(s => s.atual && s.dados != null &&
          banco.alocacoes.some(a => a.semana_id === s.id && a.proprio && a.net_ter_med == null));
        return { rows: rows.map(s => ({ id: s.id, dados: s.dados })) };
      }
      if (/FROM alocacoes WHERE semana_id=\$1 AND proprio/.test(sql)) {
        const rows = banco.alocacoes.filter(a => a.semana_id === params[0] && a.proprio);
        return { rows: rows.map(a => ({ id: a.id, sigla: a.sigla, cliente: a.cliente,
          net_ter_med: a.net_ter_med, n_ter: a.n_ter })) };
      }
      if (/UPDATE alocacoes SET net_ter_med=\$1, n_ter=\$2 WHERE id=\$3/.test(sql)) {
        const a = banco.alocacoes.find(x => x.id === params[2]);
        if (a) { a.net_ter_med = params[0]; a.n_ter = params[1]; }
        return { rows: [] };
      }
      throw new Error('query nao esperada no mock: ' + sql.slice(0, 100));
    }
  };
}

(async () => {
  const banco = montarBancoFalso();
  const pool = poolFalso(banco);
  db.pool.query = pool.query.bind(pool);

  T('antes de corrigir: carga propria do otimo esta com proprio=false (o bug)',
    banco.alocacoes.find(a => a.id === 2).proprio === false);

  const corrigidas = await db.corrigirFlagPropria();
  T('corrigirFlagPropria() reporta 1 linha corrigida (so a linha 2 estava errada)', corrigidas === 1, corrigidas);
  T('depois de corrigir: carga propria do otimo vira proprio=true',
    banco.alocacoes.find(a => a.id === 2).proprio === true);
  T('carga de terceiro do otimo continua proprio=false (nao virou propria por engano)',
    banco.alocacoes.find(a => a.id === 3).proprio === false);
  T('carga do realizado, que ja estava certa, nao muda', banco.alocacoes.find(a => a.id === 1).proprio === true);

  const linhasAtualizadas = await db.migrarNetTerMedio();
  T('migrarNetTerMedio() atualiza a carga do otimo recem-corrigida', linhasAtualizadas >= 1, linhasAtualizadas);

  const otimoAgora = banco.alocacoes.find(a => a.id === 2);
  T('carga propria do otimo agora tem net_ter_med preenchido', otimoAgora.net_ter_med != null, otimoAgora.net_ter_med);
  T('media bate com a conta esperada (media entre os 2 terceiros: 5200 e 4800 = 5000)',
    Math.abs(otimoAgora.net_ter_med - 5000) < 0.01, otimoAgora.net_ter_med);
  T('n_ter da carga do otimo bate (2 ofertas de terceiro)', otimoAgora.n_ter === 2, otimoAgora.n_ter);

  const terceiroAgora = banco.alocacoes.find(a => a.id === 3);
  T('carga de terceiro nao ganhou net_ter_med (a media e so pra carga propria)',
    terceiroAgora.net_ter_med == null);

  // ---------- idempotencia: rodar de novo nao muda nada (nem reescreve a toa) ----------
  const chamadasAntes = pool.chamadas.length;
  const corrigidas2 = await db.corrigirFlagPropria();
  const linhasAtualizadas2 = await db.migrarNetTerMedio();
  T('rodar de novo: corrigirFlagPropria() nao acha mais nada pra corrigir', corrigidas2 === 0, corrigidas2);
  T('rodar de novo: migrarNetTerMedio() nao reescreve nada (ja bate com o recalculo)',
    linhasAtualizadas2 === 0, linhasAtualizadas2);
  T('nenhuma chamada nova ao "banco" tenta gravar de novo (so leituras a mais, sem novo UPDATE)',
    pool.chamadas.length > chamadasAntes);

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
