/* ====================== ESTADO ====================== */
var STATES = /*__STATES__*/{};
var LOGOS = /*__LOGOS__*/{};
var CIDADES = /*__CIDADES__*/{};
var RAW = null, PROGBUF = null;                 // {prog, nec, mapa} planilhas cruas
var ST = null;                  // escolhas do usuário
var DS, RES, OPS, PROD, NEC, MAPA, ULT_EXPORT = null;
var UFSEL = null, EDIT = null, SUJO = false;

var fmt0 = n => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('pt-BR');
var fmt1 = n => (n == null || !isFinite(n)) ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
var rs = n => (n == null || !isFinite(n)) ? '—' : 'R$ ' + fmt0(n);
var sgn = n => (n > 0 ? '+' : '') + fmt0(n);
var esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
var $ = s => document.querySelector(s);
var $$ = s => [].slice.call(document.querySelectorAll(s));

// Proprio se o nome diz que e — mesmo criterio de detectarProprios no core.
// Nao basta estar na lista de destinos: terceiro acrescentado entra la tambem.
function grupo(cli) {
  if (/biopower/i.test(cli)) return 'bio';
  if (/flora/i.test(cli)) return 'flo';
  return 'ter';
}
function logoDe(g) { return g === 'bio' ? LOGOS.biopower : g === 'flo' ? LOGOS.flora : null; }
// Terceiro nao tem logo propria: usa um marcador neutro com a inicial.
function selo(cliente, g) {
  const l = logoDe(g);
  if (l) return img(l, 'lg');
  const ini = String(cliente || '?').replace(/^JBS\s*-\s*/, '').trim().charAt(0).toUpperCase();
  return '<span class="tercm" title="terceiro">' + esc(ini || '?') + '</span>';
}
function img(l, cls) {
  return l ? '<img class="' + cls + '" src="data:image/png;base64,' + l.b64 + '" alt="">' : '';
}
function carretas(t) { return t / 35; }

/* ====================== IMPORTAÇÃO ====================== */
var arquivos = {};

function setupImport() {
  $$('[data-pick]').forEach(b => b.onclick = () => $('[data-in="' + b.dataset.pick + '"]').click());
  $$('[data-in]').forEach(i => i.onchange = e => {
    if (e.target.files[0]) receber(i.dataset.in, e.target.files[0]);
  });
  $$('.drop').forEach(d => {
    d.ondragover = e => { e.preventDefault(); d.classList.add('on'); };
    d.ondragleave = () => d.classList.remove('on');
    d.ondrop = e => {
      e.preventDefault(); d.classList.remove('on');
      if (e.dataTransfer.files[0]) receber(d.dataset.k, e.dataTransfer.files[0]);
    };
  });
  $('#bImport').onclick = () => {
    $('#importBox').classList.remove('hide');
    $('#importBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('#bSave').onclick = salvarRascunho;
  $('#bProg').onclick = exportarProg;
  document.getElementById('bFechar').onclick = async () => {
    const msg = document.getElementById('fechaMsg');
    const bt = document.getElementById('bFechar');
    if (!PROD || !RES || !RES.alocFinal || !RES.alocFinal.length) {
      msg.className = 'fechamsg ruim';
      msg.textContent = 'Rode a alocação antes de fechar a semana.';
      return;
    }
    const pac = montarSemana(PROD, RES.alocFinal, RES.otimoAloc, OPS, MAPA);
    if (!pac.linhas.length) {
      msg.className = 'fechamsg ruim';
      msg.textContent = 'Nenhuma linha com destino para gravar.';
      return;
    }
    // Fechar de novo nao sobrescreve: o banco cria uma versao nova e so ela
    // passa a valer no consolidado.
    if (!confirm('Fechar a semana ' + pac.cabecalho.semana + ' com ' +
        pac.linhas.length + ' linhas?\n\nSe esta semana já foi fechada antes, ' +
        'isto cria uma versão nova e ela passa a valer.')) return;
    bt.disabled = true;
    msg.className = 'fechamsg';
    msg.textContent = 'Gravando...';
    try {
      const r = await fetch('/api/semanas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pac)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || 'Falha ao gravar.');
      msg.className = 'fechamsg ok';
      msg.textContent = 'Semana ' + j.semana + ' gravada (versão ' + j.versao +
        ', ' + j.linhas + ' linhas + ótimo).';
    } catch (e) {
      msg.className = 'fechamsg ruim';
      msg.textContent = e.message || 'Não consegui gravar.';
    } finally {
      bt.disabled = false;
    }
  };
  $('#who').onchange = () => { ST && (ST.usuario = $('#who').value); carimbo(); persistir(); };
  $('#bNovaSemana').onclick = novaSemana;
  const ls = document.getElementById('lnkSair');
  if (ls) ls.onclick = e => { e.preventDefault(); sair(); };
  const lt = document.getElementById('lnkTrocarSenha');
  if (lt) lt.onclick = e => { e.preventDefault(); abrirTrocaSenha(); };
  const tsCancelar = document.getElementById('tsCancelar');
  if (tsCancelar) tsCancelar.onclick = fecharTrocaSenha;
  const tsSalvar = document.getElementById('tsSalvar');
  if (tsSalvar) tsSalvar.onclick = salvarTrocaSenha;
}

// Logout ja existe no servidor (POST /api/sair) — so faltava o botao.
async function sair() {
  if (RASCUNHO_SUJO && !confirm(
    'Você tem alterações não salvas — elas serão perdidas. Sair mesmo assim?'
  )) return;
  try { await fetch('/api/sair', { method: 'POST' }); } catch (e) { }
  location.href = '/entrar';
}

function trocaSenhaAviso(msg, tipo) {
  const av = document.getElementById('tsAviso');
  if (!av) return;
  av.textContent = msg || '';
  av.className = 'aviso' + (msg ? ' ' + (tipo || 'ruim') : ' hide');
}

function abrirTrocaSenha() {
  ['tsAtual', 'tsNova', 'tsConf'].forEach(id => { const i = document.getElementById(id); if (i) i.value = ''; });
  trocaSenhaAviso('');
  const ov = document.getElementById('ovlSenha');
  if (ov) ov.classList.remove('hide');
}

function fecharTrocaSenha() {
  const ov = document.getElementById('ovlSenha');
  if (ov) ov.classList.add('hide');
}

async function salvarTrocaSenha() {
  const atual = document.getElementById('tsAtual').value;
  const nova = document.getElementById('tsNova').value;
  const conf = document.getElementById('tsConf').value;
  if (!atual) { trocaSenhaAviso('Informe a senha atual.'); return; }
  if (nova.length < 8) { trocaSenhaAviso('A nova senha precisa de pelo menos 8 caracteres.'); return; }
  if (nova !== conf) { trocaSenhaAviso('A confirmação não confere com a nova senha.'); return; }
  const bt = document.getElementById('tsSalvar');
  bt.disabled = true;
  try {
    const r = await fetch('/api/senha', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ atual, nova, confirmacao: conf })
    });
    const d = await r.json();
    if (!r.ok) { trocaSenhaAviso(d.erro || 'Não foi possível trocar a senha.'); return; }
    trocaSenhaAviso('Senha trocada. As outras sessões desta conta foram encerradas.', 'ok');
    setTimeout(fecharTrocaSenha, 1500);
  } catch (e) {
    trocaSenhaAviso('Falha de conexão. Tente de novo.');
  } finally {
    bt.disabled = false;
  }
}

async function receber(k, file) {
  const box = document.querySelector('.drop[data-k="' + k + '"]');
  document.querySelector('[data-f="' + k + '"]').textContent = 'lendo ' + file.name + '…';
  erro('');
  try {
    const buf = await file.arrayBuffer();
    const sheets = await readXlsx({ arrayBuffer: async () => buf });
    if (k === 'prog') { PROD = readProducao(sheets); PROGBUF = buf; }
    if (k === 'mapa') MAPA = readMapa(sheets);
    arquivos[k] = file.name;
    box.classList.add('ok');
    document.querySelector('[data-f="' + k + '"]').textContent = file.name;
    if (PROD && MAPA) iniciar();
  } catch (e) {
    box.classList.remove('ok');
    document.querySelector('[data-f="' + k + '"]').textContent = '';
    erro(file.name + ': ' + e.message);
  }
}

