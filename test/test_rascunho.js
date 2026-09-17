// Rascunho no servidor (salvarRascunho/carregarRascunho) e o leitor #bd
// sobrevivendo sem o gerador (distribuir() foi removido).
// Todos os testes deste projeto sao client-side via jsdom, sem Postgres —
// nao ha banco local disponivel (so Railway). As mudancas de db.js/server.js
// (tabela, upsert, rotas) NAO entram aqui: ficam garantidas por revisao de
// codigo, do mesmo jeito que fecharSemana/api-semanas nunca tiveram teste
// de banco nesta sessao. Aqui testamos so a logica do cliente, com fetch
// mockado.
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync(PAINEL, 'utf8'), { runScripts: 'dangerously', url: 'https://x/' });
const w = dom.window;
w.DecompressionStream = DecompressionStream; w.CompressionStream = CompressionStream;
w.Response = Response; w.Blob = Blob; w.XMLSerializer = dom.window.XMLSerializer;
w.HTMLElement.prototype.scrollIntoView = function () {};
w.Element.prototype.scrollIntoView = function () {};
w.btoa = s => Buffer.from(s, 'binary').toString('base64');
w.atob = s => Buffer.from(s, 'base64').toString('binary');
const fake = (n, p) => { const b = fs.readFileSync(p); return { name: n, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

// resposta fetch fake, no formato que window.fetch devolve
const respFake = (status, corpo) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => corpo
});

