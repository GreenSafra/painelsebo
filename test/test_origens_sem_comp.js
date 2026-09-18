// Toneladas e origens sem terceiro comparavel, por fabrica propria (Consolidado
// e tela da semana). Antes a tela so mostrava o TOTAL sem comparacao ("Sem
// comparação: 200 t"); agora tambem lista QUAIS siglas de origem ficaram sem
// oferta de terceiro no Mapa, pra apontar onde falta cotacao. Cobre:
// - core.js: agregarSemana() separa direitinho origens com e sem terceiro
//   pra um mesmo cliente, e confirma que a tonelada sem comparacao ENTRA no
//   volume e no NET medio, mas FICA FORA de ton_comp/saving (a Diferenca).
// - consolidado.html: a frase "X t sem oferta de terceiro (origens: ...)"
//   aparece entre "Média terceiros" e "Melhor terceiro", em cinza, so quando
//   ha tonelada sem comparacao.
// - db.js: a query de porPropria pede as origens sem comparacao junto (por
//   revisao de codigo a sintaxe do array_agg em si, mesmo padrao das levas
//   anteriores com SQL mais elaborado).
process.chdir(__dirname);
const path = require('path');
const fs = require('fs');
const core = require('../src/core.js');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); };

/* ====================== core.js: agregarSemana() ====================== */
(() => {
  const linha = (over) => Object.assign({
    cliente: 'Flora GO', proprio: true, sigla: 'AAA', toneladas: 100,
    net: 5000, netTer: null, netTerMed: null, nTer: 0
  }, over);

  // ---------- uma origem com terceiro, outra sem, no mesmo cliente ----------
  {
    const linhas = [
      linha({ sigla: 'AAA', toneladas: 100, net: 5000, netTerMed: 4800, netTer: 4900, nTer: 2 }),
      linha({ sigla: 'BBB', toneladas: 50, net: 5100, netTerMed: null })
    ];
    const ag = core.agregarSemana(linhas, [], []);
    const fg = ag.porPropria.find(p => p.cliente === 'Flora GO');
    T('Flora GO encontrada na agregacao', !!fg);
    if (fg) {
      T('origens_sem_comp_realizado lista so a sigla sem terceiro (BBB)',
        JSON.stringify(fg.origens_sem_comp_realizado) === JSON.stringify(['BBB']), fg.origens_sem_comp_realizado);
      T('Volume (ton_realizado) inclui as DUAS origens (100+50=150), nao so a comparavel',
        Math.abs(fg.ton_realizado - 150) < 0.001, fg.ton_realizado);
      T('NET medio pondera as DUAS origens (media ponderada de 5000 e 5100)',
        Math.abs(fg.net_realizado - (5000 * 100 + 5100 * 50) / 150) < 0.01, fg.net_realizado);
      T('ton_comp_realizado (base da Diferenca) conta SO a origem comparavel (100, nao 150)',
        Math.abs(fg.ton_comp_realizado - 100) < 0.001, fg.ton_comp_realizado);
      T('saving_realizado (a Diferenca) usa SO a origem comparavel: (5000-4800)*100 = 20000',
        Math.abs(fg.saving_realizado - 20000) < 0.01, fg.saving_realizado);
    }
  }

  // ---------- duas origens sem terceiro: as duas siglas aparecem, ordenadas ----------
  {
    const linhas = [
      linha({ sigla: 'LIF', toneladas: 40, net: 5000, netTerMed: null }),
      linha({ sigla: 'ANF', toneladas: 60, net: 5100, netTerMed: null })
    ];
    const ag = core.agregarSemana(linhas, [], []);
    const fg = ag.porPropria.find(p => p.cliente === 'Flora GO');
    T('duas origens sem terceiro: as duas siglas aparecem, em ordem alfabetica (ANF antes de LIF)',
      !!fg && JSON.stringify(fg.origens_sem_comp_realizado) === JSON.stringify(['ANF', 'LIF']),
      fg && fg.origens_sem_comp_realizado);
    T('sem NENHUMA origem comparavel: ton_comp e saving ficam zerados/nulos',
      !!fg && fg.ton_comp_realizado === 0 && fg.saving_realizado == null,
      fg && { tonComp: fg.ton_comp_realizado, saving: fg.saving_realizado });
  }

  // ---------- todas as origens com terceiro: lista vazia, nao null/undefined ----------
  {
    const linhas = [linha({ sigla: 'AAA', toneladas: 100, net: 5000, netTerMed: 4800, netTer: 4900, nTer: 1 })];
    const ag = core.agregarSemana(linhas, [], []);
    const fg = ag.porPropria.find(p => p.cliente === 'Flora GO');
    T('todas as origens comparaveis: origens_sem_comp_realizado e array vazio',
      !!fg && Array.isArray(fg.origens_sem_comp_realizado) && fg.origens_sem_comp_realizado.length === 0,
      fg && fg.origens_sem_comp_realizado);
  }

  // ---------- cliente sem nenhuma carga: array vazio, nao quebra ----------
  {
    const ag = core.agregarSemana([], [], []);
    T('cliente sem carga nenhuma: origens_sem_comp_realizado e array vazio (nao quebra)',
      ag.porPropria.every(p => Array.isArray(p.origens_sem_comp_realizado) && p.origens_sem_comp_realizado.length === 0));
    T('idem pro otimo', ag.porPropria.every(p => Array.isArray(p.origens_sem_comp_otimo) && p.origens_sem_comp_otimo.length === 0));
  }

  // ---------- realizado e otimo sao independentes (uma origem pode faltar
  // so num dos dois cenarios) ----------
  {
    const linhasReal = [linha({ sigla: 'AAA', toneladas: 100, net: 5000, netTerMed: null })];
    const linhasOtimo = [linha({ sigla: 'AAA', toneladas: 100, net: 5000, netTerMed: 4800, netTer: 4900, nTer: 1 })];
    const ag = core.agregarSemana(linhasReal, linhasOtimo, []);
    const fg = ag.porPropria.find(p => p.cliente === 'Flora GO');
    T('realizado sem comparacao, otimo com comparacao: os dois lados ficam certos, independentes',
      !!fg && JSON.stringify(fg.origens_sem_comp_realizado) === JSON.stringify(['AAA']) &&
      JSON.stringify(fg.origens_sem_comp_otimo) === JSON.stringify([]),
      fg && { real: fg.origens_sem_comp_realizado, otimo: fg.origens_sem_comp_otimo });
  }
})();

