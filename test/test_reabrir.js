// Retomar uma semana (rascunho ou fechada) de qualquer computador: o boot()
// decide entre o que esta no navegador e o que o servidor recomenda, o link
// "abrir" de uma semana fechada reidrata o painel, fechar de novo gera nova
// versao, a lista "Semanas salvas" mistura rascunho+fechada, e alterações
// pendentes pedem confirmação antes de trocar de semana. Tudo client-side
// via fetch mockado — mesmo padrão de test_rascunho.js. db.js/server.js
// (rotas novas, UNION de semanas-salvas) ficam por revisão de código, sem
// Postgres local disponível.
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

const respFake = (status, corpo) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => corpo
});

// roteador de fetch simples: primeira entrada de `regras` cujo prefixo bate
// com a url vence. urlsChamadas (se passado) acumula toda url recebida.
function rotear(regras, urlsChamadas) {
  return async (url, opts) => {
    if (urlsChamadas) urlsChamadas.push(url);
    for (const [prefixo, resp] of regras) {
      if (url.indexOf(prefixo) === 0) return typeof resp === 'function' ? resp(url, opts) : resp;
    }
    return respFake(404, {});
  };
}

async function importar(progArq, mapaArq) {
  w.PROD = null; w.MAPA = null; w.PROGBUF = null; w.ST = null;
  w.RES = null; w.DS = null; w.OPS = null; w.NEC = null; w.RAW = null;
  await w.receber('prog', fake('prog.xlsx', 'in/' + progArq));
  await w.receber('mapa', fake('mapa.xlsx', 'in/' + mapaArq));
  await new Promise(r => setTimeout(r, 120));
  return w.montarPacoteDados();
}

