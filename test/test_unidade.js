// Casamento de unidade do Mapa (coluna "Unidades JBS") com a sigla da
// Programação — criarResolvedor()/montar() em core.js. Cobre o bug real:
// "Diamantino" com a UF colada ("Diamantino MT", "Diamantino/MT",
// "Diamantino - MT") nao casava com a Programação, que tem so "DIAMANTINO"
// na coluna cidade. A UF colada e ruido de digitação do Mapa, nao faz parte
// do nome da cidade — sem tirar isso, nem o match exato nem a abreviatura
// (que exige toda palavra da consulta casar) resolviam, e sobrava so a
// similaridade por bigrama, sujeita a cair abaixo do corte conforme o texto.
process.chdir(__dirname);
const path = require('path');
const PAINEL = path.join(__dirname, '..', 'public', 'index.html');
const fs = require('fs');
const { JSDOM } = require('jsdom');

let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x ? ' — ' + x : '')); };

const html = fs.readFileSync(PAINEL, 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x/' });
const w = dom.window;
w.DecompressionStream = DecompressionStream;
w.CompressionStream = CompressionStream;
w.Response = Response;
w.Blob = Blob;

function fake(name, p) {
  const b = fs.readFileSync(p);
  return { name, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
}

(async () => {
  await new Promise(r => setTimeout(r, 60));

  const prod = w.readProducao(await w.readXlsx(fake('prog3.xlsx', 'in/prog3.xlsx')));
  const dmt = prod.plants.find(p => p.sigla === 'DMT');
  T('Programação de teste tem DMT em Diamantino', !!dmt && /diamantino/i.test(dmt.cidade),
    JSON.stringify(dmt));

  const resolve = w.criarResolvedor(prod.plants);

  T('nome exato casa', JSON.stringify(resolve('Diamantino')) === '["DMT"]');
  T('maiusculo casa', JSON.stringify(resolve('DIAMANTINO')) === '["DMT"]');
  T('UF colada com espaço casa (bug relatado)', JSON.stringify(resolve('Diamantino MT')) === '["DMT"]');
  T('UF colada com barra casa', JSON.stringify(resolve('Diamantino/MT')) === '["DMT"]');
  T('UF colada com hífen casa', JSON.stringify(resolve('Diamantino - MT')) === '["DMT"]');
  T('UF colada minúscula casa', JSON.stringify(resolve('diamantino mt')) === '["DMT"]');

  // regressao: abreviatura de cidade com "de/do/da" continua funcionando
  // (São M. Guaporé -> São Miguel do Guaporé, SMG)
  T('abreviatura de cidade continua funcionando (regressão)',
    JSON.stringify(resolve('São M. Guaporé')) === '["SMG"]');

  // regressao: unidade sem nenhuma correspondência real continua vazia —
  // a tolerância a UF colada não pode virar "casa com qualquer coisa"
  T('cidade inexistente continua sem casar (regressão)',
    resolve('Cidade Que Não Existe No Cadastro').length === 0);

  // fim a fim: montar() nao deve reportar Diamantino como naoMapeadas
  // quando o Mapa manda a UF colada ao nome da unidade
  const mapaFake = {
    rows: [{ i: 0, un: 'Diamantino MT', uf: 'MT', cli: 'Cliente Teste', dst: 'Cuiabá, MT',
      of: 5000, net: 4800, icms: 0, pis: 0.00925, fcli: 0, modal: 'CIF' }]
  };
  const ds = w.montar(prod, [], mapaFake);
  T('montar(): Diamantino MT não fica em naoMapeadas', ds.naoMapeadas.length === 0,
    JSON.stringify(ds.naoMapeadas));
  T('montar(): a cotação foi atribuída à sigla DMT', ds.quotes.some(q => q.sigla === 'DMT'));

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