function erro(m) {
  const e = $('#impErr');
  e.textContent = m; e.classList.toggle('hide', !m);
}

function iniciar(restaurando) {
  RAW = { prod: PROD, mapa: MAPA, arquivos: arquivos };
  if (!ST) ST = novoEstado();
  if (!ST.nec) ST.nec = {};
  if (!ST.fora) ST.fora = [];
  if (!ST.extras) ST.extras = [];
  if (!ST.modo) ST.modo = 'prioridade';
  // andamento salvo antes desta versao nao tem verDest
  if (ST.verDest == null) ST.verDest = ST.modo !== 'mercado';
  ST.semana = PROD.semana; ST.periodo = PROD.periodo; ST.dataMapa = MAPA.data;
  $('#importBox').classList.add('hide');
  $('#app').classList.remove('hide');
  $('#bSave').disabled = false;
  $('#bProg').disabled = !PROGBUF;
  $('#bNovaSemana').disabled = false;
  recalcular();
  identificar();
  // restaurando = reabrindo o que ja estava salvo: regravar aqui so
  // recodificaria o xlsx em base64 a toa a cada abertura de pagina.
  if (!restaurando) persistirDados();
  // iniciar() sempre termina "limpo": nada foi mudado pelo usuario ainda,
  // seja import novo, arquivo #bd, restauracao local ou rascunho carregado.
  RASCUNHO_SUJO = false;
  atualizarCarimboRascunho();
}

// Com login, quem esta operando vem da sessao, nao de um seletor. O nome
// aparece no carimbo de ultima alteracao (carimbo(), no canto direito) —
// nao precisa de rotulo proprio aqui. O <select> so continua existindo
// para o caso de o painel ser aberto solto, fora do servidor (arquivo
// local), onde nao ha sessao.
async function identificar() {
  try {
    const r = await fetch('/api/eu');
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.usuario || !j.usuario.nome) return;
    const nome = j.usuario.nome;
    // gerenciar usuarios e coisa de master ou admin, igual a trava do servidor
    if (j.usuario.papel === 'master' || j.usuario.papel === 'admin') {
      const la = document.getElementById('lnkAdmin');
      if (la) la.classList.remove('hide');
    }
    const sel = $('#who');
    if (!sel) return;
    // o valor precisa existir como opcao, senao o carimbo nao consegue
    // refletir ST.usuario de volta no seletor
    if (![].some.call(sel.options, o => o.value === nome)) {
      const o = document.createElement('option');
      o.value = nome; o.textContent = nome; sel.appendChild(o);
    }
    sel.value = nome;
    sel.classList.add('hide');
    if (ST) { ST.usuario = nome; carimbo(); }
  } catch (e) { /* painel solto, sem servidor: segue com o seletor */ }
}

function novoEstado() {
  return {
    usuario: $('#who') ? $('#who').value : 'Usuário 1', salvoEm: null,
    travas: {}, ofEdits: {}, manual: {}, nec: {}, fora: [], extras: [], modo: 'prioridade', verDest: true
  };
}

function montarNec() {
  const det = detectarProprios(MAPA).filter(d => ST.fora.indexOf(d.cliente) < 0);
  ST.extras.forEach(c => {
    if (det.some(d => d.cliente === c)) return;
    const r = MAPA.rows.find(x => x.cli === c);
    if (r) det.push(dadosDestino(c, r.dst));
  });
  const ufsProd = new Set(PROD.plants.map(p => p.uf));
  det.forEach(d => {
    if (!(d.cliente in ST.travas))
      ST.travas[d.cliente] = (/biopower/i.test(d.cliente) && ufsProd.has(d.uf)) ? d.uf : null;
  });
  det.sort((a, b) => a.cliente.localeCompare(b.cliente));
  NEC = det.map(d => ({ cliente: d.cliente, cidade: d.cidade, uf: d.uf,
    ton: +(ST.nec[d.cliente] || 0) }));
}

/* ====================== CÁLCULO ====================== */
function recalcular() {
  montarNec();
  MAPA.rows.forEach(r => { r.ofEdit = (r.i in ST.ofEdits) ? ST.ofEdits[r.i] : null; });
  MAPA_ROWS = MAPA.rows;
  DS = montar(PROD, NEC, MAPA);
  const otimo = resolver(DS, ST.travas, null, ST.modo);
  RES = resolver(DS, ST.travas, ST.manual, ST.modo);
  RES.alocFinal = RES.aloc;
  RES.otimoNet = otimo.net;
  // a alocacao otima inteira, nao so o total: e ela que o consolidado compara
  // contra o realizado para separar o efeito das trocas manuais
  RES.otimoAloc = otimo.aloc;
  RES.netFinal = RES.net;
  const usados = {};
  RES.aloc.forEach(a => (usados[a.sigla] || (usados[a.sigla] = [])).push(a.cli));
  OPS = opcoes(DS, ST.travas, 8, usados, ST.modo);
  render();
}

/* ====================== RENDER ====================== */
function render() {
  RASCUNHO_SUJO = true;
  carimbo();
  renderNecessidade();
  aplicarModo();  // depois da lista: o resumo conta as linhas ja renderizadas
  renderKpis();
  renderAvisos();
  renderMapa();
  renderTabela();
  if (UFSEL) renderDetalhe(UFSEL);
  else { const b = $('#detail'); b.classList.add('hide'); b.innerHTML = ''; }
  renderResumoSemana();
  persistir();
  atualizarCarimboRascunho();
}

