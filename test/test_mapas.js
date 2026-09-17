// Bloco "Cotações do Mapa" dentro de /importar (public/index.html) — upload
// avulso de Mapa, sem abrir semana nenhuma. Testa o carregamento real do
// arquivo, os avisos de lote (mesma semana no lote, já tem cotação
// gravada), a lista "Mapas gravados" (listagem e exclusão) e a remoção de
// arquivo da seleção antes de gravar. A gravação em si fica por revisão de
// código, sem Postgres local, mesmo padrão das levas anteriores.
process.chdir(__dirname);
const path = require('path');
const PAINEL = path.join(__dirname, '..', 'public', 'index.html');
const fs = require('fs');
const { JSDOM } = require('jsdom');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

const respFake = (status, corpo) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => corpo
});

function fake(name, p) {
  const b = fs.readFileSync(p);
  return { name, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
}

(async () => {
  // semana ja gravada, sem nenhuma relacao com o mapa2.xlsx do teste —
  // serve pra provar que excluir UMA semana nao afeta a outra.
  const semanaX = {
    ano: 2025, semana: 10, linhas: 12, clientes: 5, data_cotacao: '2025-03-06T00:00:00.000Z'
  };
  let cotacoesExistentes = [semanaX];
  const chamadas = [];

  const mockFetch = async (url, opts) => {
    chamadas.push({ url, method: (opts && opts.method) || 'GET' });
    if (url === '/api/semanas') return respFake(200, []); // nenhuma semana fechada casa
    if (url === '/api/cotacoes/semanas') return respFake(200, cotacoesExistentes);
    if (url === '/api/cotacoes/lote' && opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      return respFake(200, { ok: true, resultados: body.itens.map(i => ({ ano: i.ano, semana: i.semana, ok: true, gravadas: i.cotacoes.length })) });
    }
    if (url.indexOf('/api/cotacoes?') === 0 && opts && opts.method === 'DELETE') {
      const p = new URLSearchParams(url.slice(url.indexOf('?')));
      const ano = Number(p.get('ano')), semana = Number(p.get('semana'));
      cotacoesExistentes = cotacoesExistentes.filter(c => !(c.ano === ano && c.semana === semana));
      return respFake(200, { ok: true, apagadas: 1 });
    }
    return respFake(404, {});
  };
  const dom = new JSDOM(fs.readFileSync(PAINEL, 'utf8'), {
    runScripts: 'dangerously', url: 'https://x/importar',
    beforeParse(window) { window.fetch = mockFetch; window.alert = () => {}; }
  });
  const w = dom.window;
  w.DecompressionStream = DecompressionStream;
  w.CompressionStream = CompressionStream;
  w.Response = Response;
  w.Blob = Blob;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.Element.prototype.scrollIntoView = function () {};
  await new Promise(r => setTimeout(r, 150));
  const d = w.document;

  T('página carregou sem quebrar', !!d.querySelector('#cotTabela'));
  T('abriu direto em /importar (URL pedida)', !d.querySelector('#importBox').classList.contains('hide'));

  // ---------- listagem de Mapas gravados ----------
  T('lista de Mapas gravados mostra a semana existente',
    d.querySelector('#cotGravados').textContent.indexOf('10/2025') >= 0);
  T('lista de Mapas gravados mostra linhas e clientes',
    d.querySelector('#cotGravados').textContent.indexOf('12') >= 0 &&
    d.querySelector('#cotGravados').textContent.indexOf('5') >= 0);
  T('data da cotação formatada em dd/mm/aaaa',
    d.querySelector('#cotGravados').textContent.indexOf('06/03/2025') >= 0);

  // descobre pra qual ano/semana o mapa2.xlsx calcula (sem semana fechada pra casar)
  const sheets = await w.readXlsx(fake('mapa2.xlsx', 'in/mapa2.xlsx'));
  const mapa2 = w.readMapa(sheets);
  const rCalc = w.resolverSemanaDoMapa(mapa2.dataSerial, []);
  T('mapa2.xlsx sem semana fechada cai em calculada', rCalc.status === 'calculada', JSON.stringify(rCalc));

  // agora finge que aquela semana ja tem cotacao gravada tambem, e recarrega a lista
  const semanaMapa2 = { ano: rCalc.ano, semana: rCalc.semana, linhas: 8, clientes: 4, data_cotacao: null };
  cotacoesExistentes = [semanaX, semanaMapa2];
  await w.cotCarregarListas();
  w.cotRenderGravados();

  T('as duas semanas gravadas aparecem na lista',
    d.querySelectorAll('#cotGravados tbody tr').length === 2);

  // sobe o MESMO mapa duas vezes -> duas linhas na mesma semana calculada
  await w.cotAdicionarArquivos([
    fake('mapa2.xlsx', 'in/mapa2.xlsx'),
    fake('mapa2-de-novo.xlsx', 'in/mapa2.xlsx')
  ]);

  T('as duas linhas do lote foram adicionadas', w.COT_ARQUIVOS.length === 2, w.COT_ARQUIVOS.length + '');
  T('as duas resolveram para a mesma semana calculada',
    w.COT_ARQUIVOS.every(a => a.ano === rCalc.ano && a.semana === rCalc.semana));
  T('aviso de mesma semana no lote', w.COT_ARQUIVOS.every(a => a.duplicadoNoLote === true));
  T('aviso de semana que ja tem cotacao gravada', w.COT_ARQUIVOS.every(a => a.jaTemCotacao === true));

  const badges = [...d.querySelectorAll('.cotbadge.calculada')];
  T('duas linhas com o selo "calculada" na tela', badges.length === 2, badges.length + '');

  T('botao confirmar habilita (as duas ja tem ano/semana)',
    !d.querySelector('#cotBConfirmar').disabled);

  // ---------- remocao de arquivo da selecao (antes de gravar) ----------
  const nomeRemovido = w.COT_ARQUIVOS[0].nome;
  const nomeRestante = w.COT_ARQUIVOS[1].nome;
  const btnRemover = d.querySelector('button[data-remover="0"]');
  T('botao remover existe na linha do arquivo selecionado', !!btnRemover);
  btnRemover.dispatchEvent(new w.Event('click'));

  T('remover tira o arquivo da selecao (nao chama gravacao)', w.COT_ARQUIVOS.length === 1, w.COT_ARQUIVOS.length + '');
  T('sobrou o outro arquivo, nao o removido',
    w.COT_ARQUIVOS[0].nome === nomeRestante && w.COT_ARQUIVOS[0].nome !== nomeRemovido);
  T('a tabela de selecionados reflete a remocao',
    d.querySelectorAll('#cotTabela tbody tr').length === 1);
  T('nenhuma chamada de gravacao foi feita so por remover da selecao',
    !chamadas.some(c => c.url === '/api/cotacoes/lote'));

  // ---------- exclusao de uma semana gravada (a outra continua) ----------
  const btnExcluirX = d.querySelector('button[data-ano="2025"][data-semana="10"]');
  T('botao excluir existe na linha da semana gravada', !!btnExcluirX);

  w.confirm = () => false;
  btnExcluirX.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 40));
  T('cancelar a confirmacao nao chama DELETE', !chamadas.some(c => c.method === 'DELETE'));
  T('semana continua na lista apos cancelar',
    d.querySelector('#cotGravados').textContent.indexOf('10/2025') >= 0);

  w.confirm = () => true;
  btnExcluirX.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 100));
  const dels = chamadas.filter(c => c.method === 'DELETE');
  T('confirmar chama DELETE /api/cotacoes com ano e semana certos',
    dels.length === 1 && dels[0].url === '/api/cotacoes?ano=2025&semana=10',
    dels.map(c => c.url).join(', '));
  T('a semana excluida some da lista', d.querySelector('#cotGravados').textContent.indexOf('10/2025') === -1);
  T('a outra semana gravada continua na lista',
    d.querySelector('#cotGravados').textContent.indexOf(rCalc.semana + '/' + rCalc.ano) >= 0);
  T('so restou uma linha na lista de Mapas gravados',
    d.querySelectorAll('#cotGravados tbody tr').length === 1);

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
