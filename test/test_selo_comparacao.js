// Selo de comparacao com o modelo (public/consolidado.html) — o selo (e o
// calculo da Diferenca) so pode aparecer quando os DOIS cenarios (realizado
// e o que o modelo mandava) tem uma comparacao de verdade com terceiros.
// Antes, quando um lado nao tinha dado (ex.: o modelo nao mandou carga
// nenhuma pra aquela fabrica), o codigo comparava com zero e mostrava
// "+R$ X acima do modelo" como se fosse um numero de verdade. Agora esse
// caso vira "modelo sem comparação", cinza, sem valor — e a tela distingue
// os dois motivos: o modelo nao mandou carga, ou a semana nao tem planilhas
// guardadas pra calcular a media nenhuma. So testa o lado do cliente (fetch
// mockado), mesmo padrao das levas anteriores.
process.chdir(__dirname);
const path = require('path');
const CONSOLIDADO = path.join(__dirname, '..', 'public', 'consolidado.html');
const fs = require('fs'); const { JSDOM } = require('jsdom');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

const consolFake = (modo, extra) => Object.assign({
  modo, mes: null, ano: null, semana: null,
  porUf: [], porPlanta: [], porPropria: [],
  semanasFechadas: [], total: { toneladas: 0, net_medio: null, semanas: 0 }
}, extra);

const semana38 = {
  ano: 2026, semana: 38, periodo: '14/09 a 20/09', versao: 1,
  fechada_em: '2026-09-20T18:00:00.000Z', fechada_por: 'Ronaldo', linhas: 40, toneladas: 900
};

function carregarPagina(url, mockFetch) {
  return new JSDOM(fs.readFileSync(CONSOLIDADO, 'utf8'), {
    runScripts: 'dangerously', url,
    beforeParse(window) { window.fetch = mockFetch; window.alert = () => {}; }
  });
}

async function montarTela(porPropriaEntry, semanasFechadas) {
  const mockFetch = async url => {
    if (url === '/api/semanas') return respFake(200, [semana38]);
    if (url === '/api/consolidado?semana=2026-38') {
      return respFake(200, consolFake('semana', {
        ano: 2026, semana: 38,
        porPropria: [porPropriaEntry],
        semanasFechadas: semanasFechadas || [Object.assign({}, semana38, { tem_pacote: true })],
        total: { toneladas: porPropriaEntry.ton_realizado, net_medio: 5000, semanas: 1 }
      }));
    }
    return respFake(404, {});
  };
  const dom = carregarPagina('https://x/?semana=2026-38', mockFetch);
  await new Promise(r => setTimeout(r, 150));
  return dom.window.document;
}

function cardDaFabrica(doc) { return doc.querySelector('.fab'); }
function veredito(doc) { return cardDaFabrica(doc).querySelector('.veredito'); }
function frase(doc) { return cardDaFabrica(doc).querySelector('.frase').textContent; }

