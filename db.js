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

  // DEFAULT false: toda conta ja existente nasce com a coluna em false,
  // ninguem que ja estava logado cai na troca obrigatoria por causa do deploy.
  await pool.query(
    `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_temporaria BOOLEAN NOT NULL DEFAULT false`
  );

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

  // Rascunho da semana em andamento: uma linha por ano+semana, salvar
  // sobrescreve — nao versionado como semanas/alocacoes, porque isto e
  // trabalho em progresso; so a versao fechada entra no historico. Guarda o
  // mesmo pacote que montarPacoteDados() monta no painel (prod, progb64,
  // mapa, estado, arquivos), serializado como texto: tem base64 do xlsx
  // dentro e nunca vai ser consultado por campo, por isso TEXT e nao JSONB.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rascunhos (
      id         SERIAL PRIMARY KEY,
      ano        INTEGER NOT NULL,
      semana     INTEGER NOT NULL,
      dados      TEXT NOT NULL,
      usuario_id INTEGER REFERENCES usuarios(id),
      salvo_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (ano, semana)
    )
  `);

  // Uma linha por cotacao: cliente, origem (texto cru da unidade no Mapa
  // — sempre presente, e a chave que evita duplicidade), sigla resolvida
  // quando da (null quando ambigua ou sem Programacao pareada), oferta
  // BRUTA sem NET (NET embute frete, que varia por origem, e
  // contaminaria a serie de preco com efeito de logistica), e o
  // ano+semana a que se refere. Sem versao: reimportar o mesmo Mapa
  // substitui (upsert pela chave unica), nao duplica. Sem FK pra
  // semanas: uma cotacao pode existir pra uma semana que nunca vai
  // fechar, e isso e normal — quem faz a serie existir e o Mapa, nao o
  // fechamento.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cotacoes (
      id           SERIAL PRIMARY KEY,
      ano          INTEGER NOT NULL,
      semana       INTEGER NOT NULL,
      cliente      TEXT NOT NULL,
      origem       TEXT NOT NULL,
      sigla        TEXT,
      oferta       NUMERIC(12,2) NOT NULL,
      data_cotacao DATE,
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (cliente, origem, ano, semana)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_cotacoes_semana ON cotacoes(ano, semana)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_cotacoes_cliente ON cotacoes(cliente)`);

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

async function mudarPapel(id, papel) {
  if (papel !== 'usuario' && papel !== 'admin') throw new Error('Papel invalido.');
  const r = await pool.query(
    `UPDATE usuarios SET papel=$2 WHERE id=$1 AND papel <> 'master'
     RETURNING id, nome, email, papel, situacao`,
    [id, papel]
  );
  return r.rows[0] || null;
}

async function trocarSenha(id, nova) {
  await pool.query(
    `UPDATE usuarios SET senha_hash=$2, senha_temporaria=false WHERE id=$1`,
    [id, criarHash(nova)]
  );
}

// Derruba as outras sessoes da conta, preservando a do pedido que trocou a
// senha — trocar a propria senha nao pode deslogar quem acabou de trocar.
async function fecharOutrasSessoes(id, tokenAtual) {
  await pool.query(
    `DELETE FROM sessoes WHERE usuario_id=$1 AND token <> $2`,
    [id, tokenAtual || '']
  );
}

const SENHA_TEMP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function gerarSenhaTemporaria() {
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += SENHA_TEMP_CHARS[crypto.randomInt(SENHA_TEMP_CHARS.length)];
  }
  return s;
}