// Mesma leitura de public/consolidado.html (cards, aviso, bloco por fabrica
// com veredito/frase, paragrafo-resumo), mas para a semana que esta na tela
// agora — antes de fechar, so com o que ja esta em memoria. A conta nao e
// duplicada: vem de montarSemana()+agregarSemana(), as mesmas do banco.
// Classes prefixadas com "rs-" de proposito: ui.js ja tem .pos/.neg com
// outro sentido (shell.html:190-191), entao nomes novos evitam colisao.
function renderResumoSemana() {
  const box = $('#resumoSemana');
  if (!box) return;
  const pac = montarSemana(PROD, RES.alocFinal, RES.otimoAloc, OPS, MAPA);
  if (!pac.linhas.length) { box.classList.add('hide'); box.innerHTML = ''; return; }
  const ag = agregarSemana(pac.linhas, pac.linhasOtimo, MAPA.rows);
  box.classList.remove('hide');

  const rs = v => v == null ? '—'
    : (v < 0 ? '−R$ ' : 'R$ ') + Math.round(Math.abs(v)).toLocaleString('pt-BR');
  const tn = v => v == null ? '—' : fmt1(v) + ' t';
  const pontoGrupo = cli => {
    if (/biopower/i.test(cli)) return '<span class="rs-selo rs-s-bio"></span>';
    if (/flora/i.test(cli)) return '<span class="rs-selo rs-s-flo"></span>';
    return '<span class="rs-selo rs-s-ter"></span>';
  };
  const blocoDuo = (cab, t, net, ter, sav) => {
    const f = v => v == null ? '—' : rs(v);
    let o = '<div><div class="rs-cab">' + cab + '</div>';
    o += '<div class="rs-lin"><span>Volume</span><span>' + (t > 0 ? tn(t) : '—') + '</span></div>';
    o += '<div class="rs-lin"><span>NET médio</span><span>' + f(net) + '</span></div>';
    o += '<div class="rs-lin"><span>Melhor terceiro</span><span>' + f(ter) + '</span></div>';
    o += '<div class="rs-lin rs-forte"><span>Diferença</span><span class="' +
      (sav == null ? '' : (sav < 0 ? 'rs-neg' : 'rs-pos')) + '">' +
      (sav == null ? '—' : (sav > 0 ? '+' : '') + rs(sav)) + '</span></div>';
    return o + '</div>';
  };

  const props = ag.porPropria, tot = ag.total;
  let savR = 0, savO = 0, temSavO = false;
  props.forEach(p => {
    if (p.saving_realizado != null) savR += p.saving_realizado;
    if (p.saving_otimo != null) { savO += p.saving_otimo; temSavO = true; }
  });
  const tProp = props.reduce((s, p) => s + p.ton_realizado, 0);
  const tTudo = tot.toneladas;
  const tTer = tTudo - tProp;
  const perdido = temSavO ? (savO - savR) : null;

  let h = '';
  h += '<h2>Resultado da semana em tela</h2>';
  h += '<p class="rs-nota">Isto é a semana que está na tela agora' +
    (ST.semana ? ' (Semana ' + fmt0(ST.semana) + ')' : '') +
    ' — não o mês fechado, e nada aqui foi salvo ainda. Feche a semana ' +
    'quando estiver de acordo.</p>';

  h += '<div class="rs-cards">';
  h += '<div class="rs-c"><div class="rs-lab">Volume da semana</div><div class="rs-big">' +
    tn(tTudo) + '</div></div>';
  h += '<div class="rs-c"><div class="rs-lab">Para fábrica própria</div><div class="rs-big">' +
    tn(tProp) + '</div><div class="rs-pe">' +
    (tTudo ? fmt1(tProp / tTudo * 100) + '% do total' : '—') + '</div></div>';
  h += '<div class="rs-c"><div class="rs-lab">Para terceiros</div><div class="rs-big">' +
    tn(tTer) + '</div><div class="rs-pe">NET médio geral ' + rs(tot.net_medio) + '</div></div>';
  h += '<div class="rs-c"><div class="rs-lab">Ganho sobre o mercado</div><div class="rs-big ' +
    (savR < 0 ? 'rs-neg' : 'rs-pos') + '">' + (savR > 0 ? '+' : '') + rs(savR) +
    '</div><div class="rs-pe">realizado, nas cargas que foram para própria</div></div>';
  h += '</div>';

  if (perdido != null && Math.abs(perdido) > 1) {
    h += '<div class="rs-aviso"><b>' + rs(Math.abs(perdido)) + '</b> ' +
      (perdido > 0
        ? 'é a diferença entre o que a alocação do modelo geraria e o que foi feito até agora ' +
          'nesta semana. Vem das trocas manuais de destino.'
        : 'foi ganho acima do que o modelo indicava, por trocas feitas na mão.') +
      '</div>';
  }

  props.forEach(p => {
    const tr = p.ton_realizado, to = p.ton_otimo;
    const sr = p.saving_realizado, so = p.saving_otimo;
    const dif = (so != null ? so : 0) - (sr != null ? sr : 0);
    let veredito = '', frase = '';
    if (tr === 0 && to === 0) {
      veredito = '<span class="rs-mute">não entrou na semana</span>';
      frase = 'Não recebeu carga, e o modelo também não mandaria nada para cá.';
    } else if (tr === 0) {
      veredito = '<span class="rs-neg">' + rs(Math.abs(dif)) + ' deixados na mesa</span>';
      frase = 'Não recebeu nada. O modelo mandaria <b>' + tn(to) + '</b> para cá.';
    } else if (to === 0) {
      veredito = (dif > 0 ? '<span class="rs-neg">custou ' + rs(dif) + '</span>'
                          : '<span class="rs-pos">acima do modelo</span>');
      frase = 'Recebeu <b>' + tn(tr) + '</b>, mas o modelo não mandaria nada para cá — ' +
        'para essas cargas havia terceiro pagando mais.';
    } else {
      const d = to - tr;
      veredito = Math.abs(dif) < 1 ? '<span class="rs-pos">no ponto</span>'
        : (dif > 0 ? '<span class="rs-neg">' + rs(dif) + ' deixados na mesa</span>'
                   : '<span class="rs-pos">+' + rs(-dif) + ' acima do modelo</span>');
      frase = 'Recebeu <b>' + tn(tr) + '</b>; o modelo mandaria <b>' + tn(to) + '</b>' +
        (Math.abs(d) < 0.5 ? ' — o mesmo volume.'
          : (d > 0 ? ' — <b>' + tn(d) + '</b> a mais do que recebeu.'
                   : ' — <b>' + tn(-d) + '</b> a menos do que recebeu.'));
    }
    h += '<div class="rs-fab' + (tr === 0 && to === 0 ? ' rs-sem' : '') + '">';
    h += '<div class="rs-top"><span class="rs-nome">' + pontoGrupo(p.cliente) + esc(p.cliente) +
      '</span><span class="rs-veredito">' + veredito + '</span></div>';
    h += '<div class="rs-frase">' + frase + '</div>';
    h += '<div class="rs-duo">';
    h += blocoDuo('O que foi feito', tr, p.net_realizado, p.net_ter_realizado, sr);
    h += blocoDuo('O que o modelo mandava', to, p.net_otimo, p.net_ter_otimo, so);
    h += '</div></div>';
  });

  const totO = props.reduce((s2, p) => s2 + p.ton_otimo, 0);
  h += '<div class="rs-resumo">Nesta semana, <b>' + tn(tProp) + '</b> foram para fábrica própria ' +
    'e rendem <b class="' + (savR < 0 ? 'rs-neg' : 'rs-pos') + '">' + (savR > 0 ? '+' : '') +
    rs(savR) + '</b> em relação ao que o mercado pagaria pelas mesmas cargas. A alocação do ' +
    'modelo mandaria <b>' + tn(totO) + '</b> e renderia <b class="rs-pos">+' + rs(savO) +
    '</b>.</div>';

  box.innerHTML = h;
}

function carimbo() {
  if (!ST) return;
  const sem = ST.semana ? 'Semana ' + fmt0(ST.semana) : 'Semana';
  $('#sub').textContent = sem + (ST.periodo ? ' · ' + ST.periodo : '') +
    (ST.dataMapa ? ' · cotações de ' + ST.dataMapa : '');
  $('#stamp').innerHTML = ST.salvoEm
    ? 'Última alteração<br><b>' + esc(ST.usuario) + '</b> · ' + esc(ST.salvoEm)
    : 'Operando agora<br><b>' + esc(ST.usuario) + '</b>';
  if ($('#who').value !== ST.usuario) {
    const o = [].find.call($('#who').options, x => x.value === ST.usuario);
    if (o) $('#who').value = ST.usuario;
  }
  $('#foot').textContent = RAW && RAW.arquivos
    ? 'Fontes: ' + Object.values(RAW.arquivos).join(' · ')
    : '';
}

function renderKpis() {
  const tot = RES.alocFinal.reduce((s, a) => s + a.ton, 0);
  const prop = RES.alocFinal.filter(a => a.prop).reduce((s, a) => s + a.ton, 0);
  const ter = tot - prop;
  const nTer = new Set(RES.alocFinal.filter(a => !a.prop).map(a => a.cli)).size;
  // fabricas que de fato receberam carga. Contar pelo volume digitado dava
  // zero no Mercado livre, onde ninguem digita volume.
  const nProp = new Set(RES.alocFinal.filter(a => a.prop).map(a => a.cli)).size;
  const k = [
    ['Toneladas da semana', fmt0(tot) + ' t', DS.plants.length + ' unidades produzindo'],
    ['Comprometido com fábrica própria', fmt0(prop) + ' t',
      nProp + (nProp === 1 ? ' fábrica' : ' fábricas') +
      ' · ' + fmt1(carretas(prop)) + ' carretas'],
    ['Excedente para terceiros', fmt0(ter) + ' t',
      nTer + (nTer === 1 ? ' cliente' : ' clientes') + ' · ' + fmt1(carretas(ter)) + ' carretas']
  ];
  $('#kpis').innerHTML = k.map(x =>
    '<div class="kpi"><div class="lb">' + x[0] + '</div>' +
    '<div class="vl num">' + x[1] + '</div><div class="sb">' + esc(x[2]) + '</div></div>').join('');
}

