// Camada de banco: schema, usuarios e sessoes.

const { Pool } = require('pg');
const crypto = require('crypto');

const MASTER = (process.env.EMAIL_MASTER || 'rbglins@gmail.com').toLowerCase();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

// ---------- senhas ----------
// scrypt do proprio Node. Sem dependencia nativa, sem problema de build.

function criarHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const dado = crypto.scryptSync(senha, sal, 64).toString('hex');
  return sal + ':' + dado;
}

function conferirSenha(senha, hash) {
  if (!hash || !hash.includes(':')) return false;
  const [sal, dado] = hash.split(':');
  const teste = crypto.scryptSync(senha, sal, 64);
  const guardado = Buffer.from(dado, 'hex');
  if (teste.length !== guardado.length) return false;
  return crypto.timingSafeEqual(teste, guardado);
}

// ---------- schema ----------

async function iniciar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id          SERIAL PRIMARY KEY,
      nome        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      senha_hash  TEXT NOT NULL,
      papel       TEXT NOT NULL DEFAULT 'usuario',
      situacao    TEXT NOT NULL DEFAULT 'pendente',
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
      decidido_em TIMESTAMPTZ,
      decidido_por INTEGER
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessoes (
      token      TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
      expira_em  TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS ix_sessoes_expira ON sessoes(expira_em)`);

  // Uma linha por semana fechada. Reabrir e fechar de novo cria uma versao
  // nova em vez de sobrescrever: o historico do que foi decidido na epoca
  // nao se perde. So a versao com atual=true entra no consolidado.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS semanas (
      id         SERIAL PRIMARY KEY,
      ano        INTEGER NOT NULL,
      semana     INTEGER NOT NULL,
      periodo    TEXT,
      versao     INTEGER NOT NULL DEFAULT 1,
      atual      BOOLEAN NOT NULL DEFAULT true,
      mapa_data  TEXT,
      fechada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      usuario_id INTEGER REFERENCES usuarios(id),
      UNIQUE (ano, semana, versao)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ix_semanas_atual ON semanas(ano, semana) WHERE atual`
  );

  // Uma linha por carga alocada. data_embarque e o que define o mes no
  // consolidado — uma semana pode atravessar a virada do mes, entao apurar
  // pela semana inteira jogaria volume no mes errado.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alocacoes (
      id            SERIAL PRIMARY KEY,
      semana_id     INTEGER NOT NULL REFERENCES semanas(id) ON DELETE CASCADE,
      data_embarque DATE,
      sigla         TEXT,
      origem_cidade TEXT,
      origem_uf     TEXT,
      produto       TEXT,
      cliente       TEXT,
      proprio       BOOLEAN NOT NULL DEFAULT false,
      destino       TEXT,
      destino_uf    TEXT,
      toneladas     NUMERIC(12,3) NOT NULL,
      oferta        NUMERIC(12,2),
      net           NUMERIC(12,2),
      net2          NUMERIC(12,2),
      cliente2      TEXT,
      icms          NUMERIC(8,5),
      modal         TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_aloc_semana ON alocacoes(semana_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_aloc_data ON alocacoes(data_embarque)`);

  // Colunas acrescentadas depois da primeira versao: ADD COLUMN IF NOT EXISTS
  // deixa o deploy passar tanto em banco novo quanto no que ja tem dado.
  await pool.query(
    `ALTER TABLE alocacoes ADD COLUMN IF NOT EXISTS cenario TEXT NOT NULL DEFAULT 'realizado'`
  );
  await pool.query(`ALTER TABLE alocacoes ADD COLUMN IF NOT EXISTS net_ter NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE alocacoes ADD COLUMN IF NOT EXISTS cliente_ter TEXT`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ix_aloc_cenario ON alocacoes(semana_id, cenario)`
  );

  // Promove o master caso ele ja tenha se cadastrado.
  await pool.query(
    `UPDATE usuarios SET papel='master', situacao='ativo' WHERE lower(email)=$1`,
    [MASTER]
  );

  const n = await pool.query(`SELECT count(*)::int AS q FROM usuarios`);
  return n.rows[0].q;
}

