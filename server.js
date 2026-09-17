// Painel de alocacao de sebo - servidor
// Fase 2: banco, login, cadastro com aprovacao.

const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));

// ---------- cookies ----------

function lerCookies(req) {
  const cru = req.headers.cookie || '';
  const fora = {};
  cru.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) fora[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return fora;
}

function porCookie(res, token, expira) {
  const partes = [
    'sessao=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=' + expira.toUTCString()
  ];
  if (PROD) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

function tiraCookie(res) {
  res.setHeader('Set-Cookie',
    'sessao=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
}

// ---------- quem esta logado ----------

app.use(async (req, res, next) => {
  try {
    req.usuario = await db.lerSessao(lerCookies(req).sessao);
  } catch (e) {
    req.usuario = null;
  }
  next();
});

function exigeLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  next();
}

// Comparacao estrita com true: se a coluna vier null/undefined por qualquer
// motivo (linha antiga, erro de leitura), isso deixa passar em vez de
// trancar a conta fora do sistema. Falha aberta aqui, nunca fechada.
function temSenhaPendente(req) {
  return req.usuario && req.usuario.senhaTemporaria === true;
}

function exigeSenhaOk(req, res, next) {
  if (temSenhaPendente(req)) {
    return res.status(403).json({ erro: 'Troque sua senha temporária para continuar.', senhaTemporaria: true });
  }
  next();
}

// Uso geral: login valido e sem senha temporaria pendente. Nao usar em
// /api/senha, /api/eu ou /api/sair — sao as rotas que a propria troca precisa.
function exigeLoginPronto(req, res, next) {
  exigeLogin(req, res, () => exigeSenhaOk(req, res, next));
}

function exigeAdmin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  if (req.usuario.papel !== 'master' && req.usuario.papel !== 'admin') {
    return res.status(403).json({ erro: 'Só administradores podem fazer isso.' });
  }
  exigeSenhaOk(req, res, next);
}

// ---------- rotas abertas ----------

app.get('/saude', (req, res) => {
  res.json({ ok: true, quando: new Date().toISOString() });
});

app.post('/api/cadastrar', async (req, res) => {
  const { nome, email, senha } = req.body || {};
  if (!nome || String(nome).trim().length < 2) {
    return res.status(400).json({ erro: 'Informe seu nome.' });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }
  if (!senha || String(senha).length < 8) {
    return res.status(400).json({ erro: 'A senha precisa de pelo menos 8 caracteres.' });
  }
  try {
    const u = await db.criarUsuario(nome, email, senha);
    if (u.situacao === 'ativo') {
      const s = await db.abrirSessao(u.id);
      porCookie(res, s.token, s.expira);
      return res.json({ ok: true, situacao: 'ativo', usuario: u });
    }
    res.json({ ok: true, situacao: 'pendente' });
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ erro: 'Já existe conta com esse e-mail.' });
    }
    console.error('cadastrar:', e.message);
    res.status(500).json({ erro: 'Não foi possível criar a conta.' });
  }
});

app.post('/api/entrar', async (req, res) => {
  const { email, senha } = req.body || {};
  try {
    const u = await db.porEmail(email || '');
    if (!u || !db.conferirSenha(String(senha || ''), u.senha_hash)) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }
    if (u.situacao === 'pendente') {
      return res.status(403).json({ erro: 'Sua conta ainda aguarda aprovação do administrador.' });
    }
    if (u.situacao !== 'ativo') {
      return res.status(403).json({ erro: 'Seu acesso está bloqueado.' });
    }
    const s = await db.abrirSessao(u.id);
    porCookie(res, s.token, s.expira);
    res.json({ ok: true, usuario: {
      id: u.id, nome: u.nome, email: u.email, papel: u.papel,
      senhaTemporaria: u.senha_temporaria === true
    } });
  } catch (e) {
    console.error('entrar:', e.message);
    res.status(500).json({ erro: 'Não foi possível entrar.' });
  }
});

app.post('/api/sair', async (req, res) => {
  await db.fecharSessao(lerCookies(req).sessao);
  tiraCookie(res);
  res.json({ ok: true });
});

app.get('/api/eu', (req, res) => {
  res.json({ usuario: req.usuario || null });
});

// ---------- rotas do master ----------

app.get('/api/usuarios', exigeAdmin, async (req, res) => {
  res.json({ usuarios: await db.listar() });
});

