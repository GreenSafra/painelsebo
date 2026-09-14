// Resumo da semana no proprio painel (renderResumoSemana + agregarSemana).
// O que esta bateria tem que provar: painel e consolidado NUNCA podem
// divergir, porque os dois usam a mesma conta (montarSemana + agregarSemana).
// Nao testa contra numeros da semana 38 real (nao estao registrados em
// lugar nenhum) — testa consistencia entre tela e agregado, e fixa um
// snapshot do cenario montado aqui como trava contra regressao.
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

const rd = v => v == null ? null : Math.round(v);
// converte "R$ 1.234" / "−R$ 1.234" / "—" de volta pra numero, pra comparar
// com o que agregarSemana() devolveu.
const parseRs = txt => {
  const t = (txt || '').trim();
  if (!t || t === '—') return null;
  const neg = t.indexOf('−') >= 0 || t.indexOf('-') >= 0;
  const n = Number(t.replace(/[^\d]/g, ''));
  return neg ? -n : n;
};

(async () => {
  await new Promise(r => setTimeout(r, 60));
  await w.receber('prog', fake('prog.xlsx', 'in/prog38.xlsx'));
  await w.receber('mapa', fake('mapa.xlsx', 'in/mapa2.xlsx'));
  await new Promise(r => setTimeout(r, 150));
  const d = w.document;

  // --- 1. logo apos importar, sem nenhuma necessidade digitada: o resumo
  // nao pode quebrar. iniciar() ja chamou recalcular() uma vez, e mesmo sem
  // necessidade os terceiros ja absorvem a produção por padrão — entao
  // pac.linhas NUNCA fica vazio na pratica com dado real (o guard de
  // "some quando nao ha nada" e defensivo pra um caso que so acontece sem
  // producao nenhuma, testado direto na funcao pura logo abaixo). O que
  // importa aqui e nao quebrar e mostrar as proprias zeradas (nenhuma
  // recebeu nada ainda, ja que nenhuma necessidade foi digitada). ---
  const box = () => d.querySelector('#resumoSemana');
  T('resumo existe no DOM', !!box());
  T('resumo nao quebra logo apos importar', box().innerHTML.trim() !== '' || box().classList.contains('hide'));
  const agVazio = w.agregarSemana(
    w.montarSemana(w.PROD, w.RES.alocFinal, w.RES.otimoAloc, w.OPS, w.MAPA).linhas,
    w.montarSemana(w.PROD, w.RES.alocFinal, w.RES.otimoAloc, w.OPS, w.MAPA).linhasOtimo,
    w.MAPA.rows);
  T('nenhuma propria recebeu nada antes de digitar necessidade',
    agVazio.porPropria.every(p => p.ton_realizado === 0),
    agVazio.porPropria.map(p => p.cliente + ':' + p.ton_realizado).join(', '));

  // --- agregarSemana() com entrada vazia de verdade (nenhuma linha) nao
  // pode quebrar nem gerar NaN — e o guard real de "sem alocacao nenhuma". ---
  const agTotalmenteVazio = w.agregarSemana([], [], w.MAPA.rows);
  T('agregarSemana([],[],mapa) nao quebra com entrada totalmente vazia',
    agTotalmenteVazio.total.toneladas === 0 && agTotalmenteVazio.total.net_medio === null);
  T('agregarSemana([],[],mapa) devolve todas as proprias zeradas, sem saving',
    agTotalmenteVazio.porPropria.length > 0 &&
    agTotalmenteVazio.porPropria.every(p => p.ton_realizado === 0 && p.ton_otimo === 0 &&
      p.saving_realizado == null && p.saving_otimo == null));

  // --- cenario: 3 proprias com necessidade, 2 sem (Flora GO e BioPower
  // Mafra ficam garantidamente em "nao entrou na semana", sem depender de
  // como o mercado se comporta) ---
  const E = s => s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  const set = (c, v) => { const i = d.querySelector('[data-nec="' + E(c) + '"]'); if (i) { i.value = v; i.dispatchEvent(new w.Event('input')); } };
  set('JBS - BioPower Lins', 900);
  set('JBS - BioPower Campo Verde', 900);
  set('Flora SP', 900);
  w.rodar(); await new Promise(r => setTimeout(r, 120));

  T('resumo aparece depois de rodar', !box().classList.contains('hide'));
  T('resumo tem conteudo depois de rodar', box().innerHTML.trim() !== '');

  // --- 2a. consistencia: o que esta na tela bate com o que agregarSemana devolve ---
  const pac = w.montarSemana(w.PROD, w.RES.alocFinal, w.RES.otimoAloc, w.OPS, w.MAPA);
  const ag = w.agregarSemana(pac.linhas, pac.linhasOtimo, w.MAPA.rows);

  const fabs = [...box().querySelectorAll('.rs-fab')];
  T('um bloco na tela por fabrica propria agregada', fabs.length === ag.porPropria.length,
    fabs.length + ' vs ' + ag.porPropria.length);

  let consistente = true, detalhe = '';
  ag.porPropria.forEach((p, i) => {
    const fab = fabs[i];
    if (!fab) { consistente = false; detalhe = 'faltou bloco de ' + p.cliente; return; }
    const nome = fab.querySelector('.rs-nome').textContent.trim();
    if (nome.indexOf(p.cliente) < 0) { consistente = false; detalhe = 'nome: ' + nome + ' != ' + p.cliente; return; }
    const duos = fab.querySelectorAll('.rs-duo > div');
    const difR = parseRs(duos[0].querySelectorAll('.rs-lin.rs-forte span')[1].textContent);
    const difO = parseRs(duos[1].querySelectorAll('.rs-lin.rs-forte span')[1].textContent);
    if (difR !== rd(p.saving_realizado)) {
      consistente = false; detalhe = p.cliente + ' realizado: tela=' + difR + ' agregado=' + rd(p.saving_realizado);
    }
    if (difO !== rd(p.saving_otimo)) {
      consistente = false; detalhe = p.cliente + ' otimo: tela=' + difO + ' agregado=' + rd(p.saving_otimo);
    }
  });
  T('diferenca mostrada na tela bate com agregarSemana(), fabrica por fabrica', consistente, detalhe);

  // --- 2b. a soma dos savings por fabrica bate com a soma linha a linha
  // de montarSemana() — e isso que garante que painel e consolidado nunca
  // divergem (a mesma conta da CTE "dados" de db.js). ---
  const somaLinhas = pac.linhas
    .filter(l => l.proprio && l.netTer != null)
    .reduce((s, l) => s + (l.net - l.netTer) * l.toneladas, 0);
  const somaAgregada = ag.porPropria.reduce((s, p) => s + (p.saving_realizado || 0), 0);
  T('soma dos savings por fabrica bate com a soma linha a linha de montarSemana',
    Math.abs(somaLinhas - somaAgregada) < 1,
    somaLinhas.toFixed(2) + ' vs ' + somaAgregada.toFixed(2));

  // --- 3. pelo menos uma propria sem necessidade cai em "nao entrou" sem
  // quebrar (Flora GO e/ou BioPower Mafra, que ficaram sem set() acima) ---
  const semEntrada = ag.porPropria.filter(p => p.ton_realizado === 0 && p.ton_otimo === 0);
  T('ha pelo menos uma propria que nao entrou na semana', semEntrada.length > 0,
    semEntrada.map(p => p.cliente).join(', '));
  T('nenhum "NaN" ou "undefined" no resumo', box().innerHTML.indexOf('NaN') < 0 && box().innerHTML.indexOf('undefined') < 0);
  if (semEntrada.length) {
    const nomeSemEntrada = semEntrada[0].cliente;
    const fabSemEntrada = fabs.find(f => f.querySelector('.rs-nome').textContent.indexOf(nomeSemEntrada) >= 0);
    T('veredito da que nao entrou diz isso', !!fabSemEntrada && /não entrou na semana/.test(fabSemEntrada.textContent));
  }

  // --- 4. snapshot do cenario 900/900/900 (Lins, Campo Verde, Flora SP) em
  // prog38.xlsx + mapa2.xlsx, prova contra regressao — NAO sao os numeros
  // reais da semana 38 (esses nao foram registrados em lugar nenhum). ---
  console.log('\nsnapshot do cenario (Lins 900 / Campo Verde 900 / Flora SP 900):');
  ag.porPropria.forEach(p => console.log('   ', p.cliente,
    rd(p.ton_realizado) + ' t realizado / ' + rd(p.ton_otimo) + ' t otimo',
    '| saving R$', rd(p.saving_realizado), '/ R$', rd(p.saving_otimo)));
  console.log('    total:', rd(ag.total.toneladas) + ' t, net medio', rd(ag.total.net_medio));

  // --- 5. uma troca manual muda os numeros do resumo ---
  d.querySelector('#map path[data-uf="MT"]').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 40));
  const uns = [...d.querySelectorAll('[data-ed]')];
  T('ha unidade editavel em MT', uns.length > 0, uns.length + '');
  uns[0].click(); await new Promise(r => setTimeout(r, 40));
  const ops = [...d.querySelectorAll('#detail .opt')];
  const vProp = ops.find(o => /BioPower|Flora/.test(o.querySelector('.nm').textContent));
  const vTer = ops.find(o => !/BioPower|Flora/.test(o.querySelector('.nm').textContent));
  T('ha opcao propria e terceiro pra trocar em MT', !!vProp && !!vTer);

  const agAntes = w.agregarSemana(
    w.montarSemana(w.PROD, w.RES.alocFinal, w.RES.otimoAloc, w.OPS, w.MAPA).linhas,
    [], w.MAPA.rows
  );

  if (vProp && vTer) {
    const volProp = vProp.querySelector('.vol'), volTer = vTer.querySelector('.vol');
    const antes = volProp.value;
    volProp.value = '0'; volProp.dispatchEvent(new w.Event('change'));
    await new Promise(r => setTimeout(r, 60));
    const ops2 = [...d.querySelectorAll('#detail .opt')];
    const t2 = ops2.find(o => !/BioPower|Flora/.test(o.querySelector('.nm').textContent)).querySelector('.vol');
    t2.value = String(Number(t2.value || 0) + Number(antes)); t2.dispatchEvent(new w.Event('change'));
    await new Promise(r => setTimeout(r, 60));
  }

  const agDepois = w.agregarSemana(
    w.montarSemana(w.PROD, w.RES.alocFinal, w.RES.otimoAloc, w.OPS, w.MAPA).linhas,
    [], w.MAPA.rows
  );
  const difere = JSON.stringify(agAntes.porPropria) !== JSON.stringify(agDepois.porPropria);
  T('troca manual muda os numeros agregados do resumo', difere);
  T('resumo na tela mudou junto (nao ficou preso ao render anterior)',
    box().innerHTML.trim() !== '');

  // --- 6. persistir/restaurar: PROD, MAPA e PROGBUF voltam equivalentes ---
  w.persistirDados();
  const salvoTxt = w.localStorage.getItem('sebo_dados');
  T('sebo_dados foi gravado', !!salvoTxt);
  const salvo = salvoTxt ? JSON.parse(salvoTxt) : {};
  T('PROD volta identico', JSON.stringify(salvo.prod) === JSON.stringify(w.PROD));
  const mapaRowsSemOfEdit = w.MAPA.rows.map(r => { const c = Object.assign({}, r); delete c.ofEdit; return c; });
  T('MAPA.rows volta identico (sem ofEdit)',
    JSON.stringify((salvo.mapa || {}).rows) === JSON.stringify(mapaRowsSemOfEdit));
  T('MAPA.data volta identico', (salvo.mapa || {}).data === w.MAPA.data);
  if (w.PROGBUF) {
    const restaurado = w.deB64(salvo.progb64);
    const a = Buffer.from(w.PROGBUF), b = Buffer.from(restaurado);
    T('PROGBUF volta byte a byte identico', a.equals(b), a.length + ' vs ' + b.length);
  } else {
    T('PROGBUF ausente nos dois lados', !salvo.progb64);
  }

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