(async () => {
  await new Promise(r => setTimeout(r, 60));  // boot() automatico do carregamento da pagina assenta

  // pacotes reais de duas semanas diferentes (prog3=semana 36, prog4=semana 37 — conferido nos fontes de teste)
  const pacoteA = await importar('prog3.xlsx', 'mapa2.xlsx');   // semana 36/2026
  const anoA = pacoteA.prod ? w.anoDaSemana(pacoteA.prod) : null;
  const semanaA = pacoteA.prod.semana;
  const pacoteB = await importar('prog4.xlsx', 'mapa2.xlsx');   // semana 37/2026
  const anoB = w.anoDaSemana(pacoteB.prod);
  const semanaB = pacoteB.prod.semana;
  T('duas semanas de teste distintas', semanaA !== semanaB, semanaA + ' vs ' + semanaB);

  function limparLocal() {
    try { w.localStorage.clear(); } catch (e) {}
    w.PROD = null; w.MAPA = null; w.PROGBUF = null; w.ST = null;
    w.RES = null; w.DS = null; w.OPS = null; w.NEC = null; w.RAW = null;
    w.arquivos = {};
    w.RASCUNHO_SALVO_EM = null; w.RASCUNHO_SALVO_POR = null; w.ORIGEM_FECHADA = null;
    w.document.getElementById('app').classList.add('hide');
    w.document.getElementById('importBox').classList.remove('hide');
    w.document.getElementById('avisoOrigem').classList.add('hide');
    w.document.getElementById('avisoOrigem').textContent = '';
  }

  // ============ 1. Sem nada local, servidor tem rascunho do usuário ============
  limparLocal();
  w.fetch = rotear([
    ['/api/rascunho-recente', respFake(200, { ano: anoA, semana: semanaA, salvo_em: '2026-09-14T10:00:00.000Z' })],
    ['/api/rascunho?', respFake(200, { dados: pacoteA, salvoEm: '2026-09-14T10:00:00.000Z', salvoPor: 'Fulana' })],
    ['/api/semanas-salvas', respFake(200, [])]
  ]);
  await w.boot();
  T('sem local: abre direto o rascunho recomendado pelo servidor',
    w.PROD && w.PROD.semana === semanaA, 'veio ' + (w.PROD && w.PROD.semana));
  T('sem local: painel visível, import escondido',
    !w.document.getElementById('app').classList.contains('hide') &&
    w.document.getElementById('importBox').classList.contains('hide'));
  T('sem local: carimbo mostra quem salvou o rascunho', w.RASCUNHO_SALVO_POR === 'Fulana');
  T('sem local: não é uma semana fechada reaberta', w.ORIGEM_FECHADA === null);

  // ============ 2. Sem rascunho nenhum: cai na última semana fechada ============
  limparLocal();
  w.fetch = rotear([
    ['/api/rascunho-recente', respFake(200, null)],
    ['/api/semana-recente', respFake(200, { ano: anoB, semana: semanaB, versao: 2, fechada_em: '2026-09-10T08:00:00.000Z', fechada_por: 'Ciclano' })],
    ['/api/semana?', respFake(200, { dados: pacoteB, versao: 2, periodo: null, fechadaEm: '2026-09-10T08:00:00.000Z', fechadaPor: 'Ciclano' })],
    ['/api/semanas-salvas', respFake(200, [])]
  ]);
  await w.boot();
  T('sem rascunho: abre a última semana fechada', w.PROD && w.PROD.semana === semanaB);
  T('sem rascunho: marca a origem como semana fechada v2',
    w.ORIGEM_FECHADA && w.ORIGEM_FECHADA.versao === 2, JSON.stringify(w.ORIGEM_FECHADA));
  T('sem rascunho: carimbo mostra quem fechou', w.RASCUNHO_SALVO_POR === 'Ciclano');

  // ============ 3. Nem rascunho nem semana fechada no servidor: fica na importação ============
  limparLocal();
  w.fetch = rotear([
    ['/api/rascunho-recente', respFake(200, null)],
    ['/api/semana-recente', respFake(200, null)],
    ['/api/semanas-salvas', respFake(200, [])]
  ]);
  await w.boot();
  T('nada no servidor: continua na tela de importação', w.PROD === null &&
    !w.document.getElementById('importBox').classList.contains('hide'));

  // ============ 4. Local de uma semana, servidor recomenda OUTRA mais nova: troca e avisa ============
  await importar('prog3.xlsx', 'mapa2.xlsx');  // local = semana A, persiste sebo_estado/sebo_dados
  w.ST._syncIso = '2026-09-01T00:00:00.000Z';  // simula que essa semana ja foi sincronizada antes
  w.persistir();
  w.document.getElementById('avisoOrigem').classList.add('hide');
  w.fetch = rotear([
    ['/api/rascunho-recente', respFake(200, { ano: anoB, semana: semanaB, salvo_em: '2026-09-15T00:00:00.000Z' })],
    ['/api/rascunho?', respFake(200, { dados: pacoteB, salvoEm: '2026-09-15T00:00:00.000Z', salvoPor: 'Outra Pessoa' })],
    ['/api/semanas-salvas', respFake(200, [])]
  ]);
  await w.boot();
  T('servidor mais novo em semana diferente: troca para a do servidor',
    w.PROD && w.PROD.semana === semanaB, 'veio ' + (w.PROD && w.PROD.semana));
  T('avisa na tela qual foi aberta',
    !w.document.getElementById('avisoOrigem').classList.contains('hide') &&
    w.document.getElementById('avisoOrigem').textContent.indexOf(String(semanaB)) >= 0 &&
    w.document.getElementById('avisoOrigem').textContent.indexOf(String(semanaA)) >= 0,
    w.document.getElementById('avisoOrigem').textContent);

  // ============ 5. Local e servidor são a MESMA semana: mantém local, sem aviso, sem recarregar ============
  await importar('prog3.xlsx', 'mapa2.xlsx');  // local = semana A de novo
  w.ST._syncIso = '2026-09-01T00:00:00.000Z';
  w.persistir();
  w.document.getElementById('avisoOrigem').classList.add('hide');
  const urlsMesmaSemana = [];
  w.fetch = rotear([
    ['/api/rascunho-recente', respFake(200, { ano: anoA, semana: semanaA, salvo_em: '2026-09-16T00:00:00.000Z' })],
    ['/api/semanas-salvas', respFake(200, [])]
  ], urlsMesmaSemana);
  await w.boot();
  T('mesma semana: mantém a local', w.PROD && w.PROD.semana === semanaA);
  T('mesma semana: não busca o pacote completo do servidor de novo',
    !urlsMesmaSemana.some(u => u.indexOf('/api/rascunho?') === 0), urlsMesmaSemana.join(', '));
  T('mesma semana: não avisa troca nenhuma',
    w.document.getElementById('avisoOrigem').classList.contains('hide'));

  // ============ 6. Local NUNCA sincronizado: não descarta edição não salva, mesmo com servidor mais novo ============
  await importar('prog3.xlsx', 'mapa2.xlsx');  // local = semana A, _syncIso nunca setado (edição em andamento)
  T('pré-condição: local recém-importado não tem _syncIso', !w.ST._syncIso);
  w.document.getElementById('avisoOrigem').classList.add('hide');
  w.fetch = rotear([
    ['/api/rascunho-recente', respFake(200, { ano: anoB, semana: semanaB, salvo_em: '2026-09-17T00:00:00.000Z' })],
    ['/api/semanas-salvas', respFake(200, [])]
  ]);
  await w.boot();
  T('local nunca sincronizado: mantém o local em vez de descartar', w.PROD && w.PROD.semana === semanaA);
  T('local nunca sincronizado: não avisa troca', w.document.getElementById('avisoOrigem').classList.contains('hide'));

  // ============ 7. carregarSemanaFechada(): semana fechada sem pacote completo (fechada antes da função existir) ============
  limparLocal();
  w.fetch = rotear([
    ['/api/semana?', respFake(200, { dados: null, versao: 1, periodo: null, fechadaEm: '2026-01-01T00:00:00.000Z', fechadaPor: 'Antigo' })]
  ]);
  await w.carregarSemanaFechada(anoA, semanaA);
  T('semana fechada sem pacote: avisa e não altera PROD', w.PROD === null,
    w.document.getElementById('impErr').textContent);
  T('semana fechada sem pacote: mensagem de erro visível',
    !w.document.getElementById('impErr').classList.contains('hide'));

  // ============ 8. Fechar e refechar (via #bFechar) grava dados e mostra a nova versão ============
  await importar('prog3.xlsx', 'mapa2.xlsx');
  const E = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  const setNec = (c, v) => { const i = w.document.querySelector('[data-nec="' + E(c) + '"]'); if (i) { i.value = v; i.dispatchEvent(new w.Event('input')); } };
  setNec('JBS - BioPower Lins', 900); setNec('JBS - BioPower Campo Verde', 900);
  setNec('Flora SP', 900); setNec('Flora GO', 900);
  w.rodar(); await new Promise(r => setTimeout(r, 120));

  let corposFechar = [];
  w.confirm = () => true;
  w.fetch = async (url, opts) => {
    if (url === '/api/semanas' && opts && opts.method === 'POST') {
      const corpo = JSON.parse(opts.body);
      corposFechar.push(corpo);
      return respFake(200, { ok: true, id: 1, ano: anoA, semana: semanaA, versao: corposFechar.length, linhas: corpo.linhas.length });
    }
    return respFake(404, {});
  };
  w.document.getElementById('bFechar').onclick && await w.document.getElementById('bFechar').onclick();
  T('fechar: o pacote enviado inclui dados (Programação/Mapa/estado) para reabrir depois',
    corposFechar.length === 1 && !!corposFechar[0].dados && !!corposFechar[0].dados.prod && !!corposFechar[0].dados.estado);
  T('fechar: marca a origem como fechada v1', w.ORIGEM_FECHADA && w.ORIGEM_FECHADA.versao === 1);
  T('fechar: mensagem cita a versão 1', w.document.getElementById('fechaMsg').textContent.indexOf('versão 1') >= 0,
    w.document.getElementById('fechaMsg').textContent);

  await w.document.getElementById('bFechar').onclick();
  T('refechar: cria uma segunda chamada (nova versão, não sobrescreve)', corposFechar.length === 2);
  T('refechar: marca a origem como fechada v2', w.ORIGEM_FECHADA && w.ORIGEM_FECHADA.versao === 2);
  T('refechar: mensagem cita a versão 2', w.document.getElementById('fechaMsg').textContent.indexOf('versão 2') >= 0);

  // ============ 9. Lista "Semanas salvas": mistura rascunho e fechada, só rascunho tem "descartar" ============
  const listaMista = [
    { ano: 2026, semana: 38, periodo: '15/09 a 21/09', situacao: 'rascunho', versao: null, quando: '2026-09-16T10:00:00.000Z', quem: 'Fulana' },
    { ano: 2026, semana: 37, periodo: '08/09 a 14/09', situacao: 'fechada', versao: 3, quando: '2026-09-15T10:00:00.000Z', quem: 'Ciclano' }
  ];
  w.renderSemanasSalvas(listaMista);
  const box = w.document.getElementById('salvasBox');
  const itens = [...w.document.querySelectorAll('#salvasList .rascunho-abrir')];
  T('lista: caixa fica visível com itens', !box.classList.contains('hide') && itens.length === 2);
  T('lista: item fechado mostra a versão', itens.some(b => b.textContent.indexOf('fechada v3') >= 0),
    itens.map(b => b.textContent).join(' | '));
  T('lista: item rascunho mostra "rascunho"', itens.some(b => b.textContent.indexOf('rascunho') >= 0 && b.dataset.tipo === 'rascunho'));
  T('lista: só o rascunho tem botão descartar',
    w.document.querySelectorAll('#salvasList .rascunho-descartar').length === 1);

  // ============ 9b. "Semanas salvas" começa recolhida, com contagem e seta ============
  const salvasHead = w.document.getElementById('salvasHead');
  const salvasList = w.document.getElementById('salvasList');
  const salvasChev = w.document.getElementById('salvasChev');
  T('recém populada: começa recolhida', salvasList.classList.contains('hide'));
  T('recém populada: aria-expanded=false', salvasHead.getAttribute('aria-expanded') === 'false');
  T('recém populada: seta fechada', salvasChev.textContent === '▸');
  T('recém populada: título mostra a quantidade',
    w.document.getElementById('salvasTitulo').textContent === 'Semanas salvas (2)');

  salvasHead.click();
  T('clicar no título expande a lista', !salvasList.classList.contains('hide'));
  T('expandida: aria-expanded=true', salvasHead.getAttribute('aria-expanded') === 'true');
  T('expandida: seta aberta', salvasChev.textContent === '▾');

  salvasHead.click();
  T('clicar de novo recolhe a lista', salvasList.classList.contains('hide'));
  T('recolhida de novo: aria-expanded=false', salvasHead.getAttribute('aria-expanded') === 'false');
  T('recolhida de novo: seta fechada', salvasChev.textContent === '▸');

  // repopular (ex.: depois de descartar um rascunho) sempre volta a recolher,
  // mesmo que a lista estivesse aberta antes do refresh
  salvasHead.click();  // abre de novo
  T('pré-condição: aberta antes de repopular', !salvasList.classList.contains('hide'));
  w.renderSemanasSalvas(listaMista);
  T('repopular a lista volta a recolher', salvasList.classList.contains('hide'));

  // sem nenhuma semana salva, o bloco inteiro some
  w.renderSemanasSalvas([]);
  T('lista vazia: esconde o bloco inteiro', box.classList.contains('hide'));

  // ============ 10. Alterações pendentes: confirma antes de abrir outra semana pela lista ============
  w.renderSemanasSalvas(listaMista);  // repopula pra bateria 10 achar os botoes de novo
  w.RASCUNHO_SUJO = true;
  let confirmChamado = false;
  w.confirm = () => { confirmChamado = true; return false; };
  const chamadasAbrirCancelado = [];
  w.fetch = rotear([], chamadasAbrirCancelado);
  const btAbrirFechada = itens.find(b => b.dataset.tipo === 'fechada');
  btAbrirFechada.click();
  T('com alteração pendente: avisa antes de trocar de semana', confirmChamado);
  T('com alteração pendente e cancelando: não busca a outra semana',
    !chamadasAbrirCancelado.some(u => u.indexOf('/api/semana?') === 0));

  confirmChamado = false;
  const chamadasAbrirConfirmado = [];
  w.confirm = () => { confirmChamado = true; return true; };
  w.fetch = rotear([
    ['/api/semana?', respFake(200, { dados: pacoteB, versao: 3, periodo: null, fechadaEm: '2026-09-15T10:00:00.000Z', fechadaPor: 'Ciclano' })]
  ], chamadasAbrirConfirmado);
  btAbrirFechada.click();
  await new Promise(r => setTimeout(r, 60));
  T('confirmando: busca e abre a semana fechada escolhida',
    chamadasAbrirConfirmado.some(u => u.indexOf('/api/semana?') === 0) && w.PROD && w.PROD.semana === semanaB);

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