// So mexe em quem nao e master (mesma trava de mudarPapel). Devolve a senha
// em texto puro UMA vez, pro admin repassar — nao fica guardada em lugar
// nenhum alem do hash.
async function redefinirSenha(id) {
  const senha = gerarSenhaTemporaria();
  const r = await pool.query(
    `UPDATE usuarios SET senha_hash=$2, senha_temporaria=true
      WHERE id=$1 AND papel <> 'master'
      RETURNING id`,
    [id, criarHash(senha)]
  );
  if (!r.rows[0]) return null;
  await pool.query(`DELETE FROM sessoes WHERE usuario_id=$1`, [id]);
  return { id, senha };
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
    `SELECT u.id, u.nome, u.email, u.papel, u.situacao,
            u.senha_temporaria AS "senhaTemporaria"
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
    await gravarCotacoes(c, ano, semana, cab.cotacoes);
    // A semana virou versao fechada: o rascunho perdeu a funcao (senao ele
    // continuaria sendo "o mais recente" e o painel reabriria uma semana ja
    // fechada sozinho). Se reabrirem e mexerem, um rascunho novo nasce
    // quando salvarem de novo.
    await c.query(`DELETE FROM rascunhos WHERE ano=$1 AND semana=$2`, [ano, semana]);
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

// Monta o filtro do periodo do consolidado. Por mes: janela de
// data_embarque (como sempre foi). Por semana: s.ano e s.semana da propria
// semana fechada, NAO data_embarque — assim uma semana que atravessa a
// virada do mes aparece inteira no modo Semana. criterio aceita uma string
// (mes, formato antigo) ou um objeto { mes } / { ano, semana }.
function filtroConsolidado(criterio) {
  const c = (typeof criterio === 'string') ? { mes: criterio } : (criterio || {});
  if (c.ano != null || c.semana != null) {
    const ano = Number(c.ano), semana = Number(c.semana);
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new Error('Ano invalido.');
    if (!Number.isInteger(semana) || semana < 1 || semana > 53) throw new Error('Semana invalida.');
    return { sql: 's.ano = $1 AND s.semana = $2', params: [ano, semana], modo: 'semana', ano, semana };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(String(c.mes || ''));
  if (!m) throw new Error('Mes invalido. Use AAAA-MM.');
  const ini = c.mes + '-01';
  const fim = (Number(m[2]) === 12)
    ? (Number(m[1]) + 1) + '-01-01'
    : m[1] + '-' + String(Number(m[2]) + 1).padStart(2, '0') + '-01';
  return { sql: 'a.data_embarque >= $1 AND a.data_embarque < $2', params: [ini, fim], modo: 'mes', mes: c.mes };
}

async function consolidado(criterio) {
  const f = filtroConsolidado(criterio);

  // Media de NET ponderada pela tonelada. Media simples faria uma carga de
  // 35 t pesar igual a uma de 350 t.
  const porUf = await pool.query(
    `SELECT a.origem_uf AS uf, a.proprio,
            sum(a.toneladas) AS toneladas,
            sum(a.net * a.toneladas) / nullif(sum(a.toneladas),0) AS net_medio
       FROM alocacoes a JOIN semanas s ON s.id = a.semana_id
      WHERE s.atual AND a.cenario = 'realizado' AND ${f.sql}
      GROUP BY 1,2 ORDER BY 1,2`, f.params);

  const porPlanta = await pool.query(
    `SELECT a.cliente, a.proprio,
            sum(a.toneladas) AS toneladas,
            sum(a.net * a.toneladas) / nullif(sum(a.toneladas),0) AS net_medio
       FROM alocacoes a JOIN semanas s ON s.id = a.semana_id
      WHERE s.atual AND a.cenario = 'realizado' AND ${f.sql}
      GROUP BY 1,2 ORDER BY 3 DESC`, f.params);

  const total = await pool.query(
    `SELECT sum(a.toneladas) AS toneladas,
            sum(a.net * a.toneladas) / nullif(sum(a.toneladas),0) AS net_medio,
            count(DISTINCT s.id)::int AS semanas
       FROM alocacoes a JOIN semanas s ON s.id = a.semana_id
      WHERE s.atual AND a.cenario = 'realizado' AND ${f.sql}`, f.params);

  // As quatro proprias canonicas sempre presentes, mesmo sem volume no
  // periodo: linha zerada e informacao, some da tela seria perder o fato.
  // Mas a lista nao para nas quatro: uniao com o que "dados" realmente
  // encontrar evita a mesma armadilha que agregarSemana() em core.js evita
  // de proposito (comentario lá: "nao uma lista cravada... tipo BioPower
  // Mafra ausente de uma lista fixa") — uma propria fora das quatro
  // canonicas apareceria em "dados" mas seria descartada no LEFT JOIN se a
  // lista de plantas fosse so a fixa.
  // Realizado e otimo lado a lado — a diferenca entre os dois e o custo das
  // trocas feitas na mao, que senao ficaria embutido no comparativo.
  const porPropria = await pool.query(
    `WITH dados AS (
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
        WHERE s.atual AND a.proprio AND ${f.sql}
        GROUP BY 1,2
     ),
     plantas AS (
       SELECT cliente FROM (VALUES
         ('Flora GO'),('Flora SP'),
         ('JBS - BioPower Campo Verde'),('JBS - BioPower Lins')
       ) AS fixas(cliente)
       UNION
       SELECT DISTINCT cliente FROM dados
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
      ORDER BY p.cliente`, f.params);

  // Semanas fechadas (versao atual) cujas cargas caem dentro do periodo em
  // tela — e a lista que a tela de consolidado usa pra gerenciar/excluir.
  const semanasFechadas = await pool.query(
    `SELECT s.ano, s.semana, s.periodo, s.versao, s.fechada_em, u.nome AS fechada_por,
            count(a.id)::int AS linhas, coalesce(sum(a.toneladas),0) AS toneladas
       FROM semanas s
       LEFT JOIN usuarios u ON u.id = s.usuario_id
       JOIN alocacoes a ON a.semana_id = s.id
      WHERE s.atual AND a.cenario = 'realizado' AND ${f.sql}
      GROUP BY s.id, u.nome
      ORDER BY s.ano DESC, s.semana DESC`, f.params);

  return {
    modo: f.modo,
    mes: f.mes || null,
    ano: f.ano || null,
    semana: f.semana || null,
    porUf: porUf.rows,
    porPlanta: porPlanta.rows,
    porPropria: porPropria.rows,
    semanasFechadas: semanasFechadas.rows,
    total: total.rows[0] || { toneladas: 0, net_medio: null, semanas: 0 }
  };
}

async function apagarSemana(ano, semana) {
  if (!Number.isInteger(ano) || !Number.isInteger(semana)) throw new Error('Ano/semana invalidos.');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Sem "AND atual": apaga TODAS as versoes daquele ano+semana — meia
    // semana no banco (uma versao velha sobrando) e pior que nenhuma.
    // alocacoes.semana_id tem ON DELETE CASCADE, entao as linhas somem juntas.
    const r = await c.query(`DELETE FROM semanas WHERE ano=$1 AND semana=$2`, [ano, semana]);
    await c.query('COMMIT');
    return { apagadas: r.rowCount };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
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

// ---------- rascunhos ----------

async function salvarRascunho({ ano, semana, dados, usuarioId, baseSalvoEm, forcar }) {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new Error('Ano invalido.');
  if (!Number.isInteger(semana) || semana < 1 || semana > 53) throw new Error('Semana invalida.');

  // Trava de sobrescrita: se ja existe rascunho mais novo que o que o
  // cliente carregou (ou o cliente nunca carregou nada e ja existe algo),
  // avisa em vez de gravar por cima calado — a nao ser que forcar=true.
  const atual = await pool.query(
    `SELECT r.salvo_em, u.nome AS salvo_por
       FROM rascunhos r LEFT JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.ano=$1 AND r.semana=$2`,
    [ano, semana]
  );
  if (atual.rows.length && !forcar) {
    const a = atual.rows[0];
    if (!baseSalvoEm || new Date(a.salvo_em) > new Date(baseSalvoEm)) {
      return { conflito: true, salvoPor: a.salvo_por, salvoEm: a.salvo_em };
    }
  }

  const texto = JSON.stringify(dados);
  const r = await pool.query(
    `INSERT INTO rascunhos (ano, semana, dados, usuario_id, salvo_em)
       VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (ano, semana) DO UPDATE
       SET dados=$3, usuario_id=$4, salvo_em=now()
     RETURNING salvo_em`,
    [ano, semana, texto, usuarioId || null]
  );
  return { conflito: false, salvoEm: r.rows[0].salvo_em };
}

async function listarRascunhos() {
  const r = await pool.query(
    `SELECT r.ano, r.semana, r.salvo_em, u.nome AS salvo_por
       FROM rascunhos r LEFT JOIN usuarios u ON u.id = r.usuario_id
      ORDER BY r.salvo_em DESC`
  );
  return r.rows;
}

async function lerRascunho(ano, semana) {
  if (!Number.isInteger(ano) || !Number.isInteger(semana)) throw new Error('Ano/semana invalidos.');
  const r = await pool.query(
    `SELECT r.dados, r.salvo_em, u.nome AS salvo_por
       FROM rascunhos r LEFT JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.ano=$1 AND r.semana=$2`,
    [ano, semana]
  );
  if (!r.rows.length) return null;
  return { dados: JSON.parse(r.rows[0].dados), salvoEm: r.rows[0].salvo_em, salvoPor: r.rows[0].salvo_por };
}

async function apagarRascunho(ano, semana) {
  if (!Number.isInteger(ano) || !Number.isInteger(semana)) throw new Error('Ano/semana invalidos.');
  await pool.query(`DELETE FROM rascunhos WHERE ano=$1 AND semana=$2`, [ano, semana]);
}

// ---------- cotacoes ----------

// execQuery pode ser o pool ou um client de transacao (reaproveitado por
// fecharSemana e pelo upload avulso de Mapa). Reimportar o mesmo Mapa
// substitui pela chave unica (cliente, origem, ano, semana) em vez de
// duplicar.
// Origem do Mapa -> sigla da unidade. So resolve quando nao ha duvida:
// - a origem ja traz a sigla ("Andradina AND", "Lins (LIF)", "CPG");
// - a cidade tem uma unica unidade.
// Cidades com duas unidades escritas sem a sigla (Andradina, Barretos,
// Lins) e "CPG/CGR" ficam null, para revisao manual com quem faz o Mapa.
const SIGLAS_EXPLICITAS = ['AND', 'ANF', 'LIF', 'LIN', 'CPG', 'CGR', 'BTS', 'BTG'];
const SIGLA_POR_CIDADE = {
  'agua boa': 'AGB', 'alta floresta': 'AFT', 'anastacio': 'AMS',
  'araguaina': 'ATO', 'araputanga': 'ARA', 'barra do garcas': 'BAR',
  'casa de tabua': 'CDT', 'colider': 'CLR', 'confresa': 'CFS',
  'diamantino': 'DMT', 'goiania': 'GYN', 'itapetinga': 'ITA',
  'juara': 'JUA', 'maraba': 'MRB', 'mozarlandia': 'MZL',
  'navirai': 'NVR', 'pimenta bueno': 'PIB', 'pontes e lacerda': 'PEL',
  'porto velho': 'PVH', 'redencao': 'RED', 'rio branco': 'RBR',
  'santana do araguaia': 'STA', 'senador canedo': 'SEN',
  'tucuma': 'TCM', 'vilhena': 'VHA',
  // grafias de Sao Miguel do Guapore vistas nos Mapas
  'sao miguel do guapore': 'SMG', 'sao m. guapore': 'SMG', 'sao miguel do gupore': 'SMG'
};

function siglaPorOrigem(origem) {
  if (!origem) return null;
  const txtOrig = String(origem);
  const achadas = SIGLAS_EXPLICITAS.filter(s => new RegExp(`\\b${s}\\b`).test(txtOrig));
  if (achadas.length === 1) return achadas[0];
  if (achadas.length > 1) return null; // ex.: "CPG/CGR"
  const cidade = txtOrig
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, ' ')       // tira "(3,5% Acidez)" etc.
    .toLowerCase().replace(/\s+/g, ' ').trim();
  return SIGLA_POR_CIDADE[cidade] || null;
}

async function gravarCotacoes(execQuery, ano, semana, cotacoes) {
  for (const q of (cotacoes || [])) {
    if (!q || !q.cliente || !q.origem || !(q.oferta > 0)) continue;
    const sigla = q.sigla || siglaPorOrigem(q.origem);
    // COALESCE: reimportar um Mapa sem sigla nao apaga uma sigla ja
    // preenchida (inclusive as revisadas manualmente).
    await execQuery.query(
      `INSERT INTO cotacoes (ano, semana, cliente, origem, sigla, oferta, data_cotacao)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (cliente, origem, ano, semana) DO UPDATE
         SET sigla=COALESCE($5, cotacoes.sigla), oferta=$6, data_cotacao=$7`,
      [ano, semana, q.cliente, q.origem, sigla, q.oferta, q.dataCotacao || null]
    );
  }
}

// Uma linha por ano+semana que tem cotacao gravada, com o resumo que a
// tela de Mapas gravados mostra. linhas conta cliente+origem (uma cotacao
// por par); clientes e o numero de clientes distintos; data_cotacao e a
// mais recente do grupo (upload repetido pode misturar datas).
async function semanasComCotacao() {
  const r = await pool.query(
    `SELECT ano, semana,
            count(*)::int AS linhas,
            count(DISTINCT cliente)::int AS clientes,
            max(data_cotacao) AS data_cotacao
       FROM cotacoes
      GROUP BY ano, semana
      ORDER BY ano DESC, semana DESC`
  );
  return r.rows;
}

// Apaga todas as cotacoes daquele ano+semana. Nao toca em semanas nem
// alocacoes — fechamento de semana e cotacao do Mapa sao independentes
// (cotacao pode existir sem a semana nunca ter fechado, e vice-versa).
async function apagarCotacoes(ano, semana) {
  const a = Number(ano), s = Number(semana);
  if (!Number.isInteger(a) || !Number.isInteger(s)) throw new Error('Ano/semana invalidos.');
  const r = await pool.query(`DELETE FROM cotacoes WHERE ano=$1 AND semana=$2`, [a, s]);
  return { apagadas: r.rowCount };
}

// Linhas cruas de uma semana (uma por cliente+origem). oferta e BRUTA, sem
// NET — NET = oferta * (1-icms) * (1-pis) - frete cliente, mesma conta de
// src/core.js:netDe(). Essas parcelas variam por origem e por modal
// (CIF/FOB) e hoje so existem no Mapa no momento do upload — mapas.html
// descarta tudo isso de proposito em extrairCotacoes(), e a tabela
// cotacoes nao guarda nenhuma delas. Pra ligar aqui, precisaria gravar
// frete/icms/pis/modal por linha (novas colunas) e repetir essa conta no
// servidor ou nesta tela. Ate isso existir, o ranking usa a oferta bruta.
async function cotacoesDaSemana(ano, semana) {
  if (!Number.isInteger(ano) || !Number.isInteger(semana)) throw new Error('Ano/semana invalidos.');
  const r = await pool.query(
    `SELECT cliente, origem, oferta FROM cotacoes WHERE ano=$1 AND semana=$2 ORDER BY cliente`,
    [ano, semana]
  );
  return r.rows;
}

async function gravarCotacoesLote(itens) {
  const out = [];
  for (const item of (itens || [])) {
    const ano = Number(item.ano), semana = Number(item.semana);
    if (!Number.isInteger(ano) || !Number.isInteger(semana)) {
      out.push({ ano: item.ano, semana: item.semana, ok: false, erro: 'Ano/semana invalidos.' });
      continue;
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await gravarCotacoes(c, ano, semana, item.cotacoes);
      await c.query('COMMIT');
      out.push({ ano, semana, ok: true, gravadas: (item.cotacoes || []).length });
    } catch (e) {
      await c.query('ROLLBACK');
      out.push({ ano, semana, ok: false, erro: e.message });
    } finally {
      c.release();
    }
  }
  return out;
}

module.exports = {
  pool, iniciar, MASTER,
  criarUsuario, porEmail, porId, listar, decidir, mudarPapel, trocarSenha,
  fecharOutrasSessoes, redefinirSenha,
  abrirSessao, lerSessao, fecharSessao, limparSessoes,
  criarHash, conferirSenha,
  fecharSemana, listarSemanas, consolidado, mesesComDado, apagarSemana,
  salvarRascunho, listarRascunhos, lerRascunho, apagarRascunho,
  gravarCotacoes, semanasComCotacao, gravarCotacoesLote, cotacoesDaSemana,
  apagarCotacoes, siglaPorOrigem
};