/* ====================== db.js: query de porPropria ====================== */
// A sintaxe do array_agg/FILTER em si fica por revisao de codigo (sem
// Postgres local, mesmo padrao das levas anteriores) — aqui so confere que
// a coluna foi pedida e que os dois cenarios (realizado/otimo) recebem ela.
(() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const ini = src.indexOf('const porPropria = await pool.query(');
  const bloco = src.slice(ini, src.indexOf("ORDER BY p.cliente`, f.params);", ini) + 30);
  T('CTE "dados" calcula origens_sem_comp (array_agg das siglas sem net_ter_med)',
    /array_agg\(DISTINCT a\.sigla\) FILTER \(WHERE a\.net_ter_med IS NULL/.test(bloco));
  T('SELECT final expoe origens_sem_comp_realizado', /origens_sem_comp_realizado/.test(bloco));
  T('SELECT final expoe origens_sem_comp_otimo', /origens_sem_comp_otimo/.test(bloco));
})();

/* ====================== consolidado.html: render(d) ====================== */
(async () => {
  const { JSDOM } = require('jsdom');
  const CONSOLIDADO = path.join(__dirname, '..', 'public', 'consolidado.html');
  const respFake = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
  const consolFake = (extra) => Object.assign({
    modo: 'semana', mes: null, ano: 2026, semana: 38,
    porUf: [], porPlanta: [], porPropria: [],
    semanasFechadas: [{ ano: 2026, semana: 38, periodo: '14/09 a 20/09', versao: 1,
      fechada_em: '2026-09-20T18:00:00.000Z', fechada_por: 'Ronaldo', linhas: 40, toneladas: 900, tem_pacote: true }],
    total: { toneladas: 0, net_medio: null, semanas: 0 }
  }, extra);

  function montarTela(porPropriaEntry) {
    const mockFetch = async url => {
      if (url === '/api/semanas') return respFake(200, [{ ano: 2026, semana: 38, periodo: '14/09 a 20/09', versao: 1 }]);
      if (url === '/api/consolidado?semana=2026-38') {
        return respFake(200, consolFake({ porPropria: [porPropriaEntry],
          total: { toneladas: porPropriaEntry.ton_realizado, net_medio: 5000, semanas: 1 } }));
      }
      return respFake(404, {});
    };
    const dom = new JSDOM(fs.readFileSync(CONSOLIDADO, 'utf8'), {
      runScripts: 'dangerously', url: 'https://x/?semana=2026-38',
      beforeParse(window) { window.fetch = mockFetch; window.alert = () => {}; }
    });
    return dom;
  }

  const base = {
    cliente: 'Flora GO', ton_realizado: 150, net_realizado: 5033,
    net_ter_realizado: 4800, net_ter_melhor_realizado: 4900, n_ter_realizado: 2,
    ton_comp_realizado: 100, saving_realizado: 20000,
    origens_sem_comp_realizado: ['ANF', 'LIF'],
    // otimo sem nenhuma tonelada faltando (100 recebido = 100 comparavel):
    // consistente com origens_sem_comp_otimo vazio, pra provar que o aviso
    // so aparece quando ha mesmo tonelada sem comparar.
    ton_otimo: 100, net_otimo: 4900,
    net_ter_otimo: 4800, net_ter_melhor_otimo: 4900, n_ter_otimo: 2,
    ton_comp_otimo: 100, saving_otimo: 10000,
    origens_sem_comp_otimo: []
  };

  // ---------- item 1 e 2: frase com toneladas e origens, em cinza ----------
  {
    const dom = montarTela(base);
    await new Promise(r => setTimeout(r, 150));
    const d = dom.window.document;
    const blocoRealizado = d.querySelector('.feito > div');
    T('bloco da fabrica renderizado', !!blocoRealizado);
    const nota = blocoRealizado && blocoRealizado.querySelector('.semcomp');
    T('aviso "sem oferta de terceiro" aparece no bloco "O que foi feito"', !!nota, nota && nota.textContent);
    T('texto tem a tonelada certa (50 t = 150 - 100) e as origens (ANF, LIF)',
      !!nota && nota.textContent.indexOf('50') >= 0 &&
      nota.textContent.indexOf('sem oferta de terceiro') >= 0 &&
      nota.textContent.indexOf('origens: ANF, LIF') >= 0,
      nota && nota.textContent);
    const corNota = nota && dom.window.getComputedStyle(nota).color;
    T('aviso fica com a classe cinza (.semcomp), nao dentro de uma .lin normal',
      !!nota && !nota.closest('.lin'));

    // posicao: entre "Média terceiros" e "Melhor terceiro"
    const filhos = [...blocoRealizado.children];
    const iMedia = filhos.findIndex(el => el.textContent.indexOf('Média terceiros') === 0);
    const iSemComp = filhos.indexOf(nota);
    const iMelhor = filhos.findIndex(el => el.classList.contains('sec') && el.textContent.indexOf('Melhor terceiro') === 0);
    T('aviso fica logo ABAIXO de "Média terceiros" e ANTES de "Melhor terceiro"',
      iMedia >= 0 && iSemComp === iMedia + 1 && iMelhor === iSemComp + 1,
      { iMedia, iSemComp, iMelhor });

    // segundo bloco (otimo) nao tem origens sem comparacao nesta massa —
    // nao deve mostrar o aviso.
    const blocoOtimo = d.querySelector('.modelo > div');
    T('bloco "O que o modelo mandava" (sem origens faltando nesta massa) nao mostra o aviso',
      !!blocoOtimo && !blocoOtimo.querySelector('.semcomp'));
  }

  // ---------- sem nenhuma origem faltando: nenhum aviso aparece ----------
  {
    const semFalta = Object.assign({}, base, {
      ton_realizado: 100, ton_comp_realizado: 100, origens_sem_comp_realizado: []
    });
    const dom = montarTela(semFalta);
    await new Promise(r => setTimeout(r, 150));
    const d = dom.window.document;
    const blocoRealizado = d.querySelector('.feito > div');
    T('sem tonelada sem comparacao: nenhum aviso ".semcomp" aparece',
      !!blocoRealizado && !blocoRealizado.querySelector('.semcomp'));
  }

  // ---------- item 3: mesmo com origem faltando, Volume e NET medio mostram
  // o TOTAL (150), nao so a parte comparavel (100) — a tela nao esconde a
  // tonelada, so tira ela da Diferenca ----------
  {
    const dom = montarTela(base);
    await new Promise(r => setTimeout(r, 150));
    const d = dom.window.document;
    const blocoRealizado = d.querySelector('.feito > div');
    const linhaVolume = [...blocoRealizado.querySelectorAll('.lin')].find(l => l.textContent.indexOf('Volume') === 0);
    T('linha "Volume" mostra o total (150 t), nao so a parte comparavel (100 t)',
      !!linhaVolume && linhaVolume.textContent.indexOf('150') >= 0, linhaVolume && linhaVolume.textContent);
    const linhaDif = [...blocoRealizado.querySelectorAll('.lin.forte')].find(l => l.textContent.indexOf('Diferença') === 0);
    T('linha "Diferença" usa so a Diferenca calculada (20.000), sem fingir cobrir a parte sem terceiro',
      !!linhaDif && (linhaDif.textContent.indexOf('20.000') >= 0), linhaDif && linhaDif.textContent);
  }

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