function renderAvisos() {
  let h = '';
  const semCotacao = c => !DS.quotes.some(q => q.cli === c);
  const faltasReais = RES.faltas.filter(f => !semCotacao(f.cliente));
  if (faltasReais.length) {
    h += '<div class="warn bad">Não deu para fechar o volume de <b>' +
      faltasReais.map(f => esc(f.cliente) + '</b> (' + fmt0(f.atendido) + ' t de ' + fmt0(f.pedido) + ' t)').join(', <b>') +
      '. Falta produção elegível — confira a trava de estado ou o volume pedido.</div>';
  }
  if (DS.naoMapeadas.length) {
    h += '<div class="warn">Não consegui identificar a unidade <b>' +
      DS.naoMapeadas.map(esc).join('</b>, <b>') + '</b> do Mapa de ofertas. ' +
      'Essas cotações ficaram de fora. Use a sigla de três letras para resolver.</div>';
  }
  if (RES.semTerceiro.length) {
    h += '<div class="warn">Sem nenhuma cotação de terceiro para <b>' +
      RES.semTerceiro.map(esc).join('</b>, <b>') + '</b>. O excedente dessas unidades só tem ' +
      'como ir para fábrica própria.</div>';
  }
  const semGeo = DS.plants.filter(p => !CIDADES[norm(p.cidade) + '|' + p.uf])
    .map(p => titulo(p.cidade));
  if (semGeo.length) {
    h += '<div class="warn">Não tenho a coordenada de <b>' +
      [...new Set(semGeo)].map(esc).join('</b>, <b>') + '</b>. No mapa ' +
      (semGeo.length > 1 ? 'essas unidades aparecem' : 'essa unidade aparece') +
      ' no centro do estado. Os números não são afetados.</div>';
  }
  if (MAPA.modalCol && !MAPA.modalCol.ok) {
    h += '<div class="warn bad">Não identifiquei a coluna de <b>CIF/FOB</b> no Mapa de ofertas' +
      (MAPA.modalCol.cabecalho ? ' (li a coluna "' + esc(MAPA.modalCol.cabecalho) + '")' : '') +
      '. O modal e a data de entrega vão sair em branco na programação.</div>';
  } else if (MAPA.modalCol && MAPA.modalCol.trocada) {
    h += '<div class="warn">A coluna de CIF/FOB do Mapa mudou de lugar. Identifiquei pelos ' +
      'valores, na coluna <b>' + esc(MAPA.modalCol.cabecalho || '(sem título)') + '</b>.</div>';
  }
  if (RES.sobra.length) {
    h += '<div class="warn bad">Sobrou volume sem destino em <b>' +
      RES.sobra.map(esc).join('</b>, <b>') + '</b>. Abra a unidade e distribua o que falta.</div>';
  }
  const semCot = NEC.filter(d => d.ton > 0 && semCotacao(d.cliente)).map(d => d.cliente);
  if (semCot.length) {
    h += '<div class="warn bad"><b>' + semCot.map(esc).join('</b>, <b>') +
      '</b> não tem nenhuma cotação no Mapa de ofertas, então não dá para alocar volume. ' +
      'Peça a inclusão da linha no Mapa.</div>';
  }
  if (RES.foraDeCotacao.length) {
    h += '<div class="warn bad">Sem cotação no Mapa para <b>' +
      RES.foraDeCotacao.map(esc).join('</b>, <b>') + '</b>.</div>';
  }
  if (ULT_EXPORT) {
    const t = ULT_EXPORT.transito;
    if (t.length) {
      const dias = t.map(x => x.dias);
      h += '<div class="warn">Programação exportada com <b>' + ULT_EXPORT.linhas +
        ' linhas</b>. Estimei a data de entrega de <b>' + t.length +
        '</b> cargas CIF, entre ' + Math.min.apply(null, dias) + ' e ' +
        Math.max.apply(null, dias) + ' dias de trânsito. FOB fica em branco.</div>';
    }
    if (ULT_EXPORT.semRota.length) {
      h += '<div class="warn bad">Não tenho a coordenada de <b>' +
        ULT_EXPORT.semRota.map(esc).join('</b>, <b>') +
        '</b>, então a data de entrega dessas cargas saiu em branco.</div>';
    }
  }
  const nMan = Object.keys(ST.manual).filter(s => (ST.manual[s] || []).length).length;
  if (nMan) {
    const perda = RES.otimoNet - RES.netFinal;
    h += '<div class="warn"><b>' + nMan + (nMan > 1 ? ' unidades estão' : ' unidade está') +
      '</b> fora da indicação do modelo. Isso custa <b>' + rs(perda) +
      '</b> de NET na semana. <button class="mini" onclick="zerarManual()">voltar ao ótimo</button></div>';
  }
  $('#avisos').innerHTML = h;
}

function zerarManual() { ST.manual = {}; EDIT = null; recalcular(); }

/* ---------- necessidade ---------- */
// No mercado livre nao ha volume a digitar: some a coluna de toneladas
// e o texto muda para explicar o que vai acontecer.
function aplicarModo() {
  const livre = ST.modo === 'mercado';
  $('#necBox').classList.toggle('mercado', livre);
  const r = $(livre ? '#modoMer' : '#modoPri');
  if (r) r.checked = true;
  const sub = $('#necSub');
  if (sub) sub.textContent = livre
    ? 'Nenhum destino tem prioridade. Cada um disputa com a cotação que tem no Mapa e o volume vai para o melhor NET por tonelada.'
    : 'Volume obrigatório de cada destino, em toneladas. Os preços continuam vindo do Mapa de ofertas.';
  // No mercado livre nao ha volume a digitar: a lista recolhe para poupar
  // espaco, mas continua a um clique — as travas fiscais valem nos dois modos.
  if (livre && ST.verDest == null) ST.verDest = false;
  if (!livre) ST.verDest = true;
  aplicarVerDest();
}

// Mostra ou esconde a lista de destinos, com a linha de resumo no lugar.
function aplicarVerDest() {
  const livre = ST.modo === 'mercado';
  const aberto = ST.verDest !== false;
  const box = $('#necBox');
  if (box) box.classList.toggle('recolhido', !aberto);
  const res = $('#necResumo');
  if (res) res.classList.toggle('hide', !livre);
  const b = $('#bVerDest');
  if (b) { b.textContent = aberto ? 'ocultar' : 'mostrar'; b.setAttribute('aria-expanded', aberto ? 'true' : 'false'); }
  const t = $('#necResumoTxt');
  if (t) {
    const n = NEC.length;
    const tr = NEC.filter(d => ST.travas[d.cliente]).length;
    t.textContent = n + (n === 1 ? ' destino' : ' destinos') +
      (tr ? ' · ' + tr + (tr === 1 ? ' trava fiscal ativa' : ' travas fiscais ativas') : '');
  }
}

function renderNecessidade() {
  let h = '';
  NEC.forEach(d => {
    const g = grupo(d.cliente);
    const car = carretas(d.ton);
    const quebr = d.ton > 0.01 && Math.abs(car - Math.round(car)) > 0.01;
    const tv = ST.travas[d.cliente];
    h += '<div class="nrow">' + selo(d.cliente, g) +
      '<span class="nm">' + esc(d.cliente) + '</span>' +
      '<span class="cd">' + esc(d.cidade || '') + (d.uf ? ' · ' + d.uf : '') + '</span>' +
      '<label class="tv"><input type="checkbox" data-tv="' + esc(d.cliente) + '"' +
      (tv ? ' checked' : '') + (d.uf ? '' : ' disabled') + '> só recebe de ' + (d.uf || '—') + '</label>' +
      '<input class="v" type="number" min="0" step="35" value="' + Math.round(d.ton) +
      '" data-nec="' + esc(d.cliente) + '" aria-label="volume de ' + esc(d.cliente) + '">' +
      '<span class="un">t</span>' +
      '<span class="cr' + (quebr ? ' bad' : '') + '">' +
      (d.ton > 0.01 ? fmt1(car) + ' carretas' + (quebr ? ' ⚠' : '') : '') + '</span>' +
      '<button class="x" data-tira="' + esc(d.cliente) + '" title="tirar da lista">×</button>' +
      '</div>';
  });
  $('#necRows').innerHTML = h;
  const tot = NEC.reduce((s2, d) => s2 + d.ton, 0);
  const prodTot = DS ? DS.plants.reduce((s2, p) => s2 + p.ton, 0) : 0;
  $('#necBox').classList.toggle('sujo', SUJO);
  $('#pend').classList.toggle('hide', !SUJO);
  $('#necTot').innerHTML = ST.modo === 'mercado'
    ? '<span class="dim">' + fmt0(prodTot) + ' t disputadas pelo melhor NET. Clique em Rodar.</span>'
    : (tot > 0
      ? '<b>' + fmt0(tot) + ' t</b> comprometidos · sobram ' + fmt0(prodTot - tot) + ' t para terceiros'
      : '<span class="dim">Digite o volume de cada destino e clique em Rodar.</span>');

  $$('[data-nec]').forEach(i => {
    i.oninput = () => {
      const v = parseFloat(i.value);
      ST.nec[i.dataset.nec] = isFinite(v) && v > 0 ? v : 0;
      marcarSujo();
    };
    i.onkeydown = e => { if (e.key === 'Enter') rodar(); };
  });
  $$('[data-tv]').forEach(c => c.onchange = () => {
    const d = NEC.find(x => x.cliente === c.dataset.tv);
    ST.travas[c.dataset.tv] = c.checked ? d.uf : null;
    aplicarVerDest();  // o resumo conta as travas ativas
    marcarSujo();
  });
  $$('[data-tira]').forEach(b => b.onclick = () => {
    const c = b.dataset.tira;
    ST.fora.push(c);
    ST.extras = ST.extras.filter(x => x !== c);
    delete ST.nec[c];
    rodar();
  });
}

