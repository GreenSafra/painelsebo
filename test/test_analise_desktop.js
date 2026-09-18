// Analise de cotacoes no desktop (public/analise.html, media query
// min-width:901px) — o preco da semana atual nao pode mais quebrar em duas
// linhas ("R$" numa linha, "6.600" noutra), e as tres colunas de semana
// ganham mais largura e espacamento, usando o vao entre o nome do cliente
// e o selo de percentual. Layout do celular (max-width:640px) nao muda. O
// jsdom nao tem motor de layout de verdade (nao da pra medir se o texto
// realmente quebrou linha), entao a checagem e sobre as regras do CSS:
// largura/gap maiores que a base, white-space:nowrap no preco, e que nada
// disso vaza pro bloco de celular.
process.chdir(__dirname);
const fs = require('fs');
const path = require('path');
const ANALISE = path.join(__dirname, '..', 'public', 'analise.html');
const html = fs.readFileSync(ANALISE, 'utf8');
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };

// ---------- isola o bloco @media(min-width:901px) ----------
const iniDesktop = html.indexOf('@media(min-width:901px)');
T('media query de desktop (min-width:901px) existe no CSS', iniDesktop >= 0);
let profundidade = 0, fimDesktop = -1;
for (let i = html.indexOf('{', iniDesktop); i < html.length; i++) {
  if (html[i] === '{') profundidade++;
  else if (html[i] === '}') { profundidade--; if (profundidade === 0) { fimDesktop = i; break; } }
}
const cssDesktop = html.slice(iniDesktop, fimDesktop + 1);
T('bloco de desktop isolado tem conteudo', cssDesktop.length > 30, cssDesktop);

// ---------- item 1: preco numa linha so (sem quebrar "R$" de "6.600") ----------
T('.card .col .pr ganha white-space:nowrap no desktop (nunca quebra o preco)',
  /\.card \.col \.pr\{[^}]*white-space:nowrap/.test(cssDesktop), cssDesktop);

// ---------- item 3: largura e espacamento maiores que a base ----------
const larguraBase = parseFloat((html.slice(0, iniDesktop).match(/\.card \.col\{flex:none;width:(\d+)px/) || [])[1]);
const larguraDesktop = parseFloat((cssDesktop.match(/\.card \.col\{width:(\d+)px/) || [])[1]);
T('.card .col tem regra propria no desktop, mais larga que a base',
  larguraDesktop > 0 && larguraBase > 0 && larguraDesktop > larguraBase,
  larguraDesktop + ' vs base ' + larguraBase);

const gapBase = parseFloat((html.slice(0, iniDesktop).match(/\.card \.semanas\{flex:none;display:flex;gap:(\d+)px/) || [])[1]);
const gapDesktop = parseFloat((cssDesktop.match(/\.card \.semanas\{gap:(\d+)px/) || [])[1]);
T('.card .semanas tem gap maior no desktop que a base (mais espaco entre as colunas)',
  gapDesktop > 0 && gapBase > 0 && gapDesktop > gapBase,
  gapDesktop + ' vs base ' + gapBase);

// ---------- item 2: estrutura de 3 linhas por coluna e o selo continuam
// intactos (nao reescrevi a marcacao, so o espacamento) ----------
T('rotulo (.rot), preco (.pr) e variacao (.dif) continuam existindo (estrutura de 3 linhas)',
  /\.card \.col \.rot\{/.test(html) && /\.card \.col \.pr\{/.test(html) && /\.card \.col \.dif\{/.test(html));
T('selo de variacao percentual (.var) continua existindo', /\.card \.var\{/.test(html));

// ---------- item 4: layout do celular nao muda (o bloco max-width:640px
// continua com os valores de sempre, sem nenhuma regra nova do desktop
// vazando pra dentro dele) ----------
const iniMobile = html.indexOf('@media(max-width:640px)');
T('media query de celular ainda existe', iniMobile >= 0);
T('a regra de desktop vem DEPOIS da de celular (nao se sobrepoe, escopos separados)',
  iniDesktop > iniMobile);
let profMobile = 0, fimMobile = -1;
for (let i = html.indexOf('{', iniMobile); i < html.length; i++) {
  if (html[i] === '{') profMobile++;
  else if (html[i] === '}') { profMobile--; if (profMobile === 0) { fimMobile = i; break; } }
}
const cssMobile = html.slice(iniMobile, fimMobile + 1);
T('bloco de celular nao ganhou white-space:nowrap novo (nao mexi nele)',
  !/\.card \.col \.pr\{[^}]*white-space:nowrap/.test(cssMobile));
T('bloco de celular continua com .col dividindo a largura (flex:1 1 0), nao com largura fixa nova',
  /\.card \.col\{flex:1 1 0/.test(cssMobile));

console.log('\n' + ok + ' OK, ' + bad + ' falhas');
process.exit(bad ? 1 : 0);
