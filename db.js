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

module.exports = {
  pool, iniciar, MASTER,
  criarUsuario, porEmail, porId, listar, decidir, trocarSenha,
  abrirSessao, lerSessao, fecharSessao, limparSessoes,
  criarHash, conferirSenha
};
