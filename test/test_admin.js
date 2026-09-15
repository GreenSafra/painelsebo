// Tela de usuarios (public/admin.html) — excluir, promover/rebaixar admin.
// So testa o lado do cliente (fetch mockado); a protecao do master
// (WHERE ... AND papel <> 'master' em decidir/mudarPapel) fica por revisao
// de codigo, sem Postgres local, mesmo padrao das levas anteriores.
process.chdir(__dirname);
const path = require('path');
const ADMIN = path.join(__dirname, '..', 'public', 'admin.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => corpo
});

// Eu (logado) sou admin, nao master — pra poder testar a auto-protecao.
const EU = { id: 10, nome: 'Eu Mesmo', email: 'eu@exemplo.com', papel: 'admin', situacao: 'ativo' };
const MASTER = { id: 1, nome: 'Dono', email: 'dono@exemplo.com', papel: 'master', situacao: 'ativo', criado_em: '2026-01-01' };
const OUTRO_ADMIN = { id: 20, nome: 'Outro Admin', email: 'outro@exemplo.com', papel: 'admin', situacao: 'ativo', criado_em: '2026-01-01' };
const COMUM = { id: 30, nome: 'Fulano Comum', email: 'fulano@exemplo.com', papel: 'usuario', situacao: 'ativo', criado_em: '2026-01-01' };
const EXCLUIDO = { id: 40, nome: 'Beltrano Saiu', email: 'beltrano@exemplo.com', papel: 'usuario', situacao: 'excluido', criado_em: '2026-01-01' };

