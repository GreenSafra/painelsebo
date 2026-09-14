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

function exigeMaster(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  if (req.usuario.papel !== 'master') {
    return res.status(403).json({ erro: 'Só o administrador pode fazer isso.' });
  }
  next();
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
    res.json({ ok: true, usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel } });
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

app.get('/api/usuarios', exigeMaster, async (req, res) => {
  res.json({ usuarios: await db.listar() });
});

app.post('/api/usuarios/:id/aprovar', exigeMaster, async (req, res) => {
  const u = await db.decidir(Number(req.params.id), 'ativo', req.usuario.id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json({ ok: true, usuario: u });
});

app.post('/api/usuarios/:id/bloquear', exigeMaster, async (req, res) => {
  const u = await db.decidir(Number(req.params.id), 'bloqueado', req.usuario.id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json({ ok: true, usuario: u });
});

app.post('/api/senha', exigeLogin, async (req, res) => {
  const { atual, nova } = req.body || {};
  if (!nova || String(nova).length < 8) {
    return res.status(400).json({ erro: 'A nova senha precisa de pelo menos 8 caracteres.' });
  }
  const u = await db.porEmail(req.usuario.email);
  if (!db.conferirSenha(String(atual || ''), u.senha_hash)) {
    return res.status(401).json({ erro: 'Senha atual incorreta.' });
  }
  await db.trocarSenha(u.id, nova);
  tiraCookie(res);
  res.json({ ok: true });
});

// ---------- semanas fechadas ----------

app.post('/api/semanas', exigeLogin, async (req, res) => {
  const { cabecalho, linhas } = req.body || {};
  if (!cabecalho) return res.status(400).json({ erro: 'Cabeçalho da semana ausente.' });
  try {
    const cab = Object.assign({}, cabecalho, { linhasOtimo: req.body.linhasOtimo });
    const r = await db.fecharSemana(cab, linhas, req.usuario.id);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ erro: e.message || 'Não consegui gravar a semana.' });
  }
});

app.get('/api/semanas', exigeLogin, async (req, res) => {
  res.json(await db.listarSemanas());
});

app.get('/api/meses', exigeLogin, async (req, res) => {
  res.json(await db.mesesComDado());
});

app.get('/api/consolidado', exigeLogin, async (req, res) => {
  try {
    res.json(await db.consolidado(req.query.mes));
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// ---------- rascunhos ----------

app.post('/api/rascunho', exigeLogin, async (req, res) => {
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

app.get('/api/rascunhos', exigeLogin, async (req, res) => {
  res.json(await db.listarRascunhos());
});

app.get('/api/rascunho', exigeLogin, async (req, res) => {
  try {
    const r = await db.lerRascunho(Number(req.query.ano), Number(req.query.semana));
    if (!r) return res.status(404).json({ erro: 'Rascunho não encontrado.' });
    res.json(r);
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// ---------- paginas ----------

app.get('/entrar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'entrar.html'));
});

app.get('/consolidado', (req, res) => {
  if (!req.usuario) return res.redirect('/entrar');
  res.sendFile(path.join(__dirname, 'public', 'consolidado.html'));
});

app.get('/admin', (req, res) => {
  if (!req.usuario || req.usuario.papel !== 'master') return res.redirect('/entrar');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// O painel so sai daqui para quem esta logado.
app.get(['/', '/index.html'], (req, res) => {
  if (!req.usuario) return res.redirect('/entrar');
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
