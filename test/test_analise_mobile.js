// Analise de cotacoes no celular (public/analise.html, media query
// max-width:640px) — cada card vira duas linhas: posicao+nome completo+selo
// em cima, as tres semanas dividindo a largura toda do card embaixo, sem
// cortar nenhuma coluna. O jsdom nao tem motor de layout de verdade (nao da
// pra medir se algo realmente quebrou linha ou estourou a borda), entao a
// checagem e sobre a marcacao (o card continua com .pos/.nome/.var/.semanas
// como irmaos, igual no desktop) e sobre o texto fonte do CSS dentro do
// bloco @media(max-width:640px): nome sem truncar (sem ellipsis/nowrap),
// selo antes da faixa de semanas na ordem visual, e as tres colunas
// dividindo a largura sem overflow escondendo nenhuma.
process.chdir(__dirname);
const fs = require('fs');
const path = require('path');
const ANALISE = path.join(__dirname, '..', 'public', 'analise.html');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(ANALISE, 'utf8');
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };

// ---------- isola o bloco do media query de celular ----------
const iniMedia = html.indexOf('@media(max-width:640px)');
T('media query de celular (640px) existe no CSS', iniMedia >= 0);
let profundidade = 0, fim = -1;
for (let i = html.indexOf('{', iniMedia); i < html.length; i++) {
  if (html[i] === '{') profundidade++;
  else if (html[i] === '}') { profundidade--; if (profundidade === 0) { fim = i; break; } }
}
const cssMobile = html.slice(iniMedia, fim + 1);
const cssForaDoMobile = html.slice(0, iniMedia) + html.slice(fim + 1);
T('bloco de celular isolado tem conteudo', cssMobile.length > 200);

// ---------- item 1: nome completo, sem truncar (sem ellipsis/nowrap no celular) ----------
const nomeMobile = cssMobile.match(/\.card \.nome\{([^}]*)\}/);
T('.card .nome tem regra propria no celular', !!nomeMobile, nomeMobile);
if (nomeMobile) {
  T('nome no celular quebra linha (white-space:normal), nao trava em uma linha so',
    /white-space:normal/.test(nomeMobile[1]), nomeMobile[1]);
  T('nome no celular nao trunca com reticencias (sem text-overflow:ellipsis)',
    !/text-overflow:ellipsis/.test(nomeMobile[1]), nomeMobile[1]);
  T('nome no celular nao esconde o texto que passar da borda (sem overflow:hidden)',
    !/overflow:hidden/.test(nomeMobile[1]), nomeMobile[1]);
}
T('fora do celular, o nome continua truncando com reticencias (desktop intocado)',
  /\.card \.nome\{[^}]*text-overflow:ellipsis/.test(cssForaDoMobile));

// ---------- item 1: selo de variacao na primeira linha (antes das semanas, na ordem visual) ----------
const ordemPos = +((cssMobile.match(/\.card \.pos\{[^}]*order:(\d+)/) || [])[1]);
const ordemNome = +((cssMobile.match(/\.card \.nome\{[^}]*order:(\d+)/) || [])[1]);
const ordemVar = +((cssMobile.match(/\.card \.var\{[^}]*order:(\d+)/) || [])[1]);
const ordemSemanas = +((cssMobile.match(/\.card \.semanas\{[^}]*order:(\d+)/) || [])[1]);
T('pos, nome e selo tem ordem visual definida e vem antes das semanas',
  [ordemPos, ordemNome, ordemVar, ordemSemanas].every(n => n > 0) &&
  ordemVar < ordemSemanas, { ordemPos, ordemNome, ordemVar, ordemSemanas });
T('nenhuma coluna de semana entra na primeira linha (semanas ocupa 100% da largura, propria linha)',
  /\.card \.semanas\{[^}]*flex:1 1 100%/.test(cssMobile) && /\.card \.semanas\{[^}]*width:100%/.test(cssMobile));

// ---------- item 2 e 3: as tres colunas cabem na largura do card, nenhuma cortada ----------
const semanasMobile = cssMobile.match(/\.card \.semanas\{([^}]*)\}/);
T('.semanas no celular nao rola escondendo coluna (sem overflow-x:auto/scroll)',
  !!semanasMobile && !/overflow-x:(auto|scroll)/.test(semanasMobile[1]), semanasMobile);
const colMobile = cssMobile.match(/\.card \.col\{([^}]*)\}/);
T('.col no celular divide a largura em partes iguais (flex:1 1 0), nao largura fixa',
  !!colMobile && /flex:1 1 0/.test(colMobile[1]), colMobile);
T('.col no celular pode encolher (min-width:0, nao trava com width fixo)',
  !!colMobile && /width:auto/.test(colMobile[1]) && /min-width:0/.test(colMobile[1]), colMobile);
T('fora do celular, .col continua com largura fixa (desktop intocado)',
  /\.card \.col\{flex:none;width:60px/.test(cssForaDoMobile));

// ---------- item 5: titulo/subtitulo menores e seletor de semana subindo pro topo ----------
const h1Mobile = cssMobile.match(/\bh1\{([^}]*)\}/);
T('h1 tem regra propria reduzida no celular', !!h1Mobile, h1Mobile);
if (h1Mobile) {
  const tamMobile = parseFloat((h1Mobile[1].match(/font-size:([\d.]+)px/) || [])[1]);
  const tamDesktop = parseFloat((cssForaDoMobile.match(/\bh1\{[^}]*font-size:([\d.]+)px/) || [])[1]);
  T('fonte do h1 no celular e menor que no desktop', tamMobile > 0 && tamDesktop > 0 && tamMobile < tamDesktop,
    tamMobile + ' vs ' + tamDesktop);
}
T('input de semana entra na mesma grade do cabecalho no celular (grid-area:inp)',
  /input\[type=week\]\{[^}]*grid-area:inp/.test(cssMobile));
T('header vira grid no celular, com o titulo e o input na mesma linha (grid-template-areas com "tit inp")',
  /grid-template-areas:"tit inp"/.test(cssMobile));
const hrMobile = cssMobile.match(/\bhr\{([^}]*)\}/);
T('hr com margem reduzida no celular (menos vao antes do primeiro card)', !!hrMobile, hrMobile);
if (hrMobile) {
  const somaMobile = (hrMobile[1].match(/margin:([\d.]+)px 0 ([\d.]+)px/) || []).slice(1).map(Number);
  const somaDesktop = (cssForaDoMobile.match(/\bhr\{[^}]*margin:([\d.]+)px 0 ([\d.]+)px/) || []).slice(1).map(Number);
  T('soma das margens do hr no celular e menor que no desktop',
    somaMobile.length === 2 && somaDesktop.length === 2 &&
    (somaMobile[0] + somaMobile[1]) < (somaDesktop[0] + somaDesktop[1]),
    somaMobile + ' vs ' + somaDesktop);
}

// ---------- markup: card continua com pos/nome/var/semanas como irmaos ----------
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://x/',
  beforeParse(window) {
    window.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
  }
});
(async () => {
  await new Promise(r => setTimeout(r, 60));
  const d = dom.window.document;
  T('pagina continua carregando sem quebrar com o CSS novo', !!d.querySelector('#conteudo'));

  // ---------- sem travessao em texto novo desta tarefa ----------
  T('sem travessao nos comentarios/regras novas do bloco mobile', !/—/.test(cssMobile));

  console.log('\n' + ok + ' OK, ' + bad + ' falhas');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERRO:', e.message, e.stack); process.exit(1); });
