// Tela de upload avulso de Mapa (public/mapas.html) — pagina estatica,
// duplica o parsing de xlsx do core.js (nao passa pelo build). Testa o
// carregamento real do arquivo (pega bug de digitacao na duplicacao) e
// os avisos de lote (mesma semana no lote, ja tem cotacao gravada). A
// gravacao em si fica por revisao de codigo, sem Postgres local.
process.chdir(__dirname);
const path = require('path');
const MAPAS = path.join(__dirname, '..', 'public', 'mapas.html');
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
  let cotacoesExistentes = [];
  const mockFetch = async (url, opts) => {
    if (url === '/api/semanas') return respFake(200, []); // nenhuma semana fechada casa
    if (url === '/api/cotacoes/semanas') return respFake(200, cotacoesExistentes);
    if (url === '/api/cotacoes/lote' && opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      return respFake(200, { ok: true, resultados: body.itens.map(i => ({ ano: i.ano, semana: i.semana, ok: true, gravadas: i.cotacoes.length })) });
    }
    return respFake(404, {});
  };
  const dom = new JSDOM(fs.readFileSync(MAPAS, 'utf8'), {
    runScripts: 'dangerously', url: 'https://x/',
    beforeParse(window) { window.fetch = mockFetch; window.alert = () => {}; }
  });
  const w = dom.window;
  w.DecompressionStream = DecompressionStream;
  w.CompressionStream = CompressionStream;
  w.Response = Response;
  w.Blob = Blob;
  await new Promise(r => setTimeout(r, 100));
  const d = w.document;

  T('pagina carregou sem quebrar', !!d.querySelector('#tabela'));

  // descobre pra qual ano/semana o mapa2.xlsx calcula (sem semana fechada pra casar)
  const sheets = await w.readXlsx(fake('mapa2.xlsx', 'in/mapa2.xlsx'));
  const mapa2 = w.readMapa(sheets);
  const rCalc = w.resolverSemanaDoMapa(mapa2.dataSerial, []);
  T('mapa2.xlsx sem semana fechada cai em calculada', rCalc.status === 'calculada', JSON.stringify(rCalc));

  // agora finge que aquela semana ja tem cotacao gravada, e recarrega a lista
  cotacoesExistentes = [{ ano: rCalc.ano, semana: rCalc.semana }];
  await w.carregarListas();

  // sobe o MESMO mapa duas vezes -> duas linhas na mesma semana calculada
  await w.adicionarArquivos([
    fake('mapa2.xlsx', 'in/mapa2.xlsx'),
    fake('mapa2-de-novo.xlsx', 'in/mapa2.xlsx')
  ]);

  T('as duas linhas do lote foram adicionadas', w.arquivos.length === 2, w.arquivos.length + '');
  T('as duas resolveram para a mesma semana calculada',
    w.arquivos.every(a => a.ano === rCalc.ano && a.semana === rCalc.semana));
  T('aviso de mesma semana no lote', w.arquivos.every(a => a.duplicadoNoLote === true));
  T('aviso de semana que ja tem cotacao gravada', w.arquivos.every(a => a.jaTemCotacao === true));

  const badges = [...d.querySelectorAll('.badge.calculada')];
  T('duas linhas com o selo "calculada" na tela', badges.length === 2, badges.length + '');

  T('botao confirmar habilita (as duas ja tem ano/semana)',
    !d.querySelector('#bConfirmar').disabled);

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
