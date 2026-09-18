// db.js: fecharSemana() grava o modo (prioridade/mercado) e a necessidade
// digitada por fabrica propria junto com a semana, e consolidado() devolve
// as duas colunas pra tela explicar POR QUE o modelo mandou zero pra uma
// fabrica ("sem necessidade digitada" e "sem oferta disponivel" sao coisas
// diferentes — ver public/consolidado.html:render()). Testa db.js de
// verdade (nao uma reimplementacao): so a camada de SQL e simulada em
// memoria (pool falso com connect() pra transacao de fecharSemana), o resto
// e o codigo real. A sintaxe SQL em si fica por revisao de codigo, sem
// Postgres local, mesmo padrao das levas anteriores.
process.chdir(__dirname);
const db = require('../db.js');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); };

// ---------- cliente de transacao falso: so registra toda query+params e
// devolve o minimo que fecharSemana() precisa pra seguir em frente ----------
function clienteFalso() {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, params) {
      chamadas.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: params || [] });
      if (/SELECT coalesce\(max\(versao\),0\)/.test(sql)) return { rows: [{ v: 1 }] };
      if (/INSERT INTO semanas/.test(sql)) return { rows: [{ id: 900, versao: 1 }] };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
}

async function fecharComPoolFalso(cab) {
  const cli = clienteFalso();
  const poolOriginal = db.pool.connect;
  db.pool.connect = async () => cli;
  try {
    const linhas = [{ toneladas: 35, sigla: 'SEN', cliente: 'Flora GO', proprio: true, destino: 'X' }];
    await db.fecharSemana(cab, linhas, 1, null);
  } finally {
    db.pool.connect = poolOriginal;
  }
  return cli.chamadas.find(c => /INSERT INTO semanas/.test(c.sql));
}