// ---------- usuarios ----------

async function criarUsuario(nome, email, senha) {
  const e = String(email).trim().toLowerCase();
  const ehMaster = e === MASTER;
  const r = await pool.query(
    `INSERT INTO usuarios (nome, email, senha_hash, papel, situacao)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, nome, email, papel, situacao`,
    [
      String(nome).trim(),
      e,
      criarHash(senha),
      ehMaster ? 'master' : 'usuario',
      ehMaster ? 'ativo' : 'pendente'
    ]
  );
  return r.rows[0];
}

async function porEmail(email) {
  const r = await pool.query(
    `SELECT * FROM usuarios WHERE lower(email)=$1`,
    [String(email).trim().toLowerCase()]
  );
  return r.rows[0] || null;
}

async function porId(id) {
  const r = await pool.query(
    `SELECT id, nome, email, papel, situacao FROM usuarios WHERE id=$1`,
    [id]
  );
  return r.rows[0] || null;
}

async function listar() {
  const r = await pool.query(
    `SELECT id, nome, email, papel, situacao, criado_em, decidido_em
     FROM usuarios
     ORDER BY
       CASE situacao WHEN 'pendente' THEN 0 WHEN 'ativo' THEN 1 ELSE 2 END,
       criado_em DESC`
  );
  return r.rows;
}

async function decidir(id, situacao, porQuem) {
  const r = await pool.query(
    `UPDATE usuarios
        SET situacao=$2, decidido_em=now(), decidido_por=$3
      WHERE id=$1 AND papel <> 'master'
      RETURNING id, nome, email, papel, situacao`,
    [id, situacao, porQuem]
  );
  // So encerra as sessoes se a mudanca foi de fato aplicada.
  // Sem esta guarda, uma tentativa recusada (ex.: bloquear o master)
  // derrubaria a sessao de quem nem foi alterado.
  if (r.rows[0] && situacao !== 'ativo') {
    await pool.query(`DELETE FROM sessoes WHERE usuario_id=$1`, [id]);
  }
  return r.rows[0] || null;
}

async function trocarSenha(id, nova) {
  await pool.query(`UPDATE usuarios SET senha_hash=$2 WHERE id=$1`, [id, criarHash(nova)]);
  await pool.query(`DELETE FROM sessoes WHERE usuario_id=$1`, [id]);
}

// ---------- sessoes ----------

const DIAS = 14;

async function abrirSessao(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DIAS * 24 * 3600 * 1000);
  await pool.query(
    `INSERT INTO sessoes (token, usuario_id, expira_em) VALUES ($1,$2,$3)`,
    [token, usuarioId, expira]
  );
  return { token, expira };
}

async function lerSessao(token) {
  if (!token) return null;
  const r = await pool.query(
    `SELECT u.id, u.nome, u.email, u.papel, u.situacao
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token=$1 AND s.expira_em > now() AND u.situacao='ativo'`,
    [token]
  );
  return r.rows[0] || null;
}

async function fecharSessao(token) {
  if (token) await pool.query(`DELETE FROM sessoes WHERE token=$1`, [token]);
}

async function limparSessoes() {
  await pool.query(`DELETE FROM sessoes WHERE expira_em < now()`);
}

// ---------- semanas fechadas ----------

const LIM_LINHAS = 5000;

