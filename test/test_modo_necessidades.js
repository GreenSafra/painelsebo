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

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
