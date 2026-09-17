// Roda as dez baterias em sequencia e resume o resultado.
// Uso: cd test && node rodar.js
const { execFileSync } = require('child_process');
const path = require('path');

const BATERIAS = [
  'test_ui.js', 'test_nec.js', 'test_rt.js', 'test_vazio.js', 'test_prog.js',
  'test_modelo.js', 'test_troca.js', 'test_modal.js', 'test_mobile.js', 'test_modo.js', 'test_tabela.js',
  'test_fechar.js', 'test_resumo.js', 'test_rascunho.js', 'test_consolidado.js', 'test_admin.js',
  'test_cotacoes.js', 'test_mapas.js', 'test_senha.js', 'test_unidade.js', 'test_reabrir.js',
  'test_preenchida.js'
];

let falhou = [];
let totalOk = 0, totalBad = 0;

for (const b of BATERIAS) {
  let saida = '', erro = false;
  try {
    saida = execFileSync(process.execPath, [path.join(__dirname, b)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024
    });
  } catch (e) {
    saida = (e.stdout || '') + (e.stderr || '');
    erro = true;
  }
  const ok = (saida.match(/^ {2}(ok|OK) {2}/gm) || []).length;
  const bad = (saida.match(/^ {2}FALHA /gm) || []).length;
  totalOk += ok; totalBad += bad;
  // zero verificacoes tambem e problema: quer dizer que a bateria nao rodou
  const bomb = bad > 0 || erro || ok === 0;
  if (bomb) { falhou.push(b); console.log(saida); }
  console.log((bomb ? 'FALHOU  ' : 'passou  ') + b.padEnd(18) + ok + ' ok, ' + bad + ' falha(s)');
}

console.log('\n--------------------------------------');
console.log('total: ' + totalOk + ' verificacoes ok, ' + totalBad + ' falha(s)');
if (falhou.length) {
  console.log('BATERIAS COM PROBLEMA: ' + falhou.join(', '));
  process.exit(1);
}
console.log('TUDO CERTO');