async function fecharSemana(cab, linhas, usuarioId) {
  const ano = Number(cab.ano), semana = Number(cab.semana);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new Error('Ano invalido.');
  if (!Number.isInteger(semana) || semana < 1 || semana > 53) throw new Error('Semana invalida.');
  if (!Array.isArray(linhas) || !linhas.length) throw new Error('Nenhuma linha para gravar.');
  if (linhas.length > LIM_LINHAS) throw new Error('Semana com linhas demais.');

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // A versao nova nasce depois da ultima, e so ela fica valendo.
    const v = await c.query(
      `SELECT coalesce(max(versao),0) + 1 AS v FROM semanas WHERE ano=$1 AND semana=$2`,
      [ano, semana]
    );
    await c.query(
      `UPDATE semanas SET atual=false WHERE ano=$1 AND semana=$2 AND atual`,
      [ano, semana]
    );
    const s = await c.query(
      `INSERT INTO semanas (ano, semana, periodo, versao, atual, mapa_data, usuario_id)
       VALUES ($1,$2,$3,$4,true,$5,$6) RETURNING id, versao`,
      [ano, semana, cab.periodo || null, v.rows[0].v, cab.mapaData || null, usuarioId || null]
    );
    const id = s.rows[0].id;

    const num = x => (x == null || x === '' || !isFinite(Number(x))) ? null : Number(x);
    const txt = x => (x == null || x === '') ? null : String(x).slice(0, 200);
    async function gravar(lista, cenario) {
      for (const L of (lista || [])) {
        const ton = num(L.toneladas);
        if (!(ton > 0)) continue;
        await c.query(
          `INSERT INTO alocacoes
             (semana_id, cenario, data_embarque, sigla, origem_cidade, origem_uf,
              produto, cliente, proprio, destino, destino_uf, toneladas, oferta,
              net, net2, cliente2, net_ter, cliente_ter, icms, modal)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [id, cenario, L.dataEmbarque || null, txt(L.sigla), txt(L.origemCidade),
           txt(L.origemUf), txt(L.produto), txt(L.cliente), !!L.proprio,
           txt(L.destino), txt(L.destinoUf), ton, num(L.oferta), num(L.net),
           num(L.net2), txt(L.cliente2), num(L.netTer), txt(L.clienteTer),
           num(L.icms), txt(L.modal)]
        );
      }
    }
    await gravar(linhas, 'realizado');
    await gravar(cab.linhasOtimo || [], 'otimo');
    await c.query('COMMIT');
    return { id, ano, semana, versao: s.rows[0].versao, linhas: linhas.length };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

async function listarSemanas() {
  const r = await pool.query(
    `SELECT s.id, s.ano, s.semana, s.periodo, s.versao, s.fechada_em,
            u.nome AS fechada_por,
            (SELECT count(*)::int FROM alocacoes a WHERE a.semana_id = s.id) AS linhas,
            (SELECT coalesce(sum(a.toneladas),0) FROM alocacoes a WHERE a.semana_id = s.id) AS toneladas
       FROM semanas s LEFT JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.atual
      ORDER BY s.ano DESC, s.semana DESC`
  );
  return r.rows;
}

// mes no formato 'AAAA-MM'. O recorte e por data_embarque, nao por semana.
async function consolidado(mes) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mes || ''));
  if (!m) throw new Error('Mes invalido. Use AAAA-MM.');
  const ini = mes + '-01';
  const fim = (Number(m[2]) === 12)
    ? (Number(m[1]) + 1) + '-01-01'
    : m[1] + '-' + String(Number(m[2]) + 1).padStart(2, '0') + '-01';
  const janela = [ini, fim];

  // Media de NET ponderada pela tonelada. Media simples faria uma carga de
  // 35 t pesar igual a uma de 350 t.
  const porUf = await pool.query(
    `SELECT a.origem_uf AS uf, a.proprio,
            sum(a.toneladas) AS toneladas,
            sum(a.net * a.toneladas) / nullif(sum(a.toneladas),0) AS net_medio
       FROM alocacoes a JOIN semanas s ON s.id = a.semana_id
      WHERE s.atual AND a.cenario = 'realizado'
        AND a.data_embarque >= $1 AND a.data_embarque < $2
      GROUP BY 1,2 ORDER BY 1,2`, janela);

  const porPlanta = await pool.query(
    `SELECT a.cliente, a.proprio,
            sum(a.toneladas) AS toneladas,
            sum(a.net * a.toneladas) / nullif(sum(a.toneladas),0) AS net_medio
       FROM alocacoes a JOIN semanas s ON s.id = a.semana_id
      WHERE s.atual AND a.cenario = 'realizado'
        AND a.data_embarque >= $1 AND a.data_embarque < $2
      GROUP BY 1,2 ORDER BY 3 DESC`, janela);

  const total = await pool.query(
    `SELECT sum(a.toneladas) AS toneladas,
            sum(a.net * a.toneladas) / nullif(sum(a.toneladas),0) AS net_medio,
            count(DISTINCT s.id)::int AS semanas
       FROM alocacoes a JOIN semanas s ON s.id = a.semana_id
      WHERE s.atual AND a.cenario = 'realizado'
        AND a.data_embarque >= $1 AND a.data_embarque < $2`, janela);

  // As quatro proprias sempre presentes, mesmo sem volume no mes: linha
  // zerada e informacao, some da tela seria perder o fato.
  // Realizado e otimo lado a lado — a diferenca entre os dois e o custo das
  // trocas feitas na mao, que senao ficaria embutido no comparativo.
  const porPropria = await pool.query(
    `WITH plantas(cliente) AS (
       VALUES ('Flora GO'),('Flora SP'),
              ('JBS - BioPower Campo Verde'),('JBS - BioPower Lins')
     ),
     dados AS (
       SELECT a.cliente, a.cenario,
              sum(a.toneladas) AS ton,
              sum(a.net * a.toneladas) / nullif(sum(a.toneladas),0) AS net_medio,
              sum(a.net_ter * a.toneladas) FILTER (WHERE a.net_ter IS NOT NULL)
                / nullif(sum(a.toneladas) FILTER (WHERE a.net_ter IS NOT NULL),0)
                AS net_ter,
              sum(a.toneladas) FILTER (WHERE a.net_ter IS NOT NULL) AS ton_comp,
              sum((a.net - a.net_ter) * a.toneladas)
                FILTER (WHERE a.net_ter IS NOT NULL) AS saving
         FROM alocacoes a JOIN semanas s ON s.id = a.semana_id
        WHERE s.atual AND a.proprio
          AND a.data_embarque >= $1 AND a.data_embarque < $2
        GROUP BY 1,2
     )
     SELECT p.cliente,
            coalesce(r.ton,0)  AS ton_realizado,
            r.net_medio        AS net_realizado,
            r.net_ter          AS net_ter_realizado,
            r.ton_comp         AS ton_comp_realizado,
            r.saving           AS saving_realizado,
            coalesce(o.ton,0)  AS ton_otimo,
            o.net_medio        AS net_otimo,
            o.net_ter          AS net_ter_otimo,
            o.saving           AS saving_otimo
       FROM plantas p
       LEFT JOIN dados r ON r.cliente = p.cliente AND r.cenario = 'realizado'
       LEFT JOIN dados o ON o.cliente = p.cliente AND o.cenario = 'otimo'
      ORDER BY p.cliente`, janela);

  return {
    mes,
    porUf: porUf.rows,
    porPlanta: porPlanta.rows,
    porPropria: porPropria.rows,
    total: total.rows[0] || { toneladas: 0, net_medio: null, semanas: 0 }
  };
}

async function mesesComDado() {
  const r = await pool.query(
    `SELECT to_char(a.data_embarque, 'YYYY-MM') AS mes,
            sum(a.toneladas) AS toneladas
       FROM alocacoes a JOIN semanas s ON s.id = a.semana_id
      WHERE s.atual AND a.data_embarque IS NOT NULL
      GROUP BY 1 ORDER BY 1 DESC`
  );
  return r.rows;
}

module.exports = {
  pool, iniciar, MASTER,
  criarUsuario, porEmail, porId, listar, decidir, trocarSenha,
  abrirSessao, lerSessao, fecharSessao, limparSessoes,
  criarHash, conferirSenha,
  fecharSemana, listarSemanas, consolidado, mesesComDado
};