app.post('/api/usuarios/:id/aprovar', exigeAdmin, async (req, res) => {
  const u = await db.decidir(Number(req.params.id), 'ativo', req.usuario.id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json({ ok: true, usuario: u });
});

app.post('/api/usuarios/:id/bloquear', exigeAdmin, async (req, res) => {
  const u = await db.decidir(Number(req.params.id), 'bloqueado', req.usuario.id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json({ ok: true, usuario: u });
});

app.post('/api/usuarios/:id/excluir', exigeAdmin, async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) {
    return res.status(403).json({ erro: 'Você não pode excluir a si mesmo.' });
  }
  const u = await db.decidir(Number(req.params.id), 'excluido', req.usuario.id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado (ou é o administrador master).' });
  res.json({ ok: true, usuario: u });
});

app.post('/api/usuarios/:id/promover', exigeAdmin, async (req, res) => {
  const u = await db.mudarPapel(Number(req.params.id), 'admin');
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado (ou é o administrador master).' });
  res.json({ ok: true, usuario: u });
});

app.post('/api/usuarios/:id/rebaixar', exigeAdmin, async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) {
    return res.status(403).json({ erro: 'Você não pode tirar seu próprio admin.' });
  }
  const u = await db.mudarPapel(Number(req.params.id), 'usuario');
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado (ou é o administrador master).' });
  res.json({ ok: true, usuario: u });
});

// Sem exigeSenhaOk de proposito: é a rota que resolve a senha temporaria,
// bloquear ela junto trancaria a pessoa sem saida.
app.post('/api/senha', exigeLogin, async (req, res) => {
  const { atual, nova, confirmacao } = req.body || {};
  if (!nova || String(nova).length < 8) {
    return res.status(400).json({ erro: 'A nova senha precisa de pelo menos 8 caracteres.' });
  }
  if (confirmacao !== undefined && nova !== confirmacao) {
    return res.status(400).json({ erro: 'A confirmação não confere com a nova senha.' });
  }
  const u = await db.porEmail(req.usuario.email);
  if (!db.conferirSenha(String(atual || ''), u.senha_hash)) {
    return res.status(401).json({ erro: 'Senha atual incorreta.' });
  }
  await db.trocarSenha(u.id, nova);
  await db.fecharOutrasSessoes(u.id, lerCookies(req).sessao);
  res.json({ ok: true });
});

app.post('/api/usuarios/:id/redefinir-senha', exigeAdmin, async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) {
    return res.status(403).json({ erro: 'Você não pode redefinir sua própria senha. Use "Trocar senha".' });
  }
  const r = await db.redefinirSenha(Number(req.params.id));
  if (!r) return res.status(404).json({ erro: 'Usuário não encontrado (ou é o administrador master).' });
  res.json({ ok: true, senha: r.senha });
});

// ---------- semanas fechadas ----------

app.post('/api/semanas', exigeLoginPronto, async (req, res) => {
  const { cabecalho, linhas, cotacoes, dados } = req.body || {};
  if (!cabecalho) return res.status(400).json({ erro: 'Cabeçalho da semana ausente.' });
  try {
    const cab = Object.assign({}, cabecalho, { linhasOtimo: req.body.linhasOtimo, cotacoes });
    const r = await db.fecharSemana(cab, linhas, req.usuario.id, dados);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não consegui gravar a semana.' });
  }
});

app.get('/api/semanas', exigeLoginPronto, async (req, res) => {
  res.json(await db.listarSemanas());
});

