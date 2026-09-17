// db.js:descreverConexao() — mensagem de diagnostico no log de start quando
// a conexao com o banco falha. Pura leitura de process.env + parse de URL
// (a mesma lib que o proprio pg usa por baixo, pg-connection-string), sem
// nenhuma consulta ao banco — testavel sem Postgres local. Cobre: sem
// DATABASE_URL, URL normal, URL com caractere especial cru na senha
// (quebra o parse), senha ausente na URL, e o aviso de PG* no ambiente.
// Confere em todo caso que a senha em si nunca aparece na mensagem.
process.chdir(__dirname);
const db = require('../db.js');
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };

const PG_VARS = ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
function limpar() { PG_VARS.forEach(v => delete process.env[v]); }

(async () => {
  // ---------- sem DATABASE_URL nenhuma ----------
  limpar();
  const semUrl = db.descreverConexao();
  T('sem DATABASE_URL: diz isso claramente', semUrl.indexOf('DATABASE_URL nao esta definida') >= 0, semUrl);

  // ---------- URL normal, com senha ----------
  limpar();
  process.env.DATABASE_URL = 'postgresql://postgres:SegredoForte123@meuhost.railway.internal:5432/railway';
  const normal = db.descreverConexao();
  T('URL normal: mostra host, porta, usuario e banco',
    normal.indexOf('host=meuhost.railway.internal') >= 0 &&
    normal.indexOf('porta=5432') >= 0 &&
    normal.indexOf('usuario=postgres') >= 0 &&
    normal.indexOf('banco=railway') >= 0, normal);
  T('URL normal: diz que a senha veio da URL', normal.indexOf('senha veio da URL: sim') >= 0);
  T('URL normal: a senha em si NUNCA aparece na mensagem',
    normal.indexOf('SegredoForte123') === -1, normal);
  T('URL normal: sem variavel PG* no ambiente, avisa que nenhuma existe',
    normal.indexOf('nenhuma variavel PGHOST') >= 0);

  // ---------- senha com caractere especial cru: quebra o parse da URL ----------
  limpar();
  process.env.DATABASE_URL = 'postgresql://postgres:Se#nha123@meuhost.railway.internal:5432/railway';
  const quebrada = db.descreverConexao();
  T('senha com # cru: avisa que a URL nao da pra interpretar',
    quebrada.indexOf('nao da pra interpretar como URL') >= 0, quebrada);
  T('mensagem de erro tambem nao expoe a senha (nem o pedaco que sobrou)',
    quebrada.indexOf('Se#nha123') === -1 && quebrada.indexOf('Se') === -1, quebrada);
  T('sugere a correcao (codificar com %23 ou encodeURIComponent)',
    quebrada.indexOf('%23') >= 0 && quebrada.indexOf('encodeURIComponent') >= 0);

  // ---------- URL sem nenhuma senha (campo vazio) ----------
  limpar();
  process.env.DATABASE_URL = 'postgresql://postgres@meuhost.railway.internal:5432/railway';
  const semSenha = db.descreverConexao();
  T('URL sem senha: diz que o campo saiu vazio/ausente',
    semSenha.indexOf('senha veio da URL: NAO') >= 0, semSenha);

  // ---------- mesma URL sem senha, mas com PGPASSWORD no ambiente: avisa
  // que o pg pode estar usando essa variavel no lugar do campo vazio ----------
  limpar();
  process.env.DATABASE_URL = 'postgresql://postgres@meuhost.railway.internal:5432/railway';
  process.env.PGPASSWORD = 'outra-senha-qualquer';
  const comPgpassword = db.descreverConexao();
  T('avisa que PGPASSWORD existe no ambiente e pode ter entrado no lugar',
    comPgpassword.indexOf('PGPASSWORD') >= 0 &&
    comPgpassword.indexOf('atencao') >= 0, comPgpassword);
  T('mesmo avisando da variavel, nunca imprime o valor dela',
    comPgpassword.indexOf('outra-senha-qualquer') === -1, comPgpassword);

  // ---------- URL normal (senha presente), mas PGPASSWORD tambem no
  // ambiente: como a URL ja preenche o campo, o pg NAO usa a variavel —
  // mas o aviso ainda aparece (informativo, nao afirma que houve troca) ----------
  limpar();
  process.env.DATABASE_URL = 'postgresql://postgres:SenhaCerta@meuhost.railway.internal:5432/railway';
  process.env.PGPASSWORD = 'senha-antiga-esquecida';
  const urlOkComPgVar = db.descreverConexao();
  T('URL com senha + PGPASSWORD tambem no ambiente: ainda mostra "senha veio da URL: sim"',
    urlOkComPgVar.indexOf('senha veio da URL: sim') >= 0, urlOkComPgVar);
  T('e ainda assim avisa que a variavel existe (informativo, pra quem quiser conferir)',
    urlOkComPgVar.indexOf('PGPASSWORD') >= 0);

  limpar();
  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