(async () => {
  await new Promise(r => setTimeout(r, 60));
  await w.receber('prog', fake('prog.xlsx', 'in/prog38.xlsx'));
  await w.receber('mapa', fake('mapa.xlsx', 'in/mapa2.xlsx'));
  await new Promise(r => setTimeout(r, 150));
  const d = w.document;

  // necessidade pra ter propria competindo pelo volume (senao tudo vai pra
  // terceiro e nao ha opcao propria nenhuma pra trocar) — mesmo cenario de
  // test_resumo.js
  const E = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  const setNec = (c, v) => { const i = d.querySelector('[data-nec="' + E(c) + '"]'); if (i) { i.value = v; i.dispatchEvent(new w.Event('input')); } };
  setNec('JBS - BioPower Lins', 900);
  setNec('JBS - BioPower Campo Verde', 900);
  setNec('Flora SP', 900);
  w.rodar(); await new Promise(r => setTimeout(r, 120));

  // troca manual pra ST.manual ter conteudo real (mesmo padrao de test_troca.js/test_resumo.js)
  d.querySelector('#map path[data-uf="MT"]').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 40));
  const uns = [...d.querySelectorAll('[data-ed]')];
  let vProp = null, vTer = null;
  for (const un of uns) {
    un.click(); await new Promise(r => setTimeout(r, 40));
    const ops = [...d.querySelectorAll('#detail .opt')];
    const p = ops.find(o => /BioPower|Flora/.test(o.querySelector('.nm').textContent));
    const t = ops.find(o => !/BioPower|Flora/.test(o.querySelector('.nm').textContent));
    if (p && t) { vProp = p; vTer = t; break; }
  }
  T('achou unidade com propria e terceiro pra trocar em MT', !!vProp && !!vTer);
  if (vProp && vTer) {
    const volProp = vProp.querySelector('.vol');
    const antes = volProp.value;
    volProp.value = '0'; volProp.dispatchEvent(new w.Event('change'));
    await new Promise(r => setTimeout(r, 60));
    const ops2 = [...d.querySelectorAll('#detail .opt')];
    const t2 = ops2.find(o => !/BioPower|Flora/.test(o.querySelector('.nm').textContent)).querySelector('.vol');
    t2.value = String(Number(t2.value || 0) + Number(antes)); t2.dispatchEvent(new w.Event('change'));
    await new Promise(r => setTimeout(r, 60));
  }
  T('ha ajuste manual pra testar a ida e volta', Object.keys(w.ST.manual || {}).length > 0,
    JSON.stringify(w.ST.manual));

  const prodOriginal = JSON.stringify(w.PROD);
  const mapaOriginal = JSON.stringify(w.MAPA.rows.map(r => { const c = Object.assign({}, r); delete c.ofEdit; return c; }));
  const manualOriginal = JSON.stringify(w.ST.manual);
  const progbufOriginal = w.PROGBUF ? Buffer.from(w.PROGBUF) : null;

  // ============ 1. salvar/carregar volta equivalente ============
  let corpoEnviado = null;
  w.fetch = async (url, opts) => {
    if (url === '/api/rascunho' && opts && opts.method === 'POST') {
      corpoEnviado = JSON.parse(opts.body);
      return respFake(200, { ok: true, salvoEm: '2026-09-14T10:00:00.000Z', salvoPor: 'Ronaldo' });
    }
    return respFake(404, {});
  };
  await w.salvarRascunho();
  T('salvou sem erro', !!corpoEnviado);
  T('pacote enviado tem ano/semana/dados', corpoEnviado && Number.isInteger(corpoEnviado.ano) &&
    corpoEnviado.semana === w.PROD.semana && !!corpoEnviado.dados);
  T('carimbo mostra quem salvou', w.RASCUNHO_SALVO_POR === 'Ronaldo' && !w.RASCUNHO_SUJO);

  // ============ 1b. status da semana no subtítulo, não solto na linha de botões ============
  const sub1 = w.document.getElementById('sub').textContent;
  T('subtítulo termina com o status de quem salvou e quando', sub1.indexOf('salvo por Ronaldo às') >= 0, sub1);
  T('não existe mais #msgSalvar na linha de botões (status saiu de lá)',
    !w.document.getElementById('msgSalvar'));
  T('#fechaMsg não fica dentro do <nav> do menu',
    !w.document.getElementById('menu').contains(w.document.getElementById('fechaMsg')));
  T('botão Salvar sem selo de pendência (acabou de salvar)',
    w.document.getElementById('bSave').textContent.trim() === 'Salvar');

  // marca alteração pendente (é o que render() faz a cada recálculo) e
  // confere o selo no botão
  w.marcarRascunhoSujo(true);
  T('com alteração pendente, botão Salvar ganha o selo "•"',
    w.document.getElementById('bSave').textContent.trim() === 'Salvar •');
  T('subtítulo não some por causa da pendência (continua com o último status salvo)',
    w.document.getElementById('sub').textContent.indexOf('salvo por Ronaldo às') >= 0);
  w.marcarRascunhoSujo(false);  // deixa limpo pro resto dos cenarios deste arquivo

  const pacoteSalvo = corpoEnviado.dados;
  // zera tudo, como se fosse uma sessao nova
  w.PROD = null; w.MAPA = null; w.PROGBUF = null; w.ST = null;
  w.fetch = async url => {
    if (url.indexOf('/api/rascunho?') === 0) {
      return respFake(200, { dados: pacoteSalvo, salvoEm: '2026-09-14T10:00:00.000Z', salvoPor: 'Ronaldo' });
    }
    return respFake(404, {});
  };
  await w.carregarRascunho(corpoEnviado.ano, corpoEnviado.semana);
  T('PROD volta identico', JSON.stringify(w.PROD) === prodOriginal);
  const mapaRestaurado = JSON.stringify(w.MAPA.rows.map(r => { const c = Object.assign({}, r); delete c.ofEdit; return c; }));
  T('MAPA.rows volta identico (sem ofEdit)', mapaRestaurado === mapaOriginal);
  T('ajuste manual sobrevive a ida e volta', JSON.stringify(w.ST.manual) === manualOriginal);
  if (progbufOriginal) {
    const restaurado = Buffer.from(w.PROGBUF);
    T('PROGBUF volta byte a byte identico', progbufOriginal.equals(restaurado),
      progbufOriginal.length + ' vs ' + restaurado.length);
  } else {
    T('PROGBUF ausente nos dois lados', !w.PROGBUF);
  }

  // ============ 2. salvar duas vezes usa a mesma chave (nao duplica) ============
  const chamadas = [];
  w.fetch = async (url, opts) => {
    if (url === '/api/rascunho' && opts && opts.method === 'POST') {
      chamadas.push(JSON.parse(opts.body));
      return respFake(200, { ok: true, salvoEm: '2026-09-14T11:00:00.000Z', salvoPor: 'Ronaldo' });
    }
    return respFake(404, {});
  };
  await w.salvarRascunho();
  await w.salvarRascunho();
  T('salvou duas vezes', chamadas.length === 2);
  T('as duas chamadas usam o mesmo ano+semana (upsert no servidor, nao duplica linha)',
    chamadas.length === 2 && chamadas[0].ano === chamadas[1].ano && chamadas[0].semana === chamadas[1].semana,
    JSON.stringify(chamadas.map(c => c.ano + '/' + c.semana)));

  // ============ 3. trava de sobrescrita ============
  let tentativas = [];
  w.confirm = () => true;
  w.fetch = async (url, opts) => {
    if (url === '/api/rascunho' && opts && opts.method === 'POST') {
      const corpo = JSON.parse(opts.body);
      tentativas.push(corpo);
      if (tentativas.length === 1) {
        return respFake(409, { conflito: true, salvoPor: 'Outra Pessoa', salvoEm: '2026-09-14T12:00:00.000Z' });
      }
      return respFake(200, { ok: true, salvoEm: '2026-09-14T12:05:00.000Z', salvoPor: 'Ronaldo' });
    }
    return respFake(404, {});
  };
  await w.salvarRascunho();
  T('trava dispara: houve segunda tentativa apos confirm', tentativas.length === 2);
  T('segunda tentativa manda forcar=true', tentativas[1] && tentativas[1].forcar === true);

  tentativas = [];
  w.confirm = () => false;
  await w.salvarRascunho();
  T('trava dispara mas usuario cancela: nao reenvia', tentativas.length === 1 &&
    tentativas[0].forcar !== true);

  tentativas = [];
  let confirmChamado = false;
  w.confirm = () => { confirmChamado = true; return true; };
  w.fetch = async (url, opts) => {
    if (url === '/api/rascunho' && opts && opts.method === 'POST') {
      tentativas.push(JSON.parse(opts.body));
      return respFake(200, { ok: true, salvoEm: '2026-09-14T13:00:00.000Z', salvoPor: 'Ronaldo' });
    }
    return respFake(404, {});
  };
  await w.salvarRascunho();
  T('sem conflito: confirm nunca e chamado', !confirmChamado && tentativas.length === 1);

  // ============ 4. <script id="bd"> continua abrindo sem o gerador ============
  // (usa w.PROD/w.MAPA de agora, antes de zerar tudo nos testes seguintes)
  const pacoteReal = w.montarPacoteDados();
  const jsonInline = JSON.stringify(pacoteReal).replace(/</g, '\\u003c');
  const htmlComBd = fs.readFileSync(PAINEL, 'utf8').replace(
    '<script id="bd" type="application/json"></script>',
    '<script id="bd" type="application/json">' + jsonInline + '</script>'
  );
  const dom2 = new JSDOM(htmlComBd, { runScripts: 'dangerously', url: 'https://x/' });
  const w2 = dom2.window;
  w2.DecompressionStream = DecompressionStream; w2.CompressionStream = CompressionStream;
  w2.Response = Response; w2.Blob = Blob; w2.XMLSerializer = dom2.window.XMLSerializer;
  w2.HTMLElement.prototype.scrollIntoView = function () {};
  w2.Element.prototype.scrollIntoView = function () {};
  w2.btoa = s => Buffer.from(s, 'binary').toString('base64');
  w2.atob = s => Buffer.from(s, 'base64').toString('binary');
  await new Promise(r => setTimeout(r, 150));
  T('#bd continua abrindo: PROD carregado', !!w2.PROD && w2.PROD.semana === pacoteReal.prod.semana);
  T('#bd continua abrindo: app visivel, import escondido',
    !w2.document.getElementById('app').classList.contains('hide') &&
    w2.document.getElementById('importBox').classList.contains('hide'));

  // ============ 5. Nova semana: zera tudo, nao auto-carrega ============
  w.RASCUNHO_SUJO = false;
  const urlsChamadas = [];
  w.fetch = async (url) => {
    urlsChamadas.push(url);
    if (url === '/api/rascunhos') return respFake(200, []);
    return respFake(404, {});
  };
  w.novaSemana();
  T('nova semana: PROD zerado', w.PROD === null);
  T('nova semana: MAPA zerado', w.MAPA === null);
  T('nova semana: PROGBUF zerado', w.PROGBUF === null);
  T('nova semana: sebo_estado limpo', w.localStorage.getItem('sebo_estado') === null);
  T('nova semana: sebo_dados limpo', w.localStorage.getItem('sebo_dados') === null);
  T('nova semana: volta pra tela de importacao', !d.querySelector('#importBox').classList.contains('hide'));
  T('nova semana: esconde o painel', d.querySelector('#app').classList.contains('hide'));
  T('nova semana: nao auto-carrega nenhum rascunho especifico',
    !urlsChamadas.some(u => u.indexOf('/api/rascunho?') === 0), urlsChamadas.join(', '));

  // ============ 6. Nova semana: confirmacao so quando ha algo nao salvo ============
  let confirmChamadoNS = false;
  w.confirm = () => { confirmChamadoNS = true; return true; };
  w.RASCUNHO_SUJO = true;
  w.novaSemana();
  T('com alteracao nao salva, nova semana avisa antes', confirmChamadoNS);

  confirmChamadoNS = false;
  w.RASCUNHO_SUJO = false;
  w.novaSemana();
  T('com tudo salvo, nova semana nao avisa', !confirmChamadoNS);

  // ============ 7. Descartar rascunho ============
  const deletes = [];
  w.fetch = async (url, opts) => {
    if (opts && opts.method === 'DELETE') { deletes.push(url); return respFake(200, { ok: true }); }
    if (url === '/api/rascunhos') return respFake(200, []);
    return respFake(404, {});
  };
  w.confirm = () => false;
  await w.descartarRascunho(2026, 38);
  T('descartar: cancelar a confirmacao nao chama DELETE', deletes.length === 0);

  w.confirm = () => true;
  await w.descartarRascunho(2026, 38);
  T('descartar: confirmar chama DELETE com ano e semana certos',
    deletes.length === 1 && deletes[0] === '/api/rascunho?ano=2026&semana=38', deletes.join(', '));

  // ============ 8. Sair: avisa so quando ha alteracao nao salva ============
  const chamadasSair = [];
  w.fetch = async (url, opts) => {
    if (url === '/api/sair' && opts && opts.method === 'POST') { chamadasSair.push(url); return respFake(200, { ok: true }); }
    return respFake(404, {});
  };
  let confirmChamadoSair = false;
  w.confirm = () => { confirmChamadoSair = true; return true; };
  w.RASCUNHO_SUJO = true;
  await w.sair();
  T('sair: com alteracao nao salva, avisa antes', confirmChamadoSair);
  T('sair: apos confirmar, chama POST /api/sair', chamadasSair.length === 1);

  confirmChamadoSair = false;
  chamadasSair.length = 0;
  w.RASCUNHO_SUJO = false;
  await w.sair();
  T('sair: com tudo salvo, nao avisa', !confirmChamadoSair);
  T('sair: mesmo sem aviso, chama POST /api/sair', chamadasSair.length === 1);

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
