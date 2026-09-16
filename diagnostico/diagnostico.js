// Diagnostico das grafias de origem na tabela cotacoes, antes de evoluir
// public/analise.html. Script descartavel: roda sozinho, sem banco.
//
// COMO USAR COM O DADO REAL:
//   1. Rode no Postgres: SELECT cliente, origem, oferta, ano, semana FROM cotacoes;
//   2. Cole o resultado (formato {cliente, origem, oferta, ano, semana}) no
//      lugar do array DADOS logo abaixo, no lugar de gerarAmostraSintetica().
//   3. `node diagnostico.js` — imprime o relatorio no console e grava
//      diagnostico.html do lado deste arquivo.
//
// SEM o dump real, o script roda com uma amostra sintetica (gerada de
// proposito, com semente fixa — mesma saida toda vez) so pra provar que a
// logica de agrupamento de grafias funciona nos exemplos pedidos: Rio Branco,
// Juina, Maraba, Juara, Cuiaba, Pontes e Lacerda. Os numeros de clientes por
// semana e a faixa de preco NAO refletem o banco de verdade.

const fs = require('fs');
const path = require('path');

/* ====================== amostra sintetica (troque por DADOS reais) ====================== */

// LCG simples, so pra amostra sair sempre igual entre execucoes.
function rng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gerarAmostraSintetica() {
  const rand = rng(20260928);
  const escolhe = arr => arr[Math.floor(rand() * arr.length)];

  // pares "mesma cidade, grafia diferente" — exatamente os exemplos pedidos
  const VARIANTES = [
    ['Rio Branco', 'Rio branco'],
    ['Juína', 'Juina'],
    ['Marabá', 'Maraba'],
    ['Juara', 'Juara - MT'],
    ['Cuiabá', 'Cuiaba'],
    ['Pontes e Lacerda', 'Pontes  Lacerda']
  ];
  const CIDADES_ESTAVEIS = ['Barra do Garças', 'Sinop', 'Lucas do Rio Verde', 'Nova Mutum', 'Sorriso'];
  const TODAS_CIDADES = VARIANTES.flatMap(v => v).concat(CIDADES_ESTAVEIS);

  // pool maior que o numero ativo por semana, pra ter entrada/saida entre semanas
  const POOL_CLIENTES = [
    'Frigorífico Rio Verde', 'Boi Manso Comércio', 'Agropecuária Central',
    'Sebo Nobre Ltda', 'Comercial Pantanal', 'Rendering Cerrado',
    'Distribuidora Oeste', 'Sebo & Cia', 'Nortão Insumos',
    'Central de Gorduras MT', 'Bioinsumos Tapajós', 'Matriz Rendering',
    'Casa do Sebo', 'Origem Animal Ltda', 'Vale do Rio Sebo',
    'Querência Comércio', 'São José Insumos', 'Feliz Natal Rendering',
    'Nova Ubiratã Sebo', 'Campo Verde Trading', 'Barra do Bugres Insumos',
    'Tangará da Serra Sebo'
  ];

  const linhas = [];
  const precoBase = new Map(POOL_CLIENTES.map(c => [c, 4200 + Math.floor(rand() * 4500)]));

  for (let semana = 28; semana <= 38; semana++) {
    // quantidade de clientes ativos varia semana a semana, com um pouco de
    // churn (simula cliente que some ou aparece), igual ao que se ve na serie real
    const nAtivos = 11 + Math.floor(rand() * 7); // 11..17
    const ativos = new Set();
    while (ativos.size < Math.min(nAtivos, POOL_CLIENTES.length)) {
      ativos.add(escolhe(POOL_CLIENTES));
    }

    ativos.forEach(cliente => {
      const nOrigens = 1 + (rand() < 0.35 ? 1 : 0); // maioria cota de 1 origem, alguns de 2
      const usadas = new Set();
      for (let k = 0; k < nOrigens; k++) {
        let cidade = escolhe(TODAS_CIDADES);
        if (usadas.has(cidade)) continue;
        usadas.add(cidade);
        // se a cidade faz parte de um par de variantes, sorteia qual grafia
        // essa semana usou — e assim que a inconsistencia real acontece:
        // cada Mapa digitado por gente diferente, semana a semana
        const par = VARIANTES.find(v => v.includes(cidade));
        const origem = par ? escolhe(par) : cidade;
        const base = precoBase.get(cliente);
        const deriva = Math.round((rand() - 0.5) * 300);
        const oferta = Math.max(3600, base + deriva + Math.floor(rand() * 200));
        linhas.push({ cliente, origem, oferta, ano: 2026, semana });
      }
    });
  }
  return linhas;
}