(async () => {
  // ---------- motivo 1: o modelo nao mandou carga pra esta fabrica ----------
  {
    const p = {
      cliente: 'Flora GO', ton_realizado: 900, net_realizado: 5300,
      net_ter_realizado: 5100, net_ter_melhor_realizado: 5200, n_ter_realizado: 3,
      ton_comp_realizado: 900, saving_realizado: 180000,
      // cenario otimo: nenhuma linha propria pra esta fabrica (o caso real
      // investigado — ton_otimo=0, os campos dependentes saem null)
      ton_otimo: 0, net_otimo: null, net_ter_otimo: null, net_ter_melhor_otimo: null,
      n_ter_otimo: null, ton_comp_otimo: 0, saving_otimo: null
    };
    const d = await montarTela(p);
    const v = veredito(d);
    T('card da fabrica encontrado', !!cardDaFabrica(d));
    T('selo explica o motivo ("o modelo não indicou esta fábrica"), nao um generico "sem comparação"',
      v.textContent.trim() === 'o modelo não indicou esta fábrica', v.textContent);
    T('selo fica em cinza (nao neg nem pos)',
      !v.querySelector('.neg') && !v.querySelector('.pos'), v.innerHTML);
    T('nao aparece o texto generico antigo "modelo sem comparação"',
      v.textContent.indexOf('modelo sem comparação') === -1, v.textContent);
    T('nao aparece "acima do modelo" nem "abaixo do modelo" nem "custou" (texto de valor, comparando com zero)',
      !/acima do modelo|abaixo do modelo|custou/.test(v.textContent), v.textContent);
    T('frase explica que o modelo nao mandaria nada pra ca',
      frase(d).indexOf('modelo não mandaria nada para cá') >= 0, frase(d));
    T('frase NAO inventa motivo de planilha (o motivo aqui e outro: sem carga)',
      frase(d).indexOf('planilhas guardadas') === -1, frase(d));
  }

  // ---------- motivo 2: semana sem planilhas guardadas (os dois cenarios
  // tem volume, mas nenhum tem media porque a semana nao tem pacote) ----------
  {
    const p = {
      cliente: 'Flora GO', ton_realizado: 900, net_realizado: 5300,
      net_ter_realizado: null, net_ter_melhor_realizado: null, n_ter_realizado: null,
      ton_comp_realizado: 0, saving_realizado: null,
      ton_otimo: 735, net_otimo: 5250,
      net_ter_otimo: null, net_ter_melhor_otimo: null, n_ter_otimo: null,
      ton_comp_otimo: 0, saving_otimo: null
    };
    const semanasSemPacote = [Object.assign({}, semana38, { tem_pacote: false })];
    const d = await montarTela(p, semanasSemPacote);
    const v = veredito(d);
    T('selo explica que faltam planilhas ("sem planilhas para comparar"), nao um generico "sem comparação"',
      v.textContent.trim() === 'sem planilhas para comparar', v.textContent);
    T('frase explica que a semana nao tem planilhas guardadas',
      frase(d).indexOf('Semana sem planilhas guardadas') >= 0, frase(d));
    T('frase continua descrevendo os volumes reais (900 t / 735 t), nao esconde o dado',
      frase(d).indexOf('900') >= 0 || /Recebeu.*<b>900/.test(cardDaFabrica(d).querySelector('.frase').innerHTML));
  }

  // ---------- caso normal: os dois cenarios com Diferenca calculada — selo
  // continua mostrando o valor de verdade, sem mudanca de comportamento ----------
  {
    const p = {
      cliente: 'Flora GO', ton_realizado: 900, net_realizado: 5200,
      net_ter_realizado: 5000, net_ter_melhor_realizado: 5100, n_ter_realizado: 4,
      ton_comp_realizado: 900, saving_realizado: 180000,
      ton_otimo: 900, net_otimo: 5400,
      net_ter_otimo: 5000, net_ter_melhor_otimo: 5100, n_ter_otimo: 4,
      ton_comp_otimo: 900, saving_otimo: 360000
    };
    const d = await montarTela(p);
    const v = veredito(d);
    T('caso normal: selo mostra um valor de verdade (abaixo do modelo), nao "sem comparação"',
      v.textContent.indexOf('sem comparação') === -1 && v.textContent.indexOf('abaixo do modelo') >= 0,
      v.textContent);
    T('valor do selo bate com a diferenca real (360000 - 180000 = 180000)',
      v.textContent.indexOf('180.000') >= 0 || v.textContent.indexOf('180000') >= 0, v.textContent);
  }

  // ---------- motivo do "to===0" na FRASE (nao no selo): db.js calcula o
  // texto no servidor (preencherMotivosZeroOtimo, so no modo Semana e com
  // pacote guardado — ver test_modo_necessidades.js/test_origens_sem_comp.js
  // pra a logica de motivoModeloZero() em si) e manda pronto no campo
  // motivo_zero_otimo; aqui so confere que a tela USA esse campo direito.
  // Semana fechada antes dele existir (ou fora do modo Semana) manda o
  // campo ausente — cenario ja coberto acima no motivo 1 (undefined vira
  // "sem motivo", frase so com o fato). ----------
  const pZeroModelo = {
    cliente: 'Flora GO', ton_realizado: 900, net_realizado: 5300,
    net_ter_realizado: 5100, net_ter_melhor_realizado: 5200, n_ter_realizado: 3,
    ton_comp_realizado: 900, saving_realizado: 180000,
    ton_otimo: 0, net_otimo: null, net_ter_otimo: null, net_ter_melhor_otimo: null,
    n_ter_otimo: null, ton_comp_otimo: 0, saving_otimo: null
  };
  {
    const p = Object.assign({}, pZeroModelo, { motivo_zero_otimo: 'porque havia terceiro pagando mais por essas cargas.' });
    const d = await montarTela(p);
    T('motivo_zero_otimo="terceiro": frase explica que havia terceiro pagando mais',
      frase(d).indexOf('porque havia terceiro pagando mais por essas cargas') >= 0, frase(d));
  }
  {
    const p = Object.assign({}, pZeroModelo, { motivo_zero_otimo: 'porque não foi digitada necessidade para esta fábrica.' });
    const d = await montarTela(p);
    T('motivo_zero_otimo="semNecessidade": frase explica isso, nao fala de terceiro',
      frase(d).indexOf('porque não foi digitada necessidade para esta fábrica') >= 0, frase(d));
  }
  {
    const p = Object.assign({}, pZeroModelo, { motivo_zero_otimo: 'porque não havia oferta disponível para essas origens.' });
    const d = await montarTela(p);
    T('motivo_zero_otimo="semOferta": frase fala de falta de oferta, nao de necessidade',
      frase(d).indexOf('porque não havia oferta disponível para essas origens') >= 0, frase(d));
  }
  {
    const p = Object.assign({}, pZeroModelo, {
      motivo_zero_otimo: 'porque o NET era igual ao de Flora SP, que ficou com as cargas.'
    });
    const d = await montarTela(p);
    T('motivo_zero_otimo="empate": frase nomeia quem ficou com as cargas',
      frase(d).indexOf('porque o NET era igual ao de Flora SP, que ficou com as cargas') >= 0, frase(d));

    // ---------- "O que foi feito" em destaque; "O que o modelo mandava"
    // recolhido, com o motivo direto no link, abre/fecha ao clicar ----------
    const card = cardDaFabrica(d);
    T('"O que foi feito" ocupa bloco proprio (sem .duo lado a lado)', !!card.querySelector('.feito'));
    const btn = card.querySelector('.togglemodelo');
    const modelo = card.querySelector('.modelo');
    T('link/botao "ver o que o modelo mandava" existe', !!btn, btn && btn.textContent);
    T('bloco "O que o modelo mandava" comeca RECOLHIDO (classe hide)',
      !!modelo && modelo.classList.contains('hide'));
    T('botao comeca com aria-expanded="false"', !!btn && btn.getAttribute('aria-expanded') === 'false');
    T('o motivo do zero aparece no PROPRIO link, sem precisar abrir',
      !!btn && btn.textContent.indexOf('porque o NET era igual ao de Flora SP, que ficou com as cargas') >= 0,
      btn && btn.textContent);
    if (btn && modelo) {
      btn.dispatchEvent(new d.defaultView.Event('click'));
      T('clique expande: classe hide sai, aria-expanded vira "true"',
        !modelo.classList.contains('hide') && btn.getAttribute('aria-expanded') === 'true');
      btn.dispatchEvent(new d.defaultView.Event('click'));
      T('clique de novo recolhe: classe hide volta, aria-expanded vira "false"',
        modelo.classList.contains('hide') && btn.getAttribute('aria-expanded') === 'false');
    }
  }
  // sem motivo_zero_otimo (campo ausente: semana sem pacote, ou modo Mes):
  // frase fica so no fato, sem arriscar dizer o porque.
  {
    const d = await montarTela(pZeroModelo);
    T('sem motivo_zero_otimo: frase fica so no fato, sem motivo',
      frase(d).trim() === 'Recebeu 900 t, mas o modelo não mandaria nada para cá.', frase(d));
  }

  // ---------- coluna "Modo" na tabela de semanas do periodo ----------
  {
    const semanasComModo = [
      Object.assign({}, semana38, { tem_pacote: true, modo: 'mercado' }),
      Object.assign({}, semana38, { semana: 37, tem_pacote: true, modo: 'prioridade' }),
      Object.assign({}, semana38, { semana: 36, tem_pacote: true, modo: null })
    ];
    const d = await montarTela(pZeroModelo, semanasComModo);
    const linhas = [...d.querySelectorAll('tr')].map(tr => tr.textContent);
    T('coluna Modo mostra "Mercado livre" pra semana fechada em modo mercado',
      linhas.some(l => l.indexOf('Mercado livre') >= 0), linhas.join(' | '));
    T('coluna Modo mostra "Prioridade de volume" pra semana fechada em modo prioridade',
      linhas.some(l => l.indexOf('Prioridade de volume') >= 0), linhas.join(' | '));
    const linha36 = linhas.find(l => l.indexOf('36/2026') >= 0);
    T('semana fechada antes da coluna existir (modo null) mostra "-" na coluna Modo, nao um rotulo',
      !!linha36 && linha36.indexOf('Mercado livre') === -1 && linha36.indexOf('Prioridade de volume') === -1,
      linha36);
  }

  // ---------- caso "nao entrou na semana" continua intacto (nao e "sem
  // comparação", e um terceiro motivo que ja existia) — precisa de outra
  // propria com volume de verdade na mesma tela, senao "Fábricas próprias"
  // nem chega a renderizar (regra de sempre: cont.temDado). ----------
  {
    const mockFetch = async url => {
      if (url === '/api/semanas') return respFake(200, [semana38]);
      if (url === '/api/consolidado?semana=2026-38') {
        return respFake(200, consolFake('semana', {
          ano: 2026, semana: 38,
          porPropria: [
            {
              cliente: 'Flora GO', ton_realizado: 0, net_realizado: null,
              net_ter_realizado: null, net_ter_melhor_realizado: null, n_ter_realizado: null,
              ton_comp_realizado: 0, saving_realizado: null,
              ton_otimo: 0, net_otimo: null, net_ter_otimo: null, net_ter_melhor_otimo: null,
              n_ter_otimo: null, ton_comp_otimo: 0, saving_otimo: null
            },
            {
              cliente: 'JBS - BioPower Lins', ton_realizado: 900, net_realizado: 5300,
              net_ter_realizado: 5100, net_ter_melhor_realizado: 5200, n_ter_realizado: 3,
              ton_comp_realizado: 900, saving_realizado: 180000,
              ton_otimo: 900, net_otimo: 5300, net_ter_otimo: 5100, net_ter_melhor_otimo: 5200,
              n_ter_otimo: 3, ton_comp_otimo: 900, saving_otimo: 180000
            }
          ],
          semanasFechadas: [Object.assign({}, semana38, { tem_pacote: true })],
          total: { toneladas: 900, net_medio: 5300, semanas: 1 }
        }));
      }
      return respFake(404, {});
    };
    const dom = carregarPagina('https://x/?semana=2026-38', mockFetch);
    await new Promise(r => setTimeout(r, 150));
    const d = dom.window.document;
    const florago = [...d.querySelectorAll('.fab')].find(f => f.querySelector('.nome').textContent.indexOf('Flora GO') >= 0);
    T('card da Flora GO ("nao entrou") encontrado ao lado do que tem volume', !!florago);
    T('"nao entrou na semana" continua distinto de "modelo sem comparação"',
      !!florago && florago.querySelector('.veredito').textContent.trim() === 'não entrou na semana',
      florago && florago.querySelector('.veredito').textContent);
  }

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
