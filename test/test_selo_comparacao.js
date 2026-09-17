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
    T('selo mostra "modelo sem comparação", nao um valor calculado contra zero',
      v.textContent.trim() === 'modelo sem comparação', v.textContent);
    T('selo fica em cinza (nao neg nem pos)',
      !v.querySelector('.neg') && !v.querySelector('.pos'), v.innerHTML);
    T('nao aparece "acima do modelo" nem "deixados na mesa" nem "custou" (texto antigo, comparando com zero)',
      !/acima do modelo|deixados na mesa|custou/.test(v.textContent), v.textContent);
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
    T('selo tambem mostra "modelo sem comparação" (nenhum dos dois lados tem media)',
      v.textContent.trim() === 'modelo sem comparação', v.textContent);
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
    T('caso normal: selo mostra um valor de verdade (deixados na mesa), nao "sem comparação"',
      v.textContent.indexOf('sem comparação') === -1 && v.textContent.indexOf('deixados na mesa') >= 0,
      v.textContent);
    T('valor do selo bate com a diferenca real (360000 - 180000 = 180000)',
      v.textContent.indexOf('180.000') >= 0 || v.textContent.indexOf('180000') >= 0, v.textContent);
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
