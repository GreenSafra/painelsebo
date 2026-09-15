// Trocar a propria senha (painel + entrar.html) e o fluxo de senha
// temporaria obrigatoria. So testa o lado do cliente (fetch mockado); o
// bloqueio no servidor (exigeSenhaOk) e a geracao da senha aleatoria ficam
// por revisao de codigo, sem Postgres local, mesmo padrao das levas anteriores.
process.chdir(__dirname);
const path = require('path');
const fs = require('fs'); const { JSDOM } = require('jsdom');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => corpo
});

(async () => {
  // ============ painel principal: modal "Trocar senha" ============
  const PAINEL = path.join(__dirname, '..', 'public', 'index.html');
  const chamadasPainel = [];
  const mockFetchPainel = async (url, opts) => {
    chamadasPainel.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    if (url === '/api/eu') return respFake(200, { usuario: null }); // sem sessao no teste, so interessa o modal
    if (url === '/api/senha' && opts && opts.method === 'POST') {
      const b = JSON.parse(opts.body);
      if (b.atual !== 'senhaAtual123') return respFake(401, { erro: 'Senha atual incorreta.' });
      return respFake(200, { ok: true });
    }
    return respFake(404, {});
  };
  const domP = new JSDOM(fs.readFileSync(PAINEL, 'utf8'), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x/',
    beforeParse(window) { window.fetch = mockFetchPainel; }
  });
  const wp = domP.window;
  wp.HTMLElement.prototype.scrollIntoView = function () { };
  wp.Element.prototype.scrollIntoView = function () { };
  await new Promise(r => setTimeout(r, 100));
  const dp = wp.document;

  T('link "Trocar senha" existe no cabecalho', !!dp.getElementById('lnkTrocarSenha'));
  T('modal comeca escondido', dp.getElementById('ovlSenha').classList.contains('hide'));

  dp.getElementById('lnkTrocarSenha').dispatchEvent(new wp.Event('click', { bubbles: true }));
  T('clicar no link abre o modal', !dp.getElementById('ovlSenha').classList.contains('hide'));

  // sem senha atual, nao chama a API
  dp.getElementById('tsAtual').value = '';
  dp.getElementById('tsNova').value = 'novaSenha1';
  dp.getElementById('tsConf').value = 'novaSenha1';
  dp.getElementById('tsSalvar').dispatchEvent(new wp.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 40));
  T('sem senha atual nao chama /api/senha', !chamadasPainel.some(c => c.url === '/api/senha'));

  // nova e confirmacao diferentes: barra no cliente, sem chamar a API
  dp.getElementById('tsAtual').value = 'senhaAtual123';
  dp.getElementById('tsNova').value = 'novaSenha1';
  dp.getElementById('tsConf').value = 'outraCoisa2';
  dp.getElementById('tsSalvar').dispatchEvent(new wp.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 40));
  T('confirmacao diferente da nova nao chama /api/senha', !chamadasPainel.some(c => c.url === '/api/senha'));
  T('confirmacao diferente mostra aviso',
    dp.getElementById('tsAviso').textContent.indexOf('confere') >= 0);

  // senha atual errada: chama a API, servidor recusa
  dp.getElementById('tsConf').value = 'novaSenha1';
  dp.getElementById('tsAtual').value = 'senhaErrada';
  dp.getElementById('tsSalvar').dispatchEvent(new wp.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  T('senha atual errada chama /api/senha mesmo assim (validacao e do servidor)',
    chamadasPainel.some(c => c.url === '/api/senha'));
  T('resposta 401 mostra aviso de senha incorreta',
    dp.getElementById('tsAviso').textContent.indexOf('incorreta') >= 0);
  T('modal continua aberto apos erro', !dp.getElementById('ovlSenha').classList.contains('hide'));

  // sucesso com a senha atual certa
  chamadasPainel.length = 0;
  dp.getElementById('tsAtual').value = 'senhaAtual123';
  dp.getElementById('tsSalvar').dispatchEvent(new wp.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const chSenha = chamadasPainel.find(c => c.url === '/api/senha');
  T('sucesso chama POST /api/senha com atual, nova e confirmacao',
    !!chSenha && chSenha.method === 'POST' &&
    JSON.parse(chSenha.body).atual === 'senhaAtual123' &&
    JSON.parse(chSenha.body).nova === 'novaSenha1' &&
    JSON.parse(chSenha.body).confirmacao === 'novaSenha1');
  T('sucesso mostra aviso de confirmacao', dp.getElementById('tsAviso').className.indexOf('ok') >= 0);

  // botao Cancelar so fecha, sem chamar a API
  dp.getElementById('lnkTrocarSenha').dispatchEvent(new wp.Event('click', { bubbles: true }));
  chamadasPainel.length = 0;
  dp.getElementById('tsCancelar').dispatchEvent(new wp.Event('click', { bubbles: true }));
  T('cancelar fecha o modal', dp.getElementById('ovlSenha').classList.contains('hide'));
  T('cancelar nao chama a API', chamadasPainel.length === 0);

  // ============ entrar.html: troca obrigatoria com senha temporaria ============
  const ENTRAR = path.join(__dirname, '..', 'public', 'entrar.html');
  const chamadasEntrar = [];
  let euResp = { usuario: null };
  const mockFetchEntrar = async (url, opts) => {
    chamadasEntrar.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    if (url === '/api/eu') return respFake(200, euResp);
    if (url === '/api/entrar' && opts && opts.method === 'POST') {
      const b = JSON.parse(opts.body);
      if (b.email === 'temporaria@exemplo.com' && b.senha === 'temp1234') {
        return respFake(200, { ok: true, usuario: { id: 1, nome: 'Fulano', email: b.email, papel: 'usuario', senhaTemporaria: true } });
      }
      if (b.email === 'normal@exemplo.com' && b.senha === 'normal123') {
        return respFake(200, { ok: true, usuario: { id: 2, nome: 'Beltrana', email: b.email, papel: 'usuario', senhaTemporaria: false } });
      }
      return respFake(401, { erro: 'E-mail ou senha incorretos.' });
    }
    if (url === '/api/senha' && opts && opts.method === 'POST') {
      const b = JSON.parse(opts.body);
      if (b.atual !== 'temp1234') return respFake(401, { erro: 'Senha atual incorreta.' });
      return respFake(200, { ok: true });
    }
    return respFake(404, {});
  };

  const domE1 = new JSDOM(fs.readFileSync(ENTRAR, 'utf8'), {
    runScripts: 'dangerously', url: 'https://x/',
    beforeParse(window) { window.fetch = mockFetchEntrar; }
  });
  const we1 = domE1.window;
  await new Promise(r => setTimeout(r, 80));
  const de1 = we1.document;

  T('login normal (sem senha temporaria) nao mostra a troca obrigatoria',
    de1.getElementById('formTroca').style.display === 'none');
  de1.getElementById('e1').value = 'normal@exemplo.com';
  de1.getElementById('s1').value = 'normal123';
  de1.getElementById('btnEntrar').dispatchEvent(new we1.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  T('login normal nao ativa o bloco de troca obrigatoria',
    de1.getElementById('formTroca').style.display === 'none');

  const domE2 = new JSDOM(fs.readFileSync(ENTRAR, 'utf8'), {
    runScripts: 'dangerously', url: 'https://x/',
    beforeParse(window) { window.fetch = mockFetchEntrar; }
  });
  const we2 = domE2.window;
  await new Promise(r => setTimeout(r, 80));
  const de2 = we2.document;

  de2.getElementById('e1').value = 'temporaria@exemplo.com';
  de2.getElementById('s1').value = 'temp1234';
  de2.getElementById('btnEntrar').dispatchEvent(new we2.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  T('login com senha temporaria mostra o bloco de troca obrigatoria',
    de2.getElementById('formTroca').style.display === '');
  T('login com senha temporaria esconde as abas de entrar/criar',
    de2.querySelector('.abas').style.display === 'none');
  T('login com senha temporaria nao redirecionou (nao ha window.location mock, mas o form segue montado)',
    !!de2.getElementById('btnTroca'));

  // confirmacao diferente barra no cliente, sem chamar a API
  chamadasEntrar.length = 0;
  de2.getElementById('st').value = 'temp1234';
  de2.getElementById('sn').value = 'senhaNova1';
  de2.getElementById('sc').value = 'outraCoisa';
  de2.getElementById('btnTroca').dispatchEvent(new we2.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 40));
  T('confirmacao divergente na troca obrigatoria nao chama /api/senha',
    !chamadasEntrar.some(c => c.url === '/api/senha'));

  // sucesso chama /api/senha com a senha temporaria como "atual"
  de2.getElementById('sc').value = 'senhaNova1';
  de2.getElementById('btnTroca').dispatchEvent(new we2.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const chTroca = chamadasEntrar.find(c => c.url === '/api/senha');
  T('sucesso na troca obrigatoria chama POST /api/senha com a senha temporaria como atual',
    !!chTroca && JSON.parse(chTroca.body).atual === 'temp1234' &&
    JSON.parse(chTroca.body).nova === 'senhaNova1');

  // acessar /entrar ja logado com senha temporaria tambem cai na troca obrigatoria
  euResp = { usuario: { id: 3, nome: 'Ciclano', email: 'x@x.com', papel: 'usuario', senhaTemporaria: true } };
  const domE3 = new JSDOM(fs.readFileSync(ENTRAR, 'utf8'), {
    runScripts: 'dangerously', url: 'https://x/',
    beforeParse(window) { window.fetch = mockFetchEntrar; }
  });
  const we3 = domE3.window;
  await new Promise(r => setTimeout(r, 80));
  const de3 = we3.document;
  T('reabrir /entrar ja logado com senha temporaria mostra a troca obrigatoria direto',
    de3.getElementById('formTroca').style.display === '');

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
