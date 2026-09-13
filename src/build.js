// Monta public/index.html a partir dos fontes desta pasta.
// Uso:  node src/build.js      (a partir da raiz do projeto)
//   ou: node build.js          (a partir de dentro de src/)
const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const RAIZ = path.join(SRC, '..');
const SAIDA = path.join(RAIZ, 'public', 'index.html');

const ler = n => fs.readFileSync(path.join(SRC, n), 'utf8');
const json = n => JSON.stringify(JSON.parse(ler(n)));

const shell = ler('shell.html');
const core = ler('core.js');
let ui = ler('ui.js');

ui = ui.replace('/*__STATES__*/{}', () => json('states.json'))
       .replace('/*__LOGOS__*/{}', () => json('logos.json'))
       .replace('/*__CIDADES__*/{}', () => json('cidades.json'));

const out = shell.replace('/*__CORE__*/', () => core)
                 .replace('/*__UI__*/', () => ui);

fs.writeFileSync(SAIDA, out);
console.log('gravado: ' + SAIDA);
console.log('bytes:   ' + Buffer.byteLength(out, 'utf8'));