(async () => {
  // ---------- modo e necessidades vao pro INSERT, serializados certo ----------
  {
    const insert = await fecharComPoolFalso({
      ano: 2026, semana: 38, periodo: '14/09 a 20/09', mapaData: '10/09/2026',
      modo: 'mercado', necessidades: { 'Flora GO': 0, 'JBS - BioPower Lins': 1015 }
    });
    T('INSERT INTO semanas foi chamado', !!insert);
    if (insert) {
      T('coluna modo esta na lista de colunas do INSERT', /\bmodo\b/.test(insert.sql), insert.sql);
      T('coluna necessidades esta na lista de colunas do INSERT', /\bnecessidades\b/.test(insert.sql), insert.sql);
      T('modo="mercado" foi pro parametro certo', insert.params.includes('mercado'), insert.params);
      const necParam = insert.params.find(p => typeof p === 'string' && p.indexOf('Flora GO') >= 0);
      T('necessidades foi serializada como JSON com os clientes certos',
        !!necParam && JSON.parse(necParam)['Flora GO'] === 0 && JSON.parse(necParam)['JBS - BioPower Lins'] === 1015,
        necParam);
    }
  }

  // ---------- modo invalido (nunca deveria acontecer, mas nao pode gravar
  // lixo) vira NULL, nao o texto cru ----------
  {
    const insert = await fecharComPoolFalso({
      ano: 2026, semana: 38, modo: 'qualquer-coisa', necessidades: null
    });
    T('modo fora de "prioridade"/"mercado" vira NULL no parametro',
      !!insert && insert.params.includes(null), insert && insert.params);
    T('modo invalido nao aparece literalmente no parametro',
      !!insert && !insert.params.includes('qualquer-coisa'), insert && insert.params);
  }

  // ---------- sem modo/necessidades (chamada antiga, ou algo faltando) nao
  // quebra: os dois viram NULL ----------
  {
    const insert = await fecharComPoolFalso({ ano: 2026, semana: 38 });
    T('sem cab.modo/cab.necessidades: fecha a semana sem quebrar, os dois ficam NULL',
      !!insert, insert);
  }

  // ---------- consolidado(): a query de semanasFechadas pede modo e
  // necessidades junto (sem elas a tela nao tem como explicar o motivo) ----------
  {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'db.js'), 'utf8');
    const bloco = src.slice(src.indexOf('const semanasFechadas = await pool.query('));
    const trechoQuery = bloco.slice(0, bloco.indexOf('f.params);') + 10);
    T('query de semanasFechadas seleciona s.modo', /s\.modo\b/.test(trechoQuery), trechoQuery);
    T('query de semanasFechadas seleciona s.necessidades', /s\.necessidades\b/.test(trechoQuery), trechoQuery);
  }

  // ---------- preencherMotivosZeroOtimo(): reconstroi o motivo (empate,
  // nesse caso — o bug real da semana 39, ver test_motivo_modelo.js) a
  // partir do pacote guardado (prod+mapa) e das linhas cruas do cenario
  // otimo, e escreve motivo_zero_otimo em cada linha de porPropria com
  // ton_otimo=0. Pool falso: so as duas consultas que a funcao realmente
  // faz (a sintaxe SQL em si fica por revisao de codigo, mesmo padrao das
  // levas anteriores). ----------
  {
    const dadosPacote = JSON.stringify({
      prod: { semana: 39, periodo: '21/09 a 27/09', plants: [{ sigla: 'ANF', uf: 'MT', cidade: 'Alta Floresta', ton: 1000 }] },
      mapa: { rows: [
        { i: 0, un: 'ANF', uf: 'MT', cli: 'JBS - BioPower Lins', dst: 'X, MT', of: 5669, net: 5669, icms: 0.12, pis: 0.00925, fcli: 0, modal: 'CIF' },
        { i: 1, un: 'ANF', uf: 'SP', cli: 'Flora SP', dst: 'Y, SP', of: 5669, net: 5669, icms: 0.12, pis: 0.00925, fcli: 0, modal: 'CIF' },
        { i: 2, un: 'ANF', uf: 'MT', cli: 'Cliente Terceiro', dst: 'Z, MT', of: 5647, net: 5647, icms: 0.12, pis: 0.00925, fcli: 0, modal: 'CIF' }
      ] }
    });
    const chamadas = [];
    const poolOriginal = db.pool.query;
    db.pool.query = async (sql, params) => {
      chamadas.push(sql.replace(/\s+/g, ' ').trim());
      if (/SELECT id, dados, modo, necessidades FROM semanas/.test(sql)) {
        return { rows: [{ id: 900, dados: dadosPacote, modo: 'mercado', necessidades: {} }] };
      }
      if (/SELECT sigla, cliente, net, toneladas, proprio FROM alocacoes/.test(sql)) {
        return { rows: [
          { sigla: 'ANF', cliente: 'Flora SP', net: '5669.00', toneladas: '1000.000', proprio: true }
        ] };
      }
      return { rows: [] };
    };
    let porPropriaRows;
    try {
      porPropriaRows = [
        { cliente: 'JBS - BioPower Lins', ton_otimo: 0 },
        { cliente: 'Flora SP', ton_otimo: 1000 } // ja recebeu, nunca entra no filtro de zeradas
      ];
      await db.preencherMotivosZeroOtimo(2026, 39, porPropriaRows);
    } finally {
      db.pool.query = poolOriginal;
    }
    const lins = porPropriaRows.find(p => p.cliente === 'JBS - BioPower Lins');
    const florasp = porPropriaRows.find(p => p.cliente === 'Flora SP');
    T('so consultou o banco (dados+alocacoes) pra quem realmente tem ton_otimo=0',
      chamadas.length === 2, chamadas);
    T('motivo_zero_otimo da Lins e o empate com a Flora SP (o bug real da semana 39)',
      lins.motivo_zero_otimo === 'porque o NET era igual ao de Flora SP, que ficou com as cargas.',
      lins.motivo_zero_otimo);
    T('Flora SP (ton_otimo>0) nao ganha motivo_zero_otimo nenhum', florasp.motivo_zero_otimo === undefined);
  }

  // ---------- sem pacote guardado: nao arrisca motivo nenhum ----------
  {
    const poolOriginal = db.pool.query;
    db.pool.query = async (sql) => {
      if (/SELECT id, dados, modo, necessidades FROM semanas/.test(sql)) {
        return { rows: [{ id: 901, dados: null, modo: 'mercado', necessidades: null }] };
      }
      return { rows: [] };
    };
    let porPropriaRows;
    try {
      porPropriaRows = [{ cliente: 'JBS - BioPower Lins', ton_otimo: 0 }];
      await db.preencherMotivosZeroOtimo(2026, 39, porPropriaRows);
    } finally {
      db.pool.query = poolOriginal;
    }
    T('semana sem pacote guardado: motivo_zero_otimo fica ausente, sem arriscar',
      porPropriaRows[0].motivo_zero_otimo === undefined);
  }

  // ---------- sem nenhuma fabrica com ton_otimo=0: nem consulta o banco ----------
  {
    const chamadas = [];
    const poolOriginal = db.pool.query;
    db.pool.query = async (sql) => { chamadas.push(sql); return { rows: [] }; };
    try {
      await db.preencherMotivosZeroOtimo(2026, 39, [{ cliente: 'Flora SP', ton_otimo: 1000 }]);
    } finally {
      db.pool.query = poolOriginal;
    }
    T('nenhuma linha zerada: preencherMotivosZeroOtimo nao consulta o banco a toa', chamadas.length === 0);
  }

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
