// Cabecalho compacto no celular (media query max-width:640px) — deixa mais
// espaco pro conteudo: subtitulo do topo some (a mesma info ja aparece no
// cabecalho da semana), bloco do usuario vira um icone discreto que abre
// Trocar senha/Sair num popover, e as margens entre logo/menu/semanas
// salvas/cards encolhem. O jsdom nao tem motor de layout de verdade (nao da
// pra medir getBoundingClientRect/scrollHeight por CSS de media query), entao
// aqui a checagem e sobre a marcacao (o toggle existe e aponta pros mesmos
// ids que ui.js ja usa) e sobre o texto fonte do CSS dentro do bloco
// @media(max-width:640px) do public/index.html gerado pelo build.
process.chdir(__dirname);
const fs = require('fs');
const PAINEL = require('path').join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(PAINEL, 'utf8');
let ok = 0, bad = 0;
const T = (n, c, x) => { c ? ok++ : bad++; console.log((c ? '  ok  ' : '  FALHA ') + n + (x !== undefined ? ' — ' + x : '')); };

// ---------- isola o bloco do media query de celular ----------
const iniMedia = html.indexOf('@media(max-width:640px)');
T('media query de celular existe no CSS', iniMedia >= 0);
const fimMedia = html.indexOf('\n}', html.lastIndexOf('@media', html.length)); // fallback, recalculado abaixo
// pega ate o proximo "\n}\n\n" apos a abertura (fecha o bloco todo do media query)
let profundidade = 0, fim = -1;
for (let i = html.indexOf('{', iniMedia); i < html.length; i++) {
  if (html[i] === '{') profundidade++;
  else if (html[i] === '}') { profundidade--; if (profundidade === 0) { fim = i; break; } }
}
const cssMobile = html.slice(iniMedia, fim + 1);
T('bloco de celular isolado tem conteudo', cssMobile.length > 200);

// ---------- item 2: subtitulo do topo some no celular ----------
T('#sub fica display:none dentro do media query de celular',
  /\.htitle p\{[^}]*display:none/.test(cssMobile) || /#sub\{[^}]*display:none/.test(cssMobile),
  cssMobile.match(/\.htitle p\{[^}]*\}/));

// ---------- desktop continua mostrando o subtitulo (fora do media query) ----------
const cssForaDoMobile = html.slice(0, iniMedia) + html.slice(fim + 1);
T('fora do media query, #sub nao tem display:none (desktop intocado)',
  !/#sub\{[^}]*display:none/.test(cssForaDoMobile));

// ---------- item 3: cabecalho da semana em fonte reduzida no celular ----------
const tituloMobile = cssMobile.match(/\.semanaHome \.titulo\{([^}]*)\}/);
T('.semanaHome .titulo tem regra propria no celular', !!tituloMobile, tituloMobile);
if (tituloMobile) {
  const tamMobile = parseFloat((tituloMobile[1].match(/font-size:([\d.]+)px/) || [])[1]);
  const tamDesktop = parseFloat((cssForaDoMobile.match(/\.semanaHome \.titulo\{[^}]*font-size:([\d.]+)px/) || [])[1]);
  T('fonte do titulo da semana no celular e menor que no desktop',
    tamMobile > 0 && tamDesktop > 0 && tamMobile < tamDesktop, tamMobile + ' vs ' + tamDesktop);
}
const situacaoMobile = cssMobile.match(/\.semanaHome \.situacao\{([^}]*)\}/);
T('.semanaHome .situacao tem regra propria no celular', !!situacaoMobile, situacaoMobile);

// ---------- item 1: bloco do usuario compacto (icone, sem duas linhas) ----------
T('marcacao tem o checkbox #userToggle', /<input[^>]*id="userToggle"/.test(html));
T('marcacao tem o label .userIcon apontando pro checkbox (for="userToggle")',
  /<label[^>]*for="userToggle"[^>]*class="userIcon"/.test(html) ||
  /<label[^>]*class="userIcon"[^>]*for="userToggle"/.test(html));
T('#lnkTrocarSenha continua existindo com o mesmo id (ui.js liga nele)', /id="lnkTrocarSenha"/.test(html));
T('#lnkSair continua existindo com o mesmo id (ui.js liga nele)', /id="lnkSair"/.test(html));
T('#stamp continua existindo com o mesmo id (ui.js escreve nele)', /id="stamp"/.test(html));
T('.userIcon fica visivel (display:flex) no celular', /\.userIcon\{[^}]*display:flex/.test(cssMobile));
T('.userIcon fica escondido (display:none) fora do celular (desktop)',
  /\.userIcon\{display:none\}/.test(cssForaDoMobile));
T('.hlinks so aparece no celular quando o checkbox esta marcado (popover)',
  /\.userToggle:checked ~ \.hlinks\{[^}]*display:flex/.test(cssMobile));
T('.stamp (Operando agora + nome) some no celular, so fica visivel no popover',
  /\.hright \.stamp\{[^}]*display:none/.test(cssMobile));

// ---------- item 4: margens reduzidas no celular ----------
const headerMobile = cssMobile.match(/header\{([^}]*)\}/);
T('header tem margin-bottom reduzida no celular', !!headerMobile && /margin-bottom:\d/.test(headerMobile[1]), headerMobile);
if (headerMobile) {
  const mMobile = parseFloat(headerMobile[1].match(/margin-bottom:(\d+)/)[1]);
  const mDesktop = parseFloat((cssForaDoMobile.match(/header\{[^}]*margin-bottom:(\d+)/) || [])[1]);
  T('margin-bottom do header no celular e menor que no desktop',
    mMobile > 0 && mDesktop > 0 && mMobile < mDesktop, mMobile + ' vs ' + mDesktop);
}
const salvasMobile = cssMobile.match(/#salvasBox\{([^}]*)\}/);
T('#salvasBox tem regra propria de margem/padding reduzida no celular', !!salvasMobile, salvasMobile);
const semanaHomeMobile = cssMobile.match(/\.semanaHome\{([^}]*)\}/);
T('.semanaHome tem margem propria reduzida no celular', !!semanaHomeMobile, semanaHomeMobile);

// ---------- item 5: Semanas salvas continua recolhida (nao mexi na logica) ----------
T('marcacao de #salvasBox continua com a classe hide por padrao',
  /<div id="salvasBox" class="hide">/.test(html));

// ---------- item 6: menu mais baixo no celular ----------
const menuBtnMobile = cssMobile.match(/\.menu \.btn\{([^}]*)\}/);
T('.menu .btn tem regra propria no celular', !!menuBtnMobile, menuBtnMobile);
if (menuBtnMobile) {
  const alturaMobile = parseFloat((menuBtnMobile[1].match(/min-height:(\d+)/) || [])[1]);
  const alturaDesktop = parseFloat((cssForaDoMobile.match(/\.btn\{[^}]*\}/) || [''])[0].match(/min-height:(\d+)/) || []);
  T('altura minima do botao do menu no celular esta definida', alturaMobile > 0, alturaMobile);
}

// ---------- sem travessao em nenhum texto novo desta tarefa ----------
T('nao ha travessao nas regras CSS/markup novas desta tarefa (comentarios podem ter, texto de UI nao)',
  !/aria-label="Conta[^"]*—/.test(html));

// ---------- desktop: linha do cabecalho continua com align-items:flex-end (nao mudou) ----------
T('.hbar fora do celular mantem align-items:flex-end (layout desktop intocado)',
  /\.hbar\{display:flex;align-items:flex-end/.test(cssForaDoMobile));

console.log('\n' + ok + ' OK, ' + bad + ' falhas');
process.exit(bad ? 1 : 0);
