// caminhos relativos a esta pasta, funciona em qualquer maquina
process.chdir(__dirname);
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(PAINEL, 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x/' });
const w = dom.window;
w.DecompressionStream = DecompressionStream;
w.CompressionStream = CompressionStream;
w.Response = Response;
w.Blob = Blob;
w.URL.createObjectURL = () => 'blob:x';
w.URL.revokeObjectURL = () => { };
w.HTMLElement.prototype.scrollIntoView = function () { };w.Element.prototype.scrollIntoView = function () { };

const baixados = [];
const origCreate = w.document.createElement.bind(w.document);
w.document.createElement = function (t) {
  const el = origCreate(t);
  if (t === 'a') el.click = function () { baixados.push({ nome: el.download, href: el.href }); };
  return el;
};

function fake(name, path) {
  const b = fs.readFileSync(path);
  return {
    name,
    arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    text: async () => b.toString('utf8')
  };
}

const CSSesc = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
const T = (nome, cond, extra) => console.log((cond ? '  ok  ' : '  FALHA ') + nome + (extra ? ' — ' + extra : ''));

(async () => {
  await new Promise(r => setTimeout(r, 60));
  console.log('carregou:', !!w.readXlsx, '| logo no topo:', (w.document.querySelector('#lgFriboi').src || '').slice(0, 22));

  await w.receber('prog', fake('prog.xlsx', 'in/prog3.xlsx'));
  await w.receber('mapa', fake('mapa.xlsx', 'in/mapa.xlsx'));
  await new Promise(r => setTimeout(r, 120));

  const d = w.document;
  T('painel abriu com duas planilhas', !d.querySelector('#app').classList.contains('hide'));
  T('caixa de importação fechou', d.querySelector('#importBox').classList.contains('hide'));

  // ---- necessidade digitada
  const nrows = [...d.querySelectorAll('.nrow')];
  console.log('\nfábricas próprias detectadas no Mapa:');
  nrows.forEach(r => console.log('   ', r.querySelector('.nm').textContent,
    '|', r.querySelector('.cd').textContent,
    '| trava:', r.querySelector('[data-tv]').checked));
  T('5 fábricas próprias, com a Mafra', nrows.length === 5, nrows.length + '');
  T('todas começam em zero', nrows.every(r => r.querySelector('.v').value === '0'));
  T('trava só nas BioPower de estado com produção',
    nrows.filter(r => r.querySelector('[data-tv]').checked).length === 2);
  T('Mafra entra sem trava e sem volume',
    nrows.some(r => /Mafra/.test(r.querySelector('.nm').textContent) &&
      !r.querySelector('[data-tv]').checked && r.querySelector('.v').value === '0'));
  T('logo em cada linha', nrows.every(r => !!r.querySelector('img')));
  console.log('rodapé:', d.querySelector('#necTot').textContent);
  const vol = { 'JBS - BioPower Lins': 1050, 'JBS - BioPower Campo Verde': 1540,
    'Flora SP': 300, 'Flora GO': 1000 };
  for (const c in vol) {
    const i = d.querySelector('[data-nec="' + CSSesc(c) + '"]');
    i.value = vol[c]; i.dispatchEvent(new w.Event('input'));
  }
  T('avisa que há alteração pendente', !d.querySelector('#pend').classList.contains('hide'));
  T('KPI ainda não mudou antes de rodar',
    d.querySelectorAll('.kpi .vl')[1].textContent.trim().indexOf('0 t') === 0,
    d.querySelectorAll('.kpi .vl')[1].textContent);
  d.querySelector('#bRodar').click();
  await new Promise(r => setTimeout(r, 60));
  T('some o aviso depois de rodar', d.querySelector('#pend').classList.contains('hide'));
  console.log('rodapé:', d.querySelector('#necTot').textContent);
  T('rodapé fecha 3.890 / 2.025', d.querySelector('#necTot').textContent.indexOf('3.890') >= 0 &&
    d.querySelector('#necTot').textContent.indexOf('2.025') > 0);
  const kpis = [...d.querySelectorAll('.kpi')].map(k =>
    k.querySelector('.lb').textContent + ' = ' + k.querySelector('.vl').textContent);
  console.log('\nKPIs:'); kpis.forEach(k => console.log('   ', k));
  T('3 KPIs', d.querySelectorAll('.kpi').length === 3);
  T('total 5.915 t', kpis[0].indexOf('5.915') > 0, kpis[0]);
  T('próprio 3.890 t', kpis[1].indexOf('3.890') > 0, kpis[1]);
  T('terceiro 2.025 t', kpis[2].indexOf('2.025') > 0, kpis[2]);

  console.log('\nsubtítulo:', d.querySelector('#sub').textContent);
  console.log('carimbo:', d.querySelector('#stamp').textContent.replace(/\s+/g, ' '));

  T('mapa com 27 estados', d.querySelectorAll('#map path.uf').length === 27,
    d.querySelectorAll('#map path.uf').length + '');
  T('estados ativos coloridos', d.querySelectorAll('#map path.uf:not(.off)').length === 9,
    d.querySelectorAll('#map path.uf:not(.off)').length + '');
  T('arcos interestaduais', d.querySelectorAll('#map path.arc').length > 0,
    d.querySelectorAll('#map path.arc').length + '');

  const linhas = [...d.querySelectorAll('#tblUF tbody tr')];
  T('tabela com 9 estados', linhas.length === 9, linhas.length + '');
  console.log('\ntabela por estado:');
  linhas.forEach(tr => console.log('   ', [...tr.cells].map(c =>
    c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));

  T('sem abas de métrica no mapa', !d.querySelector('#tabs'));
  T('34 unidades Friboi no mapa', d.querySelectorAll('#map circle.mk.un').length === 34,
    d.querySelectorAll('#map circle.mk.un').length + '');
  T('5 destinos no mapa', d.querySelectorAll('#map circle.mk.dest').length === 5,
    d.querySelectorAll('#map circle.mk.dest').length + '');
  T('3 BioPower e 2 Flora', d.querySelectorAll('#map circle.mk.dest.bio').length === 3 &&
    d.querySelectorAll('#map circle.mk.dest.flo').length === 2);
  const rot = [...d.querySelectorAll('#map text.dlb')].map(t2 => t2.textContent).sort();
  T('rótulos dos destinos', rot.join(' | ') ===
    'BioPower Campo Verde | BioPower Lins | BioPower Mafra | Flora Lins | Flora Luziania',
    rot.join(' | '));
  const cx = [...d.querySelectorAll('#map circle.mk')].map(c => +c.getAttribute('cx'));
  T('nenhum marcador fora da área do mapa', cx.every(x => x > 0 && x < 520));
  T('marcadores de Lins separados',
    new Set([...d.querySelectorAll('#map circle.mk')].map(c =>
      c.getAttribute('cx') + ',' + c.getAttribute('cy'))).size === 39);
  T('arcos ligam unidade a fábrica própria', d.querySelectorAll('#map path.arc').length > 10,
    d.querySelectorAll('#map path.arc').length + ' arcos');
  T('nenhuma menção a diferença',
    d.querySelector('#app').textContent.toLowerCase().indexOf('diferen') < 0);

  // ---- detalhe MT
  d.querySelector('#map path[data-uf="MT"]').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  const det = d.querySelector('#detail');
  T('detalhe do MT abriu', !det.classList.contains('hide'));
  console.log('\ndestinos do MT:');
  [...det.querySelectorAll('.cbox')].forEach(b => console.log('   ',
    b.querySelector('.nm').textContent, b.querySelector('.vl').textContent,
    '|', b.querySelector('.sb').textContent));
  T('MT manda 1.540 t para a Campo Verde', det.textContent.indexOf('1.540 t') > 0);
  T('logo BioPower no destino', !!det.querySelector('.cbox.bio img'));
  T('logo Friboi no bloco de produção', !!det.querySelector('.orig img'));
  T('9 unidades no MT', det.querySelectorAll('.plant').length === 9,
    det.querySelectorAll('.plant').length + '');

  // ---- detalhe SP (dois consumidores próprios)
  d.querySelector('#map path[data-uf="SP"]').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  console.log('\ndestinos do SP:');
  [...d.querySelectorAll('#detail .cbox')].forEach(b => console.log('   ',
    b.querySelector('.nm').textContent, b.querySelector('.vl').textContent));
  T('SP com destinos', d.querySelectorAll('#detail .cbox').length >= 2,
    d.querySelectorAll('#detail .cbox').length + '');

  // ---- editor de terceiro na CFS (MT)
  d.querySelector('#map path[data-uf="MT"]').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  const bt = [...d.querySelectorAll('[data-ed]')].find(b => b.dataset.ed === 'CFS');
  T('botão trocar em todas as unidades', !!bt && d.querySelectorAll('[data-ed]').length === 9, d.querySelectorAll('[data-ed]').length+' de 9');
  bt.click();
  await new Promise(r => setTimeout(r, 30));
  const ops = [...d.querySelectorAll('#detail .opt')];
  console.log('\nranking CFS:');
  ops.forEach(o => console.log('   ', [...o.children].map(c =>
    c.tagName === 'INPUT' ? '[' + c.value + ']' : c.textContent.trim()).filter(Boolean).join(' ')));
  T('ranking com opções', ops.length >= 5, ops.length + '');
  T('CRV em primeiro com 210 t', ops[0].textContent.indexOf('CRV') > 0 &&
    ops[0].querySelector('.vol').value === '210');

  // divide 105 / 105
  ops[0].querySelector('.vol').value = '105';
  ops[0].querySelector('.vol').dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  let ops2 = [...d.querySelectorAll('#detail .opt')];
  console.log('após 105:', (d.querySelector('#detail .rest') || {}).textContent);
  ops2[1].querySelector('.vol').value = '105';
  ops2[1].querySelector('.vol').dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  T('aviso de alteração no topo', d.querySelector('#avisos').textContent.indexOf('fora da indicação') > 0);
  console.log('aviso:', d.querySelector('#avisos').textContent.replace(/\s+/g, ' ').trim());
  T('fecha o total depois de 105+105', !d.querySelector('#detail .rest'));

  // volume quebrado
  ops2 = [...d.querySelectorAll('#detail .opt')];
  ops2[1].querySelector('.vol').value = '23';
  ops2[1].querySelector('.vol').dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  const cr = [...d.querySelectorAll('#detail .opt .cr')].map(c => c.textContent).filter(Boolean);
  T('avisa carreta quebrada', cr.some(c => c.indexOf('⚠') > 0), cr.join(' / '));
  T('avisa que falta destinar',
    (d.querySelector('#detail .rest') || {}).textContent.indexOf('falta destinar') === 0,
    (d.querySelector('#detail .rest') || {}).textContent);

  // voltar ao ótimo
  w.zerarManual();
  await new Promise(r => setTimeout(r, 30));
  T('voltou ao ótimo', d.querySelector('#avisos').textContent.indexOf('fora da indicação') < 0);

  // ---- edição de oferta
  if (!d.querySelector('[data-ed="CFS"]')) {
    d.querySelector('#map path[data-uf="MT"]').dispatchEvent(new w.Event('click'));
    await new Promise(r => setTimeout(r, 30));
  }
  d.querySelector('[data-ed="CFS"]').click();
  await new Promise(r => setTimeout(r, 30));
  const antes = [...d.querySelectorAll('#detail .opt')].map(o => o.querySelector('.nm').textContent);
  const of2 = [...d.querySelectorAll('#detail .opt')][1].querySelector('.of');
  const novo = Math.round(+of2.value * 1.15);
  of2.value = novo; of2.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 60));
  const depois = [...d.querySelectorAll('#detail .opt')].map(o => o.querySelector('.nm').textContent);
  T('oferta editada reordena o ranking', antes[0] !== depois[0], antes[0] + ' -> ' + depois[0]);

  // ---- salvar e distribuir
  w.salvarAndamento();
  T('baixou andamento', baixados.some(b => /andamento_sebo/.test(b.nome)),
    baixados.map(b => b.nome).join(','));
  w.distribuir();
  T('gerou painel fechado', baixados.some(b => /painel_sebo_semana/.test(b.nome)));
  T('carimbo com data', /\d{2}\/\d{2}\/\d{4}/.test(d.querySelector('#stamp').textContent));
  console.log('carimbo final:', d.querySelector('#stamp').textContent.replace(/\s+/g, ' '));

  // --- bloco de destinos recolhe no mercado livre ---
  const box = d.querySelector('#necBox');
  const res = d.querySelector('#necResumo');
  const bVer = d.querySelector('#bVerDest');
  w.ST.modo = 'prioridade'; w.ST.verDest = null; w.aplicarModo();
  T('prioridade: lista de destinos aberta', !box.classList.contains('recolhido'));
  T('prioridade: linha de resumo escondida', res.classList.contains('hide'));
  w.ST.modo = 'mercado'; w.ST.verDest = null; w.aplicarModo();
  T('mercado: lista recolhe sozinha', box.classList.contains('recolhido'));
  T('mercado: linha de resumo aparece', !res.classList.contains('hide'));
  T('resumo conta os destinos', /\d+ destinos?/.test(d.querySelector('#necResumoTxt').textContent),
    d.querySelector('#necResumoTxt').textContent);
  T('resumo cita as travas fiscais', /trava/.test(d.querySelector('#necResumoTxt').textContent),
    d.querySelector('#necResumoTxt').textContent);
  T('botao diz mostrar quando recolhido', bVer.textContent === 'mostrar');
  bVer.dispatchEvent(new w.Event('click'));
  T('clicar em mostrar reabre a lista', !box.classList.contains('recolhido'));
  T('botao vira ocultar', bVer.textContent === 'ocultar');
  bVer.dispatchEvent(new w.Event('click'));
  T('clicar de novo recolhe', box.classList.contains('recolhido'));
  d.querySelector('#bAddNec').dispatchEvent(new w.Event('click'));
  T('acrescentar terceiro reabre a lista recolhida', !box.classList.contains('recolhido'));
  d.querySelector('#bAddNec').dispatchEvent(new w.Event('click'));
  w.ST.modo = 'prioridade'; w.ST.verDest = null; w.aplicarModo();
  T('voltar para prioridade reabre a lista', !box.classList.contains('recolhido'));

  // terceiro acrescentado nao pode herdar logo de fabrica propria
  T('BioPower e do grupo bio', w.grupo('JBS - BioPower Lins') === 'bio');
  T('Flora e do grupo flo', w.grupo('Flora GO') === 'flo');
  // o bug real: terceiro acrescentado entra na lista de destinos (DS.proprios),
  // e o codigo antigo concluia dai que era fabrica propria
  w.DS.proprios.set('Bahia Rendering - BA', { cliente: 'Bahia Rendering - BA', ton: 0 });
  T('terceiro na lista de destinos ainda e terceiro',
    w.grupo('Bahia Rendering - BA') === 'ter',
    'grupo() devolveu ' + w.grupo('Bahia Rendering - BA'));
  T('terceiro nao ganha logo', w.selo('Bahia Rendering - BA', 'ter').indexOf('<img') < 0);
  T('terceiro ganha marcador com a inicial',
    /class="tercm"[^>]*>B</.test(w.selo('Bahia Rendering - BA', 'ter')));
  T('propria continua com logo', w.selo('Flora GO', 'flo').indexOf('<img') === 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