function marcarSujo() {
  SUJO = true;
  $('#necBox').classList.add('sujo');
  $('#pend').classList.remove('hide');
  const tot = Object.keys(ST.nec).reduce((s2, c) =>
    s2 + (NEC.some(d => d.cliente === c) ? +ST.nec[c] || 0 : 0), 0);
  const prodTot = DS ? DS.plants.reduce((s2, p) => s2 + p.ton, 0) : 0;
  $('#necTot').innerHTML = ST.modo === 'mercado'
    ? '<span class="dim">' + fmt0(prodTot) + ' t disputadas pelo melhor NET. Clique em Rodar.</span>'
    : (tot > 0
      ? '<b>' + fmt0(tot) + ' t</b> comprometidos · sobram ' + fmt0(prodTot - tot) + ' t para terceiros'
      : '<span class="dim">Digite o volume de cada destino e clique em Rodar.</span>');
  persistir();
}

function rodar() {
  SUJO = false; EDIT = null;
  recalcular();
  $('#kpis').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function ligarAddNec() {
  $('#bRodar').onclick = rodar;
  $$('input[name=modo]').forEach(r => {
    r.onchange = () => {
      if (!r.checked) return;
      ST.modo = r.value;
      aplicarModo();
      rodar();
    };
  });
  const bv = $('#bVerDest');
  if (bv) bv.onclick = () => { ST.verDest = ST.verDest === false; aplicarVerDest(); };
  $('#bAddNec').onclick = () => {
    // acrescentar terceiro com a lista recolhida: abre a lista junto
    if (ST.verDest === false) { ST.verDest = true; aplicarVerDest(); }
    const cx = $('#addNec'), sel = $('#selNec');
    const usados = NEC.map(d => d.cliente);
    sel.innerHTML = clientesDoMapa(MAPA).filter(c => usados.indexOf(c.cliente) < 0)
      .map(c => '<option value="' + esc(c.cliente) + '">' + esc(c.cliente) + '</option>').join('');
    cx.classList.toggle('hide');
  };
  $('#bAddNo').onclick = () => $('#addNec').classList.add('hide');
  $('#bAddOk').onclick = () => {
    const c = $('#selNec').value;
    if (c) {
      ST.fora = ST.fora.filter(x => x !== c);
      if (ST.extras.indexOf(c) < 0) ST.extras.push(c);
      ST.nec[c] = ST.nec[c] || 0;
    }
    $('#addNec').classList.add('hide');
    rodar();
  };
}

/* ---------- mapa ---------- */
function ponto(cidade, uf) {
  const p = CIDADES[norm(cidade) + '|' + uf];
  if (p) return { x: p[0], y: p[1] };
  const s = STATES[uf];
  return s ? { x: +s.cx, y: +s.cy, aprox: true } : null;
}

function nomeCurto(cliente, cidade) {
  const base = cliente.replace(/^JBS\s*-\s*/, '').trim();
  if (!cidade) return base;
  if (norm(base).indexOf(norm(cidade)) >= 0) return base;
  return base.split(/[\s-]/)[0] + ' ' + cidade;
}

function marcadores() {
  const itens = [];
  DS.plants.forEach(p => {
    const q = ponto(p.cidade, p.uf);
    if (!q) return;
    itens.push({
      tipo: 'un', x: q.x, y: q.y, aprox: q.aprox, uf: p.uf, g: 'jbs',
      nome: p.sigla, det: titulo(p.cidade) + ' · ' + fmt0(p.ton) + ' t', ton: p.ton
    });
  });
  NEC.forEach(d => {
    const q = ponto(d.cidade, d.uf);
    if (!q) return;
    itens.push({
      tipo: 'dest', x: q.x, y: q.y, aprox: q.aprox, uf: d.uf, g: grupo(d.cliente),
      nome: nomeCurto(d.cliente, d.cidade), cliente: d.cliente,
      det: d.ton > 0 ? fmt0(d.ton) + ' t na semana' : 'sem volume nesta semana'
    });
  });
  // separa os que caem no mesmo ponto
  const grupos = {};
  itens.forEach(i => {
    const k = Math.round(i.x) + ',' + Math.round(i.y);
    (grupos[k] || (grupos[k] = [])).push(i);
  });
  Object.keys(grupos).forEach(k => {
    const g = grupos[k];
    if (g.length < 2) return;
    const raio = 4 + g.length;
    g.forEach((i, n) => {
      const a = -Math.PI / 2 + n * 2 * Math.PI / g.length;
      i.x += Math.cos(a) * raio; i.y += Math.sin(a) * raio;
    });
  });
  return itens;
}

function valorUF(uf) {
  return DS.plants.filter(p => p.uf === uf).reduce((s, p) => s + p.ton, 0) || null;
}

function renderMapa() {
  const porUF = {};
  Object.keys(STATES).forEach(uf => porUF[uf] = valorUF(uf));
  let h = '';
  Object.keys(STATES).forEach(uf => {
    const s = STATES[uf], ativo = porUF[uf] != null;
    h += '<path class="uf' + (ativo ? '' : ' off') + (uf === UFSEL ? ' sel' : '') +
      '" d="' + s.d + '" data-uf="' + uf + '"' + (ativo ? ' fill="var(--c1)"' : '') + '></path>';
  });
  h += arcosSvg();
  Object.keys(STATES).forEach(uf => {
    if (porUF[uf] == null) return;
    const s = STATES[uf];
    h += '<text class="lb" x="' + s.cx + '" y="' + s.cy + '">' + uf + '</text>';
  });

  const itens = marcadores();
  const raio = t => 2.4 + Math.sqrt(t / 35) * 1.4;
  itens.filter(i => i.tipo === 'un').forEach((i, k) => {
    h += '<circle class="mk un' + (UFSEL && i.uf !== UFSEL ? ' fora' : '') + '" data-mk="' + k +
      '" cx="' + i.x.toFixed(1) + '" cy="' + i.y.toFixed(1) + '" r="' + raio(i.ton).toFixed(1) + '"></circle>';
  });
  const dests = itens.filter(i => i.tipo === 'dest');
  dests.forEach((i, k) => {
    h += '<circle class="mk dest ' + i.g + '" data-dk="' + k + '" cx="' + i.x.toFixed(1) +
      '" cy="' + i.y.toFixed(1) + '" r="6"></circle>';
  });
  // rótulos à direita, empilhados para não se sobreporem
  const rot = dests.map((i, k) => ({ i: i, k: k, y: i.y + 14 }))
    .sort((a, b) => a.y - b.y);
  for (let j = 1; j < rot.length; j++) {
    if (Math.abs(rot[j].i.x - rot[j - 1].i.x) > 60) continue;
    if (rot[j].y - rot[j - 1].y < 11) rot[j].y = rot[j - 1].y + 11;
  }
  rot.forEach(r => {
    const x = r.i.x + 10, y = r.y;
    h += '<path class="guia" d="M' + r.i.x.toFixed(1) + ' ' + (r.i.y + 6).toFixed(1) +
      'L' + r.i.x.toFixed(1) + ' ' + (y - 3.5).toFixed(1) + 'L' + x.toFixed(1) + ' ' +
      (y - 3.5).toFixed(1) + '"></path>' +
      '<text class="dlb" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '">' +
      esc(r.i.nome) + '</text>';
  });

  const map = $('#map');
  map.innerHTML = h;
  const t = $('#tip');
  const some = () => t.style.opacity = 0;
  map.querySelectorAll('path.uf:not(.off)').forEach(p => {
    p.onclick = () => { UFSEL = (UFSEL === p.dataset.uf ? null : p.dataset.uf); EDIT = null; render(); };
    p.onmouseenter = e => tip(e, p.dataset.uf, porUF[p.dataset.uf]);
    p.onmousemove = e => tip(e, p.dataset.uf, porUF[p.dataset.uf]);
    p.onmouseleave = some;
  });
  const uns = itens.filter(i => i.tipo === 'un');
  const liga = (sel, lista) => map.querySelectorAll(sel).forEach(el => {
    const i = lista[+(el.dataset.mk != null ? el.dataset.mk : el.dataset.dk)];
    const texto = i.nome + ' · ' + i.det + (i.aprox ? ' · posição aproximada' : '');
    el.onmouseenter = e => tipTxt(e, texto);
    el.onmousemove = e => tipTxt(e, texto);
    el.onmouseleave = some;
    el.onclick = () => { UFSEL = (UFSEL === i.uf ? null : i.uf); EDIT = null; render(); };
  });
  liga('circle.mk.un', uns);
  liga('circle.mk.dest', dests);

  const tons = uns.map(i => i.ton);
  const mn = Math.min.apply(null, tons), mx = Math.max.apply(null, tons);
  $('#legend').innerHTML =
    '<svg class="lgd" viewBox="0 0 44 20" aria-hidden="true">' +
    '<circle cx="8" cy="12" r="' + raio(mn).toFixed(1) + '"></circle>' +
    '<circle cx="30" cy="12" r="' + raio(mx).toFixed(1) + '"></circle></svg>' +
    '<span>' + fmt0(mn) + ' a ' + fmt0(mx) + ' t por unidade</span>' +
    '<i class="dot jbs"></i><span>Friboi</span>' +
    '<i class="dot bio"></i><span>BioPower</span>' +
    '<i class="dot flo"></i><span>Flora</span>';
}

function tipTxt(e, txt) {
  const t = $('#tip'), box = $('.mapbox').getBoundingClientRect();
  t.textContent = txt;
  t.style.left = (e.clientX - box.left + 12) + 'px';
  t.style.top = (e.clientY - box.top + 12) + 'px';
  t.style.opacity = 1;
}

function tip(e, uf, v) {
  const t = $('#tip'), box = $('.mapbox').getBoundingClientRect();
  t.textContent = uf + (v != null ? ' · ' + fmt0(v) + ' t' : '');
  t.style.left = (e.clientX - box.left + 12) + 'px';
  t.style.top = (e.clientY - box.top + 12) + 'px';
  t.style.opacity = 1;
}

function arcosSvg() {
  const cor = { bio: 'var(--bio)', flo: 'var(--flora)' };
  const pos = {};
  DS.plants.forEach(p => pos[p.sigla] = ponto(p.cidade, p.uf));
  const dest = {};
  NEC.forEach(d => dest[d.cliente] = ponto(d.cidade, d.uf));
  let h = '';
  RES.alocFinal.forEach(a => {
    if (!a.prop) return;
    const A = pos[a.sigla], B = dest[a.cli];
    if (!A || !B) return;
    if (Math.abs(A.x - B.x) < 2 && Math.abs(A.y - B.y) < 2) return;
    const mx = (A.x + B.x) / 2 + (B.y - A.y) * .16, my = (A.y + B.y) / 2 - (B.x - A.x) * .16;
    const d = 'M' + A.x.toFixed(0) + ' ' + A.y.toFixed(0) + 'Q' + mx.toFixed(0) + ' ' +
      my.toFixed(0) + ' ' + B.x.toFixed(0) + ' ' + B.y.toFixed(0);
    const apaga = UFSEL && a.uf !== UFSEL ? ' fora' : '';
    h += '<path class="arc' + apaga + '" d="' + d + '" stroke="' + cor[grupo(a.cli)] + '"></path>';
  });
  return h;
}

/* ---------- tabela por estado ---------- */
function renderTabela() {
  const ufs = [...new Set(DS.plants.map(p => p.uf))].sort();
  let h = '<thead><tr><th>Estado</th><th>Unid.</th><th>Produção</th>' +
    '<th>Fábrica própria</th><th>Terceiros</th></tr></thead><tbody>';
  ufs.forEach(uf => {
    const plantas = DS.plants.filter(p => p.uf === uf);
    const prod = plantas.reduce((s, p) => s + p.ton, 0);
    const linhas = RES.alocFinal.filter(a => a.uf === uf);
    const pp = linhas.filter(a => a.prop).reduce((s, a) => s + a.ton, 0);
    const tt = linhas.filter(a => !a.prop).reduce((s, a) => s + a.ton, 0);
    const cel = v => v > 0.01 ? fmt0(v) + ' t' : '<span class="dim">—</span>';
    h += '<tr data-uf="' + uf + '"' + (uf === UFSEL ? ' class="sel"' : '') + '>' +
      '<td><b>' + uf + '</b></td>' +
      '<td class="num dim">' + plantas.length + '</td>' +
      '<td class="num">' + fmt0(prod) + ' t</td>' +
      '<td class="num">' + cel(pp) + '</td>' +
      '<td class="num">' + cel(tt) + '</td></tr>';
  });
  $('#tblUF').innerHTML = h + '</tbody>';
  $$('#tblUF tbody tr').forEach(tr => tr.onclick = () => {
    UFSEL = (UFSEL === tr.dataset.uf ? null : tr.dataset.uf); EDIT = null; render();
    if (UFSEL) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ---------- detalhe do estado ---------- */
function renderDetalhe(uf) {
  const box = $('#detail'); box.classList.remove('hide');
  const plantas = DS.plants.filter(p => p.uf === uf);
  const prod = plantas.reduce((s, p) => s + p.ton, 0);
  const linhas = RES.alocFinal.filter(a => a.uf === uf);

  let h = '<div class="dhead"><h2>' + uf + '</h2><span class="sub">' +
    fmt0(prod) + ' t em ' + plantas.length + (plantas.length > 1 ? ' unidades' : ' unidade') +
    ' · ' + fmt1(carretas(prod)) + ' carretas</span></div>';

  const dest = {};
  linhas.forEach(a => dest[a.cli] = (dest[a.cli] || 0) + a.ton);
  const ord = Object.keys(dest).sort((a, b) => dest[b] - dest[a]);
  h += '<div class="cmp">';
  ord.forEach(cli => {
    const g = grupo(cli);
    h += '<div class="cbox ' + g + '">' + selo(cli, g) +
      '<div class="nm">' + esc(cli) + '</div>' +
      '<div class="vl num">' + fmt0(dest[cli]) + ' t</div>' +
      '<div class="sb">' + fmt1(carretas(dest[cli])) + ' carretas · ' +
      (g === 'ter' ? 'terceiro' : 'fábrica própria') + '</div></div>';
  });
  h += '</div>';

  h += '<div class="orig">' + img(LOGOS.friboi, 'lgo') +
    '<h3>Para onde vai cada unidade</h3></div>';
  plantas.forEach(p => {
    const linhas = RES.alocFinal.filter(a => a.sigla === p.sigla);
    h += '<div class="plant"><div class="prow">' +
      '<span class="sg">' + p.sigla + '</span>' +
      '<span class="cd">' + esc(titulo(p.cidade)) + '</span>' +
      '<span class="tn num">' + fmt0(p.ton) + ' t</span>' +
      ((OPS[p.sigla] || []).length
        ? '<button class="mini" data-ed="' + p.sigla + '">' +
        (EDIT === p.sigla ? 'fechar' : 'trocar destino') + '</button>' : '') +
      '</div>';
    linhas.forEach(a => {
      const g = grupo(a.cli);
      h += '<div class="dest"><span class="dot ' + g + '"></span>' +
        '<span class="nm">' + esc(a.cli) + (a.man ? ' <span class="tagm">alterado</span>' : '') + '</span>' +
        '<span class="mn num">' + rs(a.net) + '/t</span>' +
        '<span class="tn num">' + fmt0(a.ton) + ' t</span></div>';
    });
    if (EDIT === p.sigla) h += editorHtml(p.sigla, p.ton);
    h += '</div>';
  });

  box.innerHTML = h;
  $$('[data-ed]').forEach(b => b.onclick = () => {
    EDIT = (EDIT === b.dataset.ed ? null : b.dataset.ed); renderDetalhe(uf);
  });
  ligarEditor(uf);
}

function titulo(s) {
  return String(s).toLowerCase().replace(/(^|[ '-])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase());
}

/* ---------- editor de terceiros ---------- */
function editorHtml(sigla, total) {
  const ops = OPS[sigla] || [];
  const best = ops.length ? ops[0].net : 0;
  const atual = ST.manual[sigla];
  const volDe = cli => {
    if (atual) { const m = atual.find(x => x.cli === cli); return m ? m.ton : 0; }
    const a = RES.alocFinal.find(x => x.sigla === sigla && x.cli === cli);
    return a ? a.ton : 0;
  };
  let h = '<div class="editor"><h4>Destinos de ' + sigla + ' — ' + fmt0(total) + ' t na semana</h4>' +
    '<p class="hint">Todas as ofertas para esta unidade, ranqueadas por NET. Ajuste os volumes ' +
    'até fechar o total. O que você fixar aqui vira regra, e o modelo redistribui o resto. ' +
    'Carreta cheia = 35 t.</p>';
  ops.forEach((o, i) => {
    const v = volDe(o.cli);
    const car = carretas(v);
    const quebr = v > 0.01 && Math.abs(car - Math.round(car)) > 0.01;
    const linhaMapa = MAPA.rows[o.src];
    const ofAtual = linhaMapa.ofEdit != null ? linhaMapa.ofEdit : linhaMapa.of;
    h += '<div class="opt' + (v > 0.01 ? '' : ' off') + '">' +
      '<span class="rk">' + (i + 1) + '</span>' +
      '<span class="dot ' + grupo(o.cli) + '"></span>' +
      '<span class="nm">' + esc(o.cli) + '</span>' +
      '<span class="nt num">' + rs(o.net) + '</span>' +
      '<span class="gp num">' + (i ? '−' + fmt0(best - o.net) : '') + '</span>' +
      '<input class="of num" type="number" step="10" value="' + Math.round(ofAtual) +
      '" data-of="' + o.src + '" title="oferta na planilha">' +
      '<input class="vol num" type="number" min="0" step="35" value="' + Math.round(v) +
      '" data-vol="' + esc(o.cli) + '">' +
      '<span class="cr' + (quebr ? ' bad' : '') + '">' + (v > 0.01 ? fmt1(car) + ' carretas' + (quebr ? ' ⚠' : '') : '') + '</span>' +
      '</div>';
  });
  const soma = ops.reduce((s, o) => s + volDe(o.cli), 0);
  const dif = total - soma;
  h += '<div class="edfoot">';
  if (Math.abs(dif) > 0.01) h += '<span class="rest">' +
    (dif > 0 ? 'falta destinar ' + fmt0(dif) + ' t' : 'passou ' + fmt0(-dif) + ' t do que a unidade produz') +
    '</span>';
  h += '<button class="mini" data-reset="' + sigla + '">voltar à indicação</button>';
  h += '<span class="dim">a oferta em azul recalcula o NET e refaz a alocação</span></div></div>';
  return h;
}

function ligarEditor(uf) {
  $$('[data-vol]').forEach(inp => inp.onchange = () => {
    const sigla = EDIT, ops = OPS[sigla] || [];
    const cur = {};
    ops.forEach(o => {
      const el = document.querySelector('[data-vol="' + CSS.escape(o.cli) + '"]');
      cur[o.cli] = el ? (parseFloat(el.value) || 0) : 0;
    });
    ST.manual[sigla] = ops.map(o => ({ cli: o.cli, ton: cur[o.cli] })).filter(x => x.ton > 0.01);
    recalcular();
  });
  $$('[data-of]').forEach(inp => inp.onchange = () => {
    const i = +inp.dataset.of, v = parseFloat(inp.value);
    if (isFinite(v) && v > 0) ST.ofEdits[i] = v; else delete ST.ofEdits[i];
    recalcular();
  });
  $$('[data-reset]').forEach(b => b.onclick = () => {
    delete ST.manual[b.dataset.reset]; recalcular();
  });
}

/* ====================== SALVAR / DISTRIBUIR ====================== */
function b64(buf) {
  const d = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
  return btoa(s);
}

function deB64(s) {
  const bin = atob(s), d = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
  return d.buffer;
}

function agora() {
  const d = new Date();
  return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function persistir() {
  try { localStorage.setItem('sebo_estado', JSON.stringify(ST)); } catch (e) { }
}

async function exportarProg() {
  const b = $('#bProg');
  const txt = b.textContent;
  b.disabled = true; b.textContent = 'montando…';
  try {
    const r = await programacaoPreenchida(PROGBUF, PROD, RES.alocFinal, OPS, MAPA.data, MAPA.dataSerial);
    ULT_EXPORT = r;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(r.arquivo);
    a.download = 'Programacao_preenchida_semana_' + (ST.semana || 'x') + '.xlsx';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  } catch (e) {
    alert('Não consegui montar a planilha: ' + e.message);
  }
  b.disabled = false; b.textContent = txt;
  if (ULT_EXPORT) renderAvisos();
}

// Pacote com tudo que precisa para reabrir o painel do zero: as duas
// planilhas e o progresso. persistirDados() usa isso para o localStorage;
// salvarRascunho() manda o mesmo pacote para o servidor.
function montarPacoteDados() {
  return {
    prod: PROD, progb64: PROGBUF ? b64(PROGBUF) : null,
    mapa: { rows: MAPA.rows.map(r => { const c = Object.assign({}, r); delete c.ofEdit; return c; }), data: MAPA.data },
    estado: ST, arquivos: RAW ? RAW.arquivos : {}
  };
}

// Planilhas pesadas: gravadas uma vez por import/restauracao, nunca a cada
// tecla. ST continua leve em sebo_estado, gravado a cada mudanca por
// persistir() (chamado em todo render()).
function persistirDados() {
  try {
    localStorage.setItem('sebo_dados', JSON.stringify(montarPacoteDados()));
  } catch (e) {
    // cota estourada ou erro de serializacao: sem dado pesado salvo, o
    // painel so vai pedir import de novo na proxima vez — nunca quebra.
    try { localStorage.removeItem('sebo_dados'); } catch (e2) { }
  }
}

/* ====================== RASCUNHO NO SERVIDOR ====================== */
var RASCUNHO_SALVO_EM = null, RASCUNHO_SALVO_POR = null, RASCUNHO_SUJO = false;

const fmtHora = iso => new Date(iso).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDataHora = iso => new Date(iso).toLocaleString('pt-BR',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function atualizarCarimboRascunho() {
  const el = document.getElementById('msgSalvar');
  if (!el) return;
  if (RASCUNHO_SUJO) {
    el.className = 'fechamsg ruim';
    el.textContent = 'há alterações não salvas';
  } else if (RASCUNHO_SALVO_EM) {
    el.className = 'fechamsg';
    el.textContent = 'salvo por ' + (RASCUNHO_SALVO_POR || '—') + ' às ' + fmtHora(RASCUNHO_SALVO_EM);
  } else {
    el.className = 'fechamsg';
    el.textContent = '';
  }
}

async function salvarRascunho() {
  const bt = document.getElementById('bSave');
  // ano/semana vem da Programacao, nao da alocacao: Salvar funciona a
  // qualquer momento depois do import, mesmo antes de rodar.
  const ano = anoDaSemana(PROD), semana = Number(PROD.semana);
  const dados = montarPacoteDados();
  bt.disabled = true;
  try {
    const enviar = forcar => fetch('/api/rascunho', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ano, semana, dados, baseSalvoEm: RASCUNHO_SALVO_EM, forcar })
    });
    let r = await enviar(false);
    if (r.status === 409) {
      const j = await r.json();
      // Duas pessoas mexendo na mesma semana e cenario real: avisa quem
      // salvou por ultimo em vez de gravar por cima calado.
      if (!confirm((j.salvoPor || 'Alguém') + ' salvou por último às ' + fmtHora(j.salvoEm) +
          '.\n\nSobrescrever mesmo assim?')) return;
      r = await enviar(true);
    }
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || 'Não consegui salvar.');
    if (!ST) return;  // a sessao foi zerada (Nova semana) enquanto isto estava no ar
    RASCUNHO_SALVO_EM = j.salvoEm; RASCUNHO_SALVO_POR = j.salvoPor; RASCUNHO_SUJO = false;
    ST.usuario = $('#who').value; ST.salvoEm = agora();
    persistir(); carimbo(); atualizarCarimboRascunho();
  } catch (e) {
    erro('Não consegui salvar no servidor: ' + e.message);
  } finally {
    bt.disabled = false;
  }
}

async function carregarListaRascunhos() {
  try {
    const r = await fetch('/api/rascunhos');
    if (!r.ok) return null;
    const lista = await r.json();
    renderRascunhos(lista);
    return lista;
  } catch (e) { return null; }
}

function renderRascunhos(lista) {
  const box = document.getElementById('rascunhosBox');
  const ul = document.getElementById('rascunhosList');
  if (!box || !ul) return;
  if (!lista || !lista.length) { box.classList.add('hide'); ul.innerHTML = ''; return; }
  box.classList.remove('hide');
  ul.innerHTML = lista.map(r =>
    '<div class="rascunho">' +
      '<button class="rascunho-abrir" data-ano="' + r.ano + '" data-semana="' + r.semana + '">' +
        'Semana ' + r.semana + '/' + r.ano + ' — salvo por ' + esc(r.salvo_por || '—') +
        ' às ' + esc(fmtDataHora(r.salvo_em)) +
      '</button>' +
      '<button class="rascunho-descartar" data-ano="' + r.ano + '" data-semana="' + r.semana + '" ' +
        'title="Apagar este rascunho do servidor">descartar</button>' +
    '</div>'
  ).join('');
  [].forEach.call(ul.querySelectorAll('.rascunho-abrir'), b => {
    b.onclick = () => carregarRascunho(Number(b.dataset.ano), Number(b.dataset.semana));
  });
  [].forEach.call(ul.querySelectorAll('.rascunho-descartar'), b => {
    b.onclick = () => descartarRascunho(Number(b.dataset.ano), Number(b.dataset.semana));
  });
}

async function descartarRascunho(ano, semana) {
  if (!confirm('Apagar o rascunho da semana ' + semana + '/' + ano +
      ' salvo no servidor? Isso não pode ser desfeito.')) return;
  try {
    const r = await fetch('/api/rascunho?ano=' + ano + '&semana=' + semana, { method: 'DELETE' });
    if (!r.ok) { erro('Não consegui apagar esse rascunho.'); return; }
  } catch (e) { erro('Não consegui apagar esse rascunho: ' + e.message); return; }
  carregarListaRascunhos();
}

// Volta pra tela de importacao sem mexer no rascunho do servidor — esse
// continua intacto, disponivel pra retomar dali a pouco ou depois. So zera
// o que esta em memoria e no localStorage. Sem location.reload(): assim
// boot() (e o auto-carregamento) nao rodam de novo agora — so no proximo
// carregamento de verdade da pagina, quando o rascunho ainda vai estar la
// pra quem quiser retomar. Como a pagina nao recarrega, #bSave/#bProg/
// #bNovaSemana (que ficam fora de #app, continuam clicaveis) voltam a
// ficar disabled — sem isso, clicar neles depois leria PROD/RAW/OPS nulos.
function novaSemana() {
  if (RASCUNHO_SUJO && !confirm(
    'Você tem alterações não salvas nesta semana — elas serão perdidas. Continuar mesmo assim?'
  )) return;
  try { localStorage.removeItem('sebo_estado'); } catch (e) { }
  try { localStorage.removeItem('sebo_dados'); } catch (e) { }
  PROD = null; MAPA = null; PROGBUF = null; ST = null;
  RES = null; DS = null; OPS = null; NEC = null; RAW = null;
  arquivos = {};
  RASCUNHO_SALVO_EM = null; RASCUNHO_SALVO_POR = null; RASCUNHO_SUJO = false;
  $('#bSave').disabled = true; $('#bProg').disabled = true; $('#bNovaSemana').disabled = true;
  $('#sub').textContent = ''; $('#stamp').innerHTML = ''; $('#foot').textContent = '';
  $('#app').classList.add('hide');
  $('#importBox').classList.remove('hide');
  carregarListaRascunhos();  // atualiza a lista (pode ter mudado nesta sessao)
}

async function carregarRascunho(ano, semana) {
  try {
    const r = await fetch('/api/rascunho?ano=' + ano + '&semana=' + semana);
    if (!r.ok) { erro('Não consegui abrir esse rascunho.'); return; }
    const j = await r.json();
    const b = j.dados;
    PROD = b.prod; MAPA = b.mapa; ST = b.estado; arquivos = b.arquivos || {};
    if (b.progb64) PROGBUF = deB64(b.progb64);
    MAPA.rows.forEach((r2, i) => r2.i = i);
    RASCUNHO_SALVO_EM = j.salvoEm; RASCUNHO_SALVO_POR = j.salvoPor;
    iniciar(true);
  } catch (e) { erro('Não consegui abrir esse rascunho: ' + e.message); }
}

/* ====================== BOOT ====================== */
async function boot() {
  $('#lgFriboi').src = 'data:image/png;base64,' + LOGOS.friboi.b64;
  $('#lgBio').src = 'data:image/png;base64,' + LOGOS.biopower.b64;
  $('#lgFlora').src = 'data:image/png;base64,' + LOGOS.flora.b64;
  setupImport();
  ligarAddNec();
  const bd = document.getElementById('bd');
  const txt = bd && bd.textContent.trim();
  if (txt) {
    const b = JSON.parse(txt);
    PROD = b.prod; MAPA = b.mapa; ST = b.estado; arquivos = b.arquivos || {};
    if (b.progb64) PROGBUF = deB64(b.progb64);
    MAPA.rows.forEach((r, i) => r.i = i);
    iniciar(true);  // arquivo ja distribuido: nao regravar sebo_dados
    return;
  }
  try {
    const s = localStorage.getItem('sebo_estado');
    if (s) ST = JSON.parse(s);
  } catch (e) { }
  // sem arquivo distribuido: tenta voltar de onde parou com o que foi
  // salvo no ultimo import. Qualquer erro aqui (cota do localStorage, dado
  // corrompido) so faz cair na tela de importacao normalmente — nunca
  // deixa o painel quebrado por causa disso.
  let restaurouLocal = false;
  try {
    const d = localStorage.getItem('sebo_dados');
    if (d) {
      const b = JSON.parse(d);
      PROD = b.prod; MAPA = b.mapa; arquivos = b.arquivos || {};
      if (b.progb64) PROGBUF = deB64(b.progb64);
      MAPA.rows.forEach((r, i) => r.i = i);
      iniciar(true);  // restauracao: nao regravar sebo_dados
      restaurouLocal = true;
    }
  } catch (e) {
    try { localStorage.removeItem('sebo_estado'); } catch (e2) { }
    try { localStorage.removeItem('sebo_dados'); } catch (e2) { }
  }
  // localStorage e rede de seguranca da maquina local; o servidor e a
  // fonte que a equipe compartilha. A lista sempre popula a tela de
  // importacao; se nao tinha nada local, carrega o rascunho mais recente
  // do servidor sozinho.
  const lista = await carregarListaRascunhos();
  if (!restaurouLocal && lista && lista.length) {
    await carregarRascunho(lista[0].ano, lista[0].semana);
  }
}

function arrancar() {
  boot();
}
if (!window.CSS || !CSS.escape) {
  window.CSS = window.CSS || {};
  CSS.escape = s => String(s).replace(/[^a-zA-Z0-9_\u00a0-\uffff-]/g, c => '\\' + c);
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', arrancar);
else arrancar();