(async () => {
  const chamadas = [];
  const mockFetch = async (url, opts) => {
    chamadas.push({ url, method: (opts && opts.method) || 'GET' });
    if (url === '/api/eu') return respFake(200, { usuario: EU });
    if (url === '/api/usuarios') {
      return respFake(200, { usuarios: [MASTER, EU, OUTRO_ADMIN, COMUM, EXCLUIDO] });
    }
    if (url.indexOf('/api/usuarios/') === 0 && url.indexOf('/redefinir-senha') > 0 && opts && opts.method === 'POST') {
      return respFake(200, { ok: true, senha: 'Xk7pQ2mNw9Rt' });
    }
    if (url.indexOf('/api/usuarios/') === 0 && opts && opts.method === 'POST') {
      return respFake(200, { ok: true, usuario: {} });
    }
    return respFake(404, {});
  };
  const dom = new JSDOM(fs.readFileSync(ADMIN, 'utf8'), {
    runScripts: 'dangerously', url: 'https://x/',
    beforeParse(window) { window.fetch = mockFetch; }
  });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 150));
  const d = w.document;

  T('pagina carregou sem quebrar', !!d.getElementById('pendentes'));

  // --- linha do master nao mostra controles ---
  const linhas = [...d.querySelectorAll('.linha')];
  const linhaMaster = linhas.find(l => l.textContent.indexOf(MASTER.email) >= 0);
  T('linha do master encontrada', !!linhaMaster);
  T('linha do master sem nenhum botao de acao',
    !!linhaMaster && linhaMaster.querySelectorAll('button[data-acao]').length === 0);

  // --- propria linha nao mostra excluir nem rebaixar ---
  const linhaEu = linhas.find(l => l.textContent.indexOf(EU.email) >= 0);
  T('propria linha encontrada', !!linhaEu);
  T('propria linha sem excluir', !!linhaEu && !linhaEu.querySelector('button[data-acao="excluir"]'));
  T('propria linha sem rebaixar (sou admin)', !!linhaEu && !linhaEu.querySelector('button[data-acao="rebaixar"]'));
  T('propria linha sem redefinir senha', !!linhaEu && !linhaEu.querySelector('button[data-acao="redefinir-senha"]'));

  // --- linha do master tambem nao mostra redefinir senha (nenhum botao, na verdade) ---
  T('linha do master sem redefinir senha',
    !!linhaMaster && !linhaMaster.querySelector('button[data-acao="redefinir-senha"]'));

  // --- excluir (do usuario comum) so acontece depois da confirmacao ---
  const btnExcluir = d.querySelector('button[data-acao="excluir"][data-id="' + COMUM.id + '"]');
  T('botao excluir do usuario comum existe', !!btnExcluir);
  w.confirm = () => false;
  btnExcluir.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 40));
  T('cancelar a confirmacao nao chama a rota de excluir',
    !chamadas.some(c => c.url === '/api/usuarios/' + COMUM.id + '/excluir'));

  w.confirm = () => true;
  btnExcluir.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  T('confirmar chama a rota de excluir com o id certo',
    chamadas.some(c => c.url === '/api/usuarios/' + COMUM.id + '/excluir' && c.method === 'POST'));

  // --- rebaixar (do outro admin) so acontece depois da confirmacao ---
  const btnRebaixar = d.querySelector('button[data-acao="rebaixar"][data-id="' + OUTRO_ADMIN.id + '"]');
  T('botao rebaixar do outro admin existe', !!btnRebaixar);
  w.confirm = () => false;
  btnRebaixar.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 40));
  T('cancelar a confirmacao nao chama a rota de rebaixar',
    !chamadas.some(c => c.url === '/api/usuarios/' + OUTRO_ADMIN.id + '/rebaixar'));

  w.confirm = () => true;
  btnRebaixar.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  T('confirmar chama a rota de rebaixar com o id certo',
    chamadas.some(c => c.url === '/api/usuarios/' + OUTRO_ADMIN.id + '/rebaixar' && c.method === 'POST'));

  // --- excluido: so tem "Reativar", que usa a mesma rota do Aprovar ---
  // reconsulta do DOM atual: as acoes anteriores ja chamaram carregar(),
  // que substitui o innerHTML — a referencia antiga de "linhas" ficou presa
  // a nos ja removidos da arvore (clique neles nao borbulha ate o document).
  const linhaExcluido = [...d.querySelectorAll('.linha')].find(l => l.textContent.indexOf(EXCLUIDO.email) >= 0);
  const botoesExcluido = linhaExcluido ? [...linhaExcluido.querySelectorAll('button[data-acao]')] : [];
  T('linha do excluido tem so um botao', botoesExcluido.length === 1,
    botoesExcluido.map(b => b.dataset.acao).join(','));
  T('esse botao e "aprovar" com o texto Reativar',
    botoesExcluido.length === 1 && botoesExcluido[0].dataset.acao === 'aprovar' &&
    botoesExcluido[0].textContent.trim() === 'Reativar');
  botoesExcluido[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  T('clicar em Reativar chama a rota de aprovar (sem precisar de confirm)',
    chamadas.some(c => c.url === '/api/usuarios/' + EXCLUIDO.id + '/aprovar' && c.method === 'POST'));

  // --- promover nao pede confirmacao ---
  const btnPromover = d.querySelector('button[data-acao="promover"][data-id="' + COMUM.id + '"]');
  T('botao promover do usuario comum existe', !!btnPromover);
  w.confirm = () => { throw new Error('confirm nao deveria ser chamado para promover'); };
  btnPromover.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  T('promover chama a rota direto, sem confirm',
    chamadas.some(c => c.url === '/api/usuarios/' + COMUM.id + '/promover' && c.method === 'POST'));

  // --- redefinir senha (do usuario comum) so acontece depois da confirmacao ---
  const btnRedefinir = d.querySelector('button[data-acao="redefinir-senha"][data-id="' + COMUM.id + '"]');
  T('botao redefinir senha do usuario comum existe', !!btnRedefinir);
  w.confirm = () => false;
  btnRedefinir.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 40));
  T('cancelar a confirmacao nao chama a rota de redefinir',
    !chamadas.some(c => c.url === '/api/usuarios/' + COMUM.id + '/redefinir-senha'));

  const chamadasAntes = chamadas.length;
  w.confirm = () => true;
  btnRedefinir.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  T('confirmar chama a rota de redefinir com o id certo',
    chamadas.some(c => c.url === '/api/usuarios/' + COMUM.id + '/redefinir-senha' && c.method === 'POST'));
  T('a senha devolvida aparece na caixa',
    d.getElementById('ovlValor').textContent === 'Xk7pQ2mNw9Rt');
  T('a caixa fica visivel', d.getElementById('ovlSenha').className.indexOf('on') >= 0);
  T('recarregar a lista NAO acontece antes do Fechar (sem chamada extra a /api/usuarios)',
    chamadas.filter(c => c.url === '/api/usuarios').length ===
    chamadas.slice(0, chamadasAntes).filter(c => c.url === '/api/usuarios').length);

  // nada alem do botao Fechar fecha a caixa — nao ha listener de Esc/clique fora
  // no admin.html, entao so confirmamos que ela permanece aberta sem esse listener
  d.getElementById('ovlSenha').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  T('Esc nao fecha a caixa', d.getElementById('ovlSenha').className.indexOf('on') >= 0);

  const totalUsuariosAntesFechar = chamadas.filter(c => c.url === '/api/usuarios').length;
  d.getElementById('btnFecharSenha').dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  T('Fechar esconde a caixa', d.getElementById('ovlSenha').className.indexOf('on') < 0);
  T('a senha some do DOM depois de Fechar', d.getElementById('ovlValor').textContent === '');
  T('Fechar dispara o recarregamento da lista',
    chamadas.filter(c => c.url === '/api/usuarios').length > totalUsuariosAntesFechar);

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