// Pacote completo (Programação, Mapa, estado) da versão atual de uma
// semana fechada — para reabrir no painel a partir do link "abrir" do
// consolidado ou da lista "Semanas salvas".
app.get('/api/semana', exigeLoginPronto, async (req, res) => {
  try {
    const r = await db.lerSemanaAtual(Number(req.query.ano), Number(req.query.semana));
    if (!r) return res.status(404).json({ erro: 'Semana não encontrada.' });
    res.json(r);
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Melhor candidato do servidor para abrir o painel direto na alocação: o
// rascunho mais recente do próprio usuário, e a semana fechada mais recente
// que pode ser reaberta (fallback quando não há rascunho nenhum).
app.get('/api/rascunho-recente', exigeLoginPronto, async (req, res) => {
  res.json(await db.rascunhoRecenteDoUsuario(req.usuario.id));
});

app.get('/api/semana-recente', exigeLoginPronto, async (req, res) => {
  res.json(await db.semanaMaisRecente());
});

// Rascunhos e semanas fechadas misturados por recência — lista "Semanas
// salvas" da tela de importação.
app.get('/api/semanas-salvas', exigeLoginPronto, async (req, res) => {
  res.json(await db.semanasSalvas());
});

app.delete('/api/semanas', exigeLoginPronto, async (req, res) => {
  try {
    const r = await db.apagarSemana(Number(req.query.ano), Number(req.query.semana));
    res.json({ ok: true, apagadas: r.apagadas });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// ---------- cotacoes (alimentadas pelo Mapa, com ou sem semana fechada) ----------

app.get('/api/cotacoes/semanas', exigeLoginPronto, async (req, res) => {
  res.json(await db.semanasComCotacao());
});

app.get('/api/cotacoes', exigeLoginPronto, async (req, res) => {
  try {
    res.json(await db.cotacoesDaSemana(Number(req.query.ano), Number(req.query.semana)));
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/cotacoes/lote', exigeLoginPronto, async (req, res) => {
  try {
    res.json({ ok: true, resultados: await db.gravarCotacoesLote(req.body.itens || []) });
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não consegui gravar as cotações.' });
  }
});

app.delete('/api/cotacoes', exigeLoginPronto, async (req, res) => {
  try {
    const r = await db.apagarCotacoes(req.query.ano, req.query.semana);
    res.json({ ok: true, apagadas: r.apagadas });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.get('/api/meses', exigeLoginPronto, async (req, res) => {
  res.json(await db.mesesComDado());
});

app.get('/api/consolidado', exigeLoginPronto, async (req, res) => {
  try {
    const { mes, semana } = req.query;
    if (semana) {
      const m = /^(\d{4})-(\d{1,2})$/.exec(String(semana));
      if (!m) return res.status(400).json({ erro: 'Semana inválida. Use AAAA-SS.' });
      return res.json(await db.consolidado({ ano: Number(m[1]), semana: Number(m[2]) }));
    }
    res.json(await db.consolidado({ mes }));
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// ---------- rascunhos ----------

app.post('/api/rascunho', exigeLoginPronto, async (req, res) => {
  const { ano, semana, dados, baseSalvoEm, forcar } = req.body || {};
  if (!ano || !semana || !dados) return res.status(400).json({ erro: 'Dados incompletos.' });
  try {
    const r = await db.salvarRascunho({
      ano: Number(ano), semana: Number(semana), dados,
      usuarioId: req.usuario.id, baseSalvoEm, forcar: !!forcar
    });
    if (r.conflito) return res.status(409).json({ conflito: true, salvoPor: r.salvoPor, salvoEm: r.salvoEm });
    res.json({ ok: true, salvoEm: r.salvoEm, salvoPor: req.usuario.nome });
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não consegui salvar o rascunho.' });
  }
});

app.get('/api/rascunhos', exigeLoginPronto, async (req, res) => {
  res.json(await db.listarRascunhos());
});

app.get('/api/rascunho', exigeLoginPronto, async (req, res) => {
  try {
    const r = await db.lerRascunho(Number(req.query.ano), Number(req.query.semana));
    if (!r) return res.status(404).json({ erro: 'Rascunho não encontrado.' });
    res.json(r);
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.delete('/api/rascunho', exigeLoginPronto, async (req, res) => {
  try {
    await db.apagarRascunho(Number(req.query.ano), Number(req.query.semana));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// ---------- paginas ----------

app.get('/entrar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'entrar.html'));
});

function ehAdmin(req) {
  return req.usuario && (req.usuario.papel === 'master' || req.usuario.papel === 'admin');
}

// Consolidado, Análise e Usuários vivem dentro do painel (menu fixo, só o
// conteúdo abaixo troca) — a navegação de verdade entre eles acontece num
// iframe. Aberta direto (recarregar, "voltar", link externo) a rota serve
// o mesmo index.html de sempre, que le a URL e mostra a seção certa; o
// proprio painel, ao entrar naquela seção, aponta o iframe para
// "?frame=1", que devolve so o conteudo (sem a casca do painel em volta).
app.get('/consolidado', (req, res) => {
  if (!req.usuario || temSenhaPendente(req)) return res.redirect('/entrar');
  if (req.query.frame) return res.sendFile(path.join(__dirname, 'public', 'consolidado.html'));
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/analise', (req, res) => {
  if (!req.usuario || temSenhaPendente(req)) return res.redirect('/entrar');
  if (req.query.frame) return res.sendFile(path.join(__dirname, 'public', 'analise.html'));
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/usuarios', (req, res) => {
  if (!req.usuario || temSenhaPendente(req)) return res.redirect('/entrar');
  if (!ehAdmin(req)) return res.redirect('/');
  if (req.query.frame) return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rotas antigas: o conteudo mudou de lugar, mas um link ou favorito velho
// ainda deve chegar ao destino certo.
app.get('/mapas', (req, res) => res.redirect('/importar'));
app.get('/admin', (req, res) => res.redirect('/usuarios'));

// O painel so sai daqui para quem esta logado. "/importar" e a mesma casca
// — e o JS do painel, lendo a URL, que decide qual seção mostrar.
app.get(['/', '/index.html', '/importar'], (req, res) => {
  if (!req.usuario || temSenhaPendente(req)) return res.redirect('/entrar');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('*', (req, res) => {
  res.redirect(req.usuario ? '/' : '/entrar');
});

// ---------- sobe ----------

db.iniciar()
  .then(q => {
    console.log('Banco pronto. Usuários cadastrados: ' + q);
    setInterval(() => db.limparSessoes().catch(() => {}), 6 * 3600 * 1000);
    app.listen(PORT, () => console.log('Painel no ar na porta ' + PORT));
  })
  .catch(e => {
    console.error('Falha ao preparar o banco:', e.message);
    process.exit(1);
  });