const DADOS = gerarAmostraSintetica();

/* ====================== heuristica de grafia suspeita (so aponta, nao corrige) ====================== */

const UF = new Set([
  'ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg',
  'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to'
]);

// Normaliza pra comparar: caixa, acento, espacamento e sufixo de UF somem.
// "Pontes e Lacerda" ~ "Pontes  Lacerda": o conector isolado "e"/"&" vira
// espaco antes de colapsar os espacos duplicados.
function normalizarOrigem(txt) {
  let s = String(txt || '').trim().replace(/\s+/g, ' ');
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.toLowerCase();
  const m = /^(.*?)[\s,/-]+([a-z]{2})$/.exec(s);
  if (m && UF.has(m[2])) s = m[1].trim();
  s = s.replace(/\s+(e|&)\s+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// singular/plural: raiz sem o "s" final, pra "Bugres"~"Bugre" tambem bater
function raizSingular(s) {
  return s.length > 3 && s.endsWith('s') ? s.slice(0, -1) : s;
}

function chaveSuspeita(origem) {
  return raizSingular(normalizarOrigem(origem));
}

/* ====================== parte 1 — grafias por cliente ====================== */

function parte1(dados) {
  const porCliente = new Map();
  dados.forEach(d => {
    if (!porCliente.has(d.cliente)) porCliente.set(d.cliente, new Map());
    const porOrigem = porCliente.get(d.cliente);
    if (!porOrigem.has(d.origem)) porOrigem.set(d.origem, new Set());
    porOrigem.get(d.origem).add(d.ano + '/' + d.semana);
  });

  const clientes = [...porCliente.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return clientes.map(cliente => {
    const porOrigem = porCliente.get(cliente);
    const origens = [...porOrigem.entries()].map(([origem, semanas]) => ({ origem, semanas: semanas.size }));

    const grupos = new Map();
    origens.forEach(o => {
      const k = chaveSuspeita(o.origem);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(o.origem);
    });
    origens.forEach(o => {
      const grupo = grupos.get(chaveSuspeita(o.origem));
      o.suspeitos = grupo.length > 1 ? grupo.filter(g => g !== o.origem) : [];
    });

    origens.sort((a, b) => b.semanas - a.semanas || a.origem.localeCompare(b.origem, 'pt-BR'));
    return { cliente, origens };
  });
}

/* ====================== parte 2 — clientes por semana, entradas/saidas ====================== */

function semanasOrdenadas(dados) {
  const m = new Map();
  dados.forEach(d => m.set(d.ano + '/' + d.semana, { ano: d.ano, semana: d.semana }));
  return [...m.values()].sort((a, b) => a.ano - b.ano || a.semana - b.semana);
}

function parte2(dados) {
  const semanas = semanasOrdenadas(dados);
  const comClientes = semanas.map(s => ({
    ...s,
    clientes: new Set(dados.filter(d => d.ano === s.ano && d.semana === s.semana).map(d => d.cliente))
  }));
  const ordAlf = arr => arr.slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return comClientes.map((s, i) => {
    if (i === 0) return { ano: s.ano, semana: s.semana, total: s.clientes.size, saiu: null, entrou: null };
    const antes = comClientes[i - 1].clientes;
    const saiu = ordAlf([...antes].filter(c => !s.clientes.has(c)));
    const entrou = ordAlf([...s.clientes].filter(c => !antes.has(c)));
    return { ano: s.ano, semana: s.semana, total: s.clientes.size, saiu, entrou };
  });
}

/* ====================== parte 3 — faixa de preco por semana ====================== */

function parte3(dados) {
  return semanasOrdenadas(dados).map(s => {
    const ofertas = dados
      .filter(d => d.ano === s.ano && d.semana === s.semana)
      .map(d => Number(d.oferta))
      .filter(v => v > 0);
    return {
      ano: s.ano, semana: s.semana,
      min: ofertas.length ? Math.min(...ofertas) : null,
      max: ofertas.length ? Math.max(...ofertas) : null
    };
  });
}

/* ====================== impressao no console ====================== */

const fmtReal = v => v == null ? '—' : 'R$ ' + Math.round(v).toLocaleString('pt-BR');

function imprimir(p1, p2, p3) {
  console.log('='.repeat(72));
  console.log('PARTE 1 — grafias de origem por cliente (suspeitos de mesma origem)');
  console.log('='.repeat(72));
  p1.forEach(({ cliente, origens }) => {
    console.log('\n' + cliente);
    origens.forEach(o => {
      const susp = o.suspeitos.length ? o.suspeitos.join(', ') : '—';
      console.log('  ' + o.origem.padEnd(24) + String(o.semanas).padStart(3) + '  ' + susp);
    });
  });

  console.log('\n' + '='.repeat(72));
  console.log('PARTE 2 — clientes distintos por semana, entradas e saidas');
  console.log('='.repeat(72));
  console.log('Semana  Clientes');
  p2.forEach(s => {
    const semanaCol = String(s.semana).padEnd(8);
    const total = String(s.total);
    if (s.saiu == null) { console.log(semanaCol + total); return; }
    const indent = ' '.repeat((semanaCol + total + '  ').length);
    console.log(semanaCol + total + '  Saíram: ' + (s.saiu.length ? s.saiu.join(', ') : '-'));
    console.log(indent + 'Entraram: ' + (s.entrou.length ? s.entrou.join(', ') : '-'));
  });

  console.log('\n' + '='.repeat(72));
  console.log('PARTE 3 — faixa de preco por semana (oferta bruta, sem NET)');
  console.log('='.repeat(72));
  console.log('Semana  Mín–Máx');
  p3.forEach(s => {
    console.log(String(s.semana).padEnd(8) + fmtReal(s.min) + '–' + fmtReal(s.max));
  });
  console.log('');
}

/* ====================== geracao do diagnostico.html ====================== */

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function gerarHtml(p1, p2, p3, ehAmostra) {
  const tabelasCliente = p1.map(({ cliente, origens }) => {
    const temSuspeito = origens.some(o => o.suspeitos.length);
    const linhas = origens.map(o => '<tr>' +
      '<td>' + esc(o.origem) + '</td>' +
      '<td class="num">' + o.semanas + '</td>' +
      '<td>' + (o.suspeitos.length ? esc(o.suspeitos.join(', ')) : '<span class="mute">—</span>') + '</td>' +
      '</tr>').join('');
    return '<div class="bloco-cliente' + (temSuspeito ? ' suspeito' : '') + '">' +
      '<h3>' + esc(cliente) + (temSuspeito ? ' <span class="tag">revisar</span>' : '') + '</h3>' +
      '<table><thead><tr><th>Grafia</th><th>Semanas</th><th>Suspeitos</th></tr></thead>' +
      '<tbody>' + linhas + '</tbody></table></div>';
  }).join('');

  const linhasP2 = p2.map(s => {
    const extra = s.saiu == null ? '' :
      '<div class="mov"><span class="saiu">Saíram:</span> ' + (s.saiu.length ? esc(s.saiu.join(', ')) : '-') + '</div>' +
      '<div class="mov"><span class="entrou">Entraram:</span> ' + (s.entrou.length ? esc(s.entrou.join(', ')) : '-') + '</div>';
    return '<tr><td>' + s.semana + '/' + s.ano + '</td><td class="num">' + s.total + '</td><td>' + extra + '</td></tr>';
  }).join('');

  const linhasP3 = p3.map(s =>
    '<tr><td>' + s.semana + '/' + s.ano + '</td><td class="num">' + fmtReal(s.min) + ' – ' + fmtReal(s.max) + '</td></tr>'
  ).join('');

  const totalSuspeitos = p1.reduce((n, c) => n + c.origens.filter(o => o.suspeitos.length).length, 0);
  const totalClientesComSuspeita = p1.filter(c => c.origens.some(o => o.suspeitos.length)).length;

  return '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>Diagnóstico das origens — cotações</title>\n<style>\n' +
    ':root{--paper:#DFE0E4;--card:#FFFFFF;--ink:#23242B;--mute:#6B6D78;--line:#C4C6D0;' +
    '--azul:#1E1E7B;--pos:#0F7B40;--neg:#C31419;--posbg:#EAF6EF;--negbg:#FDEDEE;--r:3px}\n' +
    '*{box-sizing:border-box}\n' +
    'html,body{margin:0;background:var(--paper);color:var(--ink);' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}\n' +
    '.wrap{max-width:920px;margin:0 auto;padding:24px 20px 60px}\n' +
    'h1{font-size:23px;margin:0 0 4px;letter-spacing:-.2px}\n' +
    '.sub{font-size:13.5px;color:var(--mute);margin:0 0 4px}\n' +
    (ehAmostra ? '.aviso{background:#FDEDEE;border:1px solid #f3c8cb;color:var(--neg);' +
      'padding:10px 14px;border-radius:var(--r);font-size:13px;margin:14px 0}\n' : '') +
    'h2{font-size:17px;color:var(--azul);margin:34px 0 4px}\n' +
    'h3{font-size:14.5px;margin:0 0 8px}\n' +
    '.nota{font-size:12.5px;color:var(--mute);margin:0 0 14px;max-width:76ch;line-height:1.5}\n' +
    'table{width:100%;border-collapse:collapse;background:var(--card);' +
    'border:1px solid var(--line);font-size:13.5px;margin-bottom:14px}\n' +
    'th,td{padding:8px 11px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}\n' +
    'th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--mute);' +
    'font-weight:600;background:#F4F5F8}\n' +
    'tbody tr:last-child td{border-bottom:0}\n' +
    'td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}\n' +
    '.mute{color:var(--mute)}\n' +
    '.bloco-cliente{margin-bottom:22px}\n' +
    '.bloco-cliente.suspeito h3{color:var(--neg)}\n' +
    '.tag{display:inline-block;font-size:10.5px;font-weight:700;color:var(--neg);' +
    'background:var(--negbg);padding:2px 8px;border-radius:20px;text-transform:uppercase;' +
    'letter-spacing:.3px;vertical-align:middle}\n' +
    '.mov{font-size:12.5px;line-height:1.6}\n' +
    '.mov .saiu{color:var(--neg);font-weight:600}\n' +
    '.mov .entrou{color:var(--pos);font-weight:600}\n' +
    '.resumo{background:var(--card);border:1px solid var(--line);border-radius:var(--r);' +
    'padding:14px 16px;font-size:13.5px;line-height:1.6;margin:14px 0 22px}\n' +
    '.recomendacoes{background:var(--card);border:1px solid var(--line);border-radius:var(--r);' +
    'padding:16px 18px;font-size:13.5px;line-height:1.65}\n' +
    '.recomendacoes h4{font-size:13px;margin:14px 0 4px;color:var(--azul)}\n' +
    '.recomendacoes h4:first-child{margin-top:0}\n' +
    '@media(max-width:640px){.wrap{padding:16px 12px 50px} table{font-size:12.5px}}\n' +
    '</style>\n</head>\n<body>\n<div class="wrap">\n' +
    '<h1>Diagnóstico das origens — tabela cotacoes</h1>\n' +
    '<p class="sub">Gerado por diagnostico.js, ' + new Date().toLocaleString('pt-BR') + '.</p>\n' +
    (ehAmostra ? '<div class="aviso">Rodando com AMOSTRA SINTÉTICA (sem dump real do banco) — ' +
      'os números abaixo servem só pra provar que a lógica funciona, não refletem o Postgres de ' +
      'verdade. Cole o dump real de <code>cotacoes</code> em DADOS, no topo de diagnostico.js, e ' +
      'rode de novo.</div>\n' : '') +
    '<div class="resumo">' + totalClientesComSuspeita + ' de ' + p1.length +
    ' clientes têm pelo menos uma grafia de origem suspeita de ser a mesma coisa escrita ' +
    'diferente (' + totalSuspeitos + ' grafias no total, entre os ' + p1.reduce((n, c) => n + c.origens.length, 0) +
    ' pares cliente+origem distintos da série).</div>\n' +

    '<h2>Parte 1 — grafias de origem por cliente</h2>\n' +
    '<p class="nota">Uma tabela por cliente, ordenado alfabeticamente. Dentro do cliente, a ' +
    'grafia mais frequente (mais semanas) vem primeiro. "Suspeitos" lista outras grafias do ' +
    'mesmo cliente que parecem ser a mesma origem escrita diferente (caixa, acento, espaço, ' +
    'singular/plural ou UF a mais/a menos) — nada foi unificado, é só sinalização.</p>\n' +
    tabelasCliente +

    '<h2>Parte 2 — clientes distintos por semana</h2>\n' +
    '<p class="nota">Contagem de clientes com pelo menos uma cotação na semana, e quem entrou ' +
    'ou saiu em relação à semana imediatamente anterior.</p>\n' +
    '<table><thead><tr><th>Semana</th><th>Clientes</th><th>Entradas e saídas</th></tr></thead>' +
    '<tbody>' + linhasP2 + '</tbody></table>\n' +

    '<h2>Parte 3 — faixa de preço por semana</h2>\n' +
    '<p class="nota">Oferta bruta mínima e máxima entre todas as cotações da semana (sem NET — ' +
    'ver comentário em cotacoesDaSemana(), em db.js, sobre por que o NET não entra ainda).</p>\n' +
    '<table><thead><tr><th>Semana</th><th>Mín – Máx</th></tr></thead>' +
    '<tbody>' + linhasP3 + '</tbody></table>\n' +

    '<h2>Recomendações</h2>\n' +
    '<div class="recomendacoes">\n' +
    '<h4>Dá pra normalizar automaticamente</h4>\n' +
    '<p>Caixa alta/baixa, acento presente/ausente e espaçamento duplo são os três casos mais ' +
    'seguros: nunca mudam o sentido do nome, então uma função de normalização (a mesma ' +
    'chaveSuspeita() deste script) pode virar a chave de agrupamento real, sem revisão manual ' +
    'linha a linha. O sufixo de UF (" - MT" etc.) também dá pra tratar assim, contanto que a ' +
    'gente decida logo se a versão canônica GUARDA o UF ou NÃO — misturar as duas nesse mesmo ' +
    'agrupamento sem definir um padrão fixo empurra a inconsistência para outro lugar.</p>\n' +
    '<h4>Precisa de olho humano</h4>\n' +
    '<p>Singular/plural e abreviação/nome por extenso não têm uma regra genérica confiável: ' +
    '"Bugre" vs "Bugres" pode ser plural do mesmo lugar ou, num caso raro, dois lugares ' +
    'diferentes por coincidência de nome — só quem conhece a operação decide com segurança. O ' +
    'mesmo vale para abreviações não previstas aqui (ex.: "Sto." por "Santo"): sem um dicionário ' +
    'de cidades da região, tentar expandir automaticamente arrisca juntar coisas que não são a ' +
    'mesma origem. Trate a lista de "Suspeitos" da Parte 1 como um roteiro de conferência, não ' +
    'como correção pronta.</p>\n' +
    '<h4>Vale completar a UF que ficou faltando?</h4>\n' +
    '<p>Só quando o nome da cidade sozinho já for inequívoco na região de compra (ex.: só existe ' +
    'um "Juara" relevante nessa operação) — aí completar o UF é cosmético e barato de automatizar ' +
    'com uma tabela pequena de cidade→UF mantida à mão. Se dois estados diferentes puderem ter ' +
    'uma cidade com nome parecido, completar automaticamente pode inventar uma UF errada, que é ' +
    'pior do que deixar em branco. Recomendo revisar essa tabela cidade→UF junto com quem faz o ' +
    'Mapa, não deduzir sozinho.</p>\n' +
    '</div>\n' +
    '</div>\n</body>\n</html>\n';
}

const p1 = parte1(DADOS), p2 = parte2(DADOS), p3 = parte3(DADOS);
imprimir(p1, p2, p3);
const saida = path.join(__dirname, 'diagnostico.html');
fs.writeFileSync(saida, gerarHtml(p1, p2, p3, true));
console.log('gravado: ' + saida);
