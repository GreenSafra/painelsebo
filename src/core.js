/* ====================== LEITURA DE XLSX NO NAVEGADOR ====================== */
function u16(d, o) { return d[o] | (d[o + 1] << 8); }
function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

async function unzip(arrayBuffer) {
  const d = new Uint8Array(arrayBuffer);
  let eocd = -1;
  for (let i = d.length - 22; i >= 0 && i > d.length - 66000; i--) {
    if (u32(d, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('arquivo não parece ser um .xlsx');
  const nEnt = u16(d, eocd + 10);
  let p = u32(d, eocd + 16);
  const out = new Map();
  for (let k = 0; k < nEnt; k++) {
    if (u32(d, p) !== 0x02014b50) break;
    const method = u16(d, p + 10);
    const csize = u32(d, p + 20);
    const nlen = u16(d, p + 28), elen = u16(d, p + 30), clen = u16(d, p + 32);
    const lho = u32(d, p + 42);
    const name = new TextDecoder().decode(d.subarray(p + 46, p + 46 + nlen));
    const lnlen = u16(d, lho + 26), lelen = u16(d, lho + 28);
    const start = lho + 30 + lnlen + lelen;
    out.set(name, {
      method, bytes: d.subarray(start, start + csize),
      crc: u32(d, p + 16), usize: u32(d, p + 24), ordem: k
    });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

async function entryText(zip, name) {
  const e = zip.get(name);
  if (!e) return null;
  const raw = e.method === 0 ? e.bytes : await inflateRaw(e.bytes);
  return new TextDecoder().decode(raw);
}

function colToIdx(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function serialToDate(n) {
  if (!(n > 20000 && n < 80000)) return null;
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms);
}

async function readXlsx(file) {
  const zip = await unzip(await file.arrayBuffer());
  const shared = [];
  const ssTxt = await entryText(zip, 'xl/sharedStrings.xml');
  if (ssTxt) {
    const doc = new DOMParser().parseFromString(ssTxt, 'application/xml');
    for (const si of doc.getElementsByTagName('si')) {
      let s = '';
      for (const t of si.getElementsByTagName('t')) s += t.textContent;
      shared.push(s);
    }
  }
  const wbTxt = await entryText(zip, 'xl/workbook.xml');
  const relTxt = await entryText(zip, 'xl/_rels/workbook.xml.rels');
  const relDoc = new DOMParser().parseFromString(relTxt, 'application/xml');
  const rel = {};
  for (const r of relDoc.getElementsByTagName('Relationship')) {
    let t = r.getAttribute('Target');
    if (t.charAt(0) === '/') t = t.slice(1); else if (!/^xl\//.test(t)) t = 'xl/' + t;
    rel[r.getAttribute('Id')] = t;
  }
  const wbDoc = new DOMParser().parseFromString(wbTxt, 'application/xml');
  const sheets = {};
  for (const sh of wbDoc.getElementsByTagName('sheet')) {
    const nm = sh.getAttribute('name');
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const path = rel[rid];
    const txt = await entryText(zip, path);
    if (!txt) continue;
    sheets[nm] = parseSheet(txt, shared);
  }
  return sheets;
}

function parseSheet(txt, shared) {
  const doc = new DOMParser().parseFromString(txt, 'application/xml');
  const rows = [];
  for (const row of doc.getElementsByTagName('row')) {
    const ri = parseInt(row.getAttribute('r'), 10) - 1;
    const arr = rows[ri] || (rows[ri] = []);
    let auto = 0;
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r');
      const ci = ref ? colToIdx(ref) : auto++;
      auto = ci + 1;
      const t = c.getAttribute('t');
      let v = null;
      if (t === 'inlineStr') {
        v = '';
        for (const tt of c.getElementsByTagName('t')) v += tt.textContent;
      } else {
        const ve = c.getElementsByTagName('v')[0];
        if (ve) {
          const raw = ve.textContent;
          if (t === 's') v = shared[parseInt(raw, 10)];
          else if (t === 'str' || t === 'e') v = raw;
          else if (t === 'b') v = raw === '1';
          else { const n = parseFloat(raw); v = isNaN(n) ? raw : n; }
        }
      }
      arr[ci] = v;
    }
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/* ====================== ESCRITA DE XLSX ====================== */
var CRCTAB = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRCTAB[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function deflateRaw(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}

function w16(a, o, v) { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; }
function w32(a, o, v) { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; a[o + 2] = (v >>> 16) & 255; a[o + 3] = (v >>> 24) & 255; }

function rezip(nomes, mapa) {
  const enc = new TextEncoder();
  const locais = [], centrais = [];
  let off = 0;
  nomes.forEach(nome => {
    const e = mapa.get(nome);
    const nb = enc.encode(nome);
    const lh = new Uint8Array(30 + nb.length);
    w32(lh, 0, 0x04034b50); w16(lh, 4, 20); w16(lh, 6, 0);
    w16(lh, 8, e.method); w16(lh, 10, 0); w16(lh, 12, 0);
    w32(lh, 14, e.crc); w32(lh, 18, e.bytes.length); w32(lh, 22, e.usize);
    w16(lh, 26, nb.length); w16(lh, 28, 0);
    lh.set(nb, 30);
    locais.push(lh, e.bytes);
    const ch = new Uint8Array(46 + nb.length);
    w32(ch, 0, 0x02014b50); w16(ch, 4, 20); w16(ch, 6, 20); w16(ch, 8, 0);
    w16(ch, 10, e.method); w16(ch, 12, 0); w16(ch, 14, 0);
    w32(ch, 16, e.crc); w32(ch, 20, e.bytes.length); w32(ch, 24, e.usize);
    w16(ch, 28, nb.length); w16(ch, 30, 0); w16(ch, 32, 0);
    w16(ch, 34, 0); w16(ch, 36, 0); w32(ch, 38, 0); w32(ch, 42, off);
    ch.set(nb, 46);
    centrais.push(ch);
    off += lh.length + e.bytes.length;
  });
  const cdSize = centrais.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  w32(eocd, 0, 0x06054b50); w16(eocd, 4, 0); w16(eocd, 6, 0);
  w16(eocd, 8, nomes.length); w16(eocd, 10, nomes.length);
  w32(eocd, 12, cdSize); w32(eocd, 16, off);
  return new Blob(locais.concat(centrais, [eocd]), {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

async function trocarEntrada(mapa, nome, texto) {
  const bytes = new TextEncoder().encode(texto);
  mapa.set(nome, {
    method: 8, bytes: await deflateRaw(bytes), crc: crc32(bytes), usize: bytes.length
  });
}

/* ====================== NORMALIZAÇÃO E DE-PARA ====================== */
function norm(s) {
  s = String(s == null ? '' : s).trim();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/\(.*?\)/g, '').replace(/\d+[,.]?\d*\s*%/g, '');
  s = s.replace(/acidez|a 12/gi, '');
  return s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sim(a, b) {
  if (a === b) return 1;
  const bg = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b);
  let inter = 0, tot = 0;
  A.forEach((v, k) => { inter += Math.min(v, B.get(k) || 0); tot += v; });
  B.forEach(v => { tot += v; });
  return tot ? 2 * inter / tot : 0;
}

/* ====================== ADAPTADORES DE PLANILHA ====================== */
function findHeader(rows, must) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const h = rows[i].map(norm);
    if (must.every(m => h.some(x => x.indexOf(m) >= 0))) return i;
  }
  return -1;
}

function colMap(headerRow) {
  const m = {};
  headerRow.forEach((h, i) => { const n = norm(h); if (n && !(n in m)) m[n] = i; });
  return m;
}

function pick(cm, ...cands) {
  for (const c of cands) {
    if (c in cm) return cm[c];
    for (const k in cm) if (k.indexOf(c) === 0) return cm[k];
  }
  return -1;
}

function readProducao(sheets) {
  const nm = Object.keys(sheets).find(n => norm(n).indexOf('program') >= 0) || Object.keys(sheets)[0];
  const rows = sheets[nm];
  const hi = findHeader(rows, ['sigla', 'ton', 'uf']);
  if (hi < 0) throw new Error('Na Programação não achei o cabeçalho com Sigla, UF e TON.');
  const cm = colMap(rows[hi]);
  const cS = pick(cm, 'sigla'), cC = pick(cm, 'cidade'), cU = pick(cm, 'uf'), cT = pick(cm, 'ton');
  const cSem = pick(cm, 'semana'), cPer = pick(cm, 'periodo'), cEmb = pick(cm, 'data embarque');
  let colDest = null;
  try { colDest = colunasDestino(rows, hi); } catch (e) { colDest = null; }
  // Le o bloco de destino (Clientes, Cidade/UF, Toneladas) linha a linha, no
  // mesmo layout que "Exportar programação" grava. So conta como Programação
  // ja preenchida quando ACHA cliente em alguma linha — planilha sem nenhum
  // destino digitado segue exatamente como sempre foi. A tonelada do destino
  // vem da coluna propria quando existe; no layout real da empresa nao existe
  // (so ha "Toneladas" uma vez, antes de Clientes), entao cai na tonelada da
  // propria linha de producao — que ja e a fatia certa quando a planilha vem
  // do nosso proprio export, porque cada linha dividida carrega so a sua parte.
  const iCliDest = colDest && colDest.cli ? colToIdx(colDest.cli) : -1;
  const iDstDest = colDest && colDest.dst ? colToIdx(colDest.dst) : -1;
  const iTonDest = colDest && colDest.ton ? colToIdx(colDest.ton) : -1;
  const agg = new Map();
  const linhas = [];
  const destinosPorSigla = {};
  let semana = null, periodo = null, temDestino = false;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const sg = String(r[cS] == null ? '' : r[cS]).trim().toUpperCase();
    const ton = parseFloat(r[cT]);
    if (!sg || !isFinite(ton) || ton <= 0) continue;
    if (norm(sg).indexOf('total') >= 0) continue;
    if (semana == null && r[cSem] != null) semana = r[cSem];
    if (periodo == null && r[cPer] != null) periodo = String(r[cPer]);
    const k = sg;
    const cur = agg.get(k) || { sigla: sg, cidade: String(r[cC] || '').trim(), uf: String(r[cU] || '').trim().toUpperCase(), ton: 0 };
    cur.ton += ton;
    agg.set(k, cur);
    const emb = cEmb >= 0 ? parseFloat(r[cEmb]) : NaN;
    linhas.push({ r: i + 1, sigla: sg, ton: ton, emb: isFinite(emb) ? emb : null });
    if (iCliDest >= 0) {
      const cliDest = String(r[iCliDest] == null ? '' : r[iCliDest]).trim();
      if (cliDest) {
        temDestino = true;
        const dstTxt = iDstDest >= 0 ? String(r[iDstDest] || '').trim() : '';
        const tonDestRaw = iTonDest >= 0 ? parseFloat(r[iTonDest]) : NaN;
        const tonDest = isFinite(tonDestRaw) && tonDestRaw > 0 ? tonDestRaw : ton;
        const lista = destinosPorSigla[sg] || (destinosPorSigla[sg] = []);
        // mesmo destino em mais de uma linha (ex.: carga dividida em varias
        // carretas) soma na mesma entrada, nao duplica — cada sigla+cliente
        // vira uma linha so na tela, igual ao que o modelo sempre produziu.
        const existente = lista.find(x => x.cliente === cliDest);
        if (existente) { existente.ton += tonDest; if (!existente.destino && dstTxt) existente.destino = dstTxt; }
        else lista.push({ cliente: cliDest, destino: dstTxt, ton: tonDest });
      }
    }
  }
  const plants = [...agg.values()].sort((a, b) => a.uf.localeCompare(b.uf) || a.sigla.localeCompare(b.sigla));
  if (!plants.length) throw new Error('Não encontrei nenhuma linha de produção na Programação.');
  return {
    plants, semana, periodo, linhas, aba: nm, colDest: colDest,
    destinosPreenchidos: temDestino ? destinosPorSigla : null
  };
}

var PROPRIAS_CONHECIDAS = [
  { cliente: 'JBS - BioPower Mafra', cidade: 'Mafra', uf: 'SC' }
];

function detectarProprios(mapa) {
  const PAT = /biopower|flora/i;
  const vis = new Map();
  mapa.rows.forEach(r => {
    if (!PAT.test(r.cli) || vis.has(r.cli)) return;
    vis.set(r.cli, dadosDestino(r.cli, r.dst));
  });
  const lista = [...vis.values()];
  PROPRIAS_CONHECIDAS.forEach(k => {
    const chave = norm(k.cidade) + '|' + k.uf;
    if (lista.some(d => norm(d.cidade) + '|' + d.uf === chave)) return;
    lista.push({ cliente: k.cliente, cidade: k.cidade, uf: k.uf, semCotacao: true });
  });
  return lista;
}

function dadosDestino(cliente, dst) {
  const t = String(dst || '').split(',');
  const uf = (t.length > 1 ? t[t.length - 1] : '').trim().toUpperCase().slice(0, 2);
  return { cliente, cidade: t[0].trim(), uf: /^[A-Z]{2}$/.test(uf) ? uf : '' };
}

function clientesDoMapa(mapa) {
  const vis = new Map();
  mapa.rows.forEach(r => { if (!vis.has(r.cli)) vis.set(r.cli, r.dst); });
  return [...vis.entries()].map(([c, d]) => dadosDestino(c, d))
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
}

function readMapa(sheets) {
  for (const nm of Object.keys(sheets)) {
    const rows = sheets[nm];
    const hi = findHeader(rows, ['unidades', 'clientes', 'oferta']);
    if (hi < 0) continue;
    const cm = colMap(rows[hi]);
    const c = {
      data: pick(cm, 'data'), un: pick(cm, 'unidades jbs', 'unidades'), uf: pick(cm, 'uf'),
      cli: pick(cm, 'clientes', 'cliente'), dst: pick(cm, 'cidade uf', 'cidade'),
      of: pick(cm, 'oferta'), net: pick(cm, 'net'), icms: pick(cm, 'icms'),
      pis: pick(cm, 'pis'), fcli: pick(cm, 'frete cliente'),
      frete: pick(cm, 'modal cif', 'modal', 'frete cif', 'frete'),
      pgt: pick(cm, 'pgt', 'pagamento', 'prazo')
    };
    const out = [];
    let data = null, dataSerial = null;
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      const cli = String(r[c.cli] == null ? '' : r[c.cli]).trim();
      const un = String(r[c.un] == null ? '' : r[c.un]).trim();
      if (!cli || !un) continue;
      const of = parseFloat(r[c.of]), net = parseFloat(r[c.net]);
      const icms = parseFloat(r[c.icms]), pis = parseFloat(r[c.pis]);
      const fcli = parseFloat(r[c.fcli]);
      if (data == null && r[c.data] != null) {
        const d = serialToDate(r[c.data]);
        // serialToDate ancora em meia-noite UTC (so a data importa, sem
        // hora) — formatar sem forcar UTC deslocava um dia pra tras em
        // fusos negativos como o do Brasil (ex.: virava "09/09" quando a
        // planilha tinha 10/09).
        data = d ? d.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : String(r[c.data]);
        dataSerial = typeof r[c.data] === 'number' ? r[c.data] : null;
      }
      out.push({
        i: out.length, linha: i, un, uf: String(r[c.uf] || '').trim().toUpperCase(), cli,
        dst: String(r[c.dst] || '').trim(),
        of: isFinite(of) ? of : null, net: isFinite(net) ? net : null,
        icms: isFinite(icms) ? icms : 0, pis: isFinite(pis) ? pis : 0.00925,
        fcli: isFinite(fcli) ? fcli : 0,
        modal: String(r[c.frete] || '').trim(),
        pgt: c.pgt >= 0 ? String(r[c.pgt] == null ? '' : r[c.pgt]).trim() : ''
      });
    }
    if (out.length) {
      const modalCol = conferirModal(rows, hi, out, c.frete);
      return { rows: out, data: data, dataSerial: dataSerial, modalCol: modalCol };
    }
  }
  throw new Error('No Mapa de Ofertas não achei o cabeçalho com Unidades JBS, Clientes e $ Oferta.');
}

// o cabeçalho do Mapa varia; se a coluna escolhida não trouxer CIF/FOB,
// procura a coluna certa pelos valores
function ehModal(v) { return /^\s*(cif|fob)\s*$/i.test(String(v == null ? '' : v)); }

function conferirModal(rows, hi, out, ci) {
  const bons = out.filter(x => ehModal(x.modal)).length;
  if (out.length && bons >= out.length * 0.6) return { col: ci, ok: true };
  let melhor = -1, melhorN = 0, larg = 0;
  for (let i = hi + 1; i < rows.length; i++) larg = Math.max(larg, rows[i].length);
  for (let k = 0; k < larg; k++) {
    let n = 0;
    for (let i = hi + 1; i < rows.length; i++) if (ehModal(rows[i][k])) n++;
    if (n > melhorN) { melhorN = n; melhor = k; }
  }
  if (melhor < 0 || melhorN < out.length * 0.3) {
    out.forEach(x => { if (!ehModal(x.modal)) x.modal = ''; });
    return { col: -1, ok: false, cabecalho: String(rows[hi][ci] || '').trim() };
  }
  out.forEach(x => {
    const v = rows[x.linha] ? rows[x.linha][melhor] : null;
    x.modal = ehModal(v) ? String(v).trim().toUpperCase() : '';
  });
  return { col: melhor, ok: true, trocada: melhor !== ci,
    cabecalho: String(rows[hi][melhor] || '').trim() };
}

function netDe(r) {
  if (r.ofEdit != null) return r.ofEdit * (1 - r.icms) * (1 - r.pis) - r.fcli;
  return r.net;
}

/* ====================== COTACOES (serie de precos por cliente) ====================== */
// Extrai as cotacoes de um Mapa ja parseado — so a oferta BRUTA, sem
// NET: NET embute frete, que varia por origem, e contaminaria a serie
// de preco com efeito de logistica em vez de so preco pedido. O ICMS vai
// junto (nao embute frete, so o regime fiscal) — a Analise de cotacoes usa
// ele pra separar o ranking por regime, ja que oferta bruta com ICMS e
// diferido nao sao comparaveis entre si. Se prod (a Programacao) for
// passado, tenta resolver a sigla da unidade; so grava quando bate com
// exatamente uma planta — ambiguo (ex.: cidades com duas plantas) ou sem
// prod vira null, nunca um chute. A data da cotacao e a mesma pra todas as
// linhas do arquivo, tirada do dataSerial (nunca da string ja formatada,
// que teve bug de fuso).
function extrairCotacoes(mapa, prod) {
  const resolve = (prod && prod.plants && prod.plants.length) ? criarResolvedor(prod.plants) : null;
  const d = (mapa && mapa.dataSerial != null) ? serialToDate(mapa.dataSerial) : null;
  const dataCotacao = d ? d.toISOString().slice(0, 10) : null;
  const out = [];
  ((mapa && mapa.rows) || []).forEach(r => {
    if (!(r.of > 0)) return;
    let sigla = null;
    if (resolve) {
      const hit = resolve(r.un);
      if (hit.length === 1) sigla = hit[0];
    }
    out.push({ cliente: r.cli, origem: r.un, sigla, oferta: r.of, dataCotacao, icms: r.icms });
  });
  return out;
}

// Inicio (segunda) do periodo "dd/mm a dd/mm" de uma semana fechada,
// como Date UTC. null se o formato nao bater — nao adivinha.
function inicioDoPeriodo(periodo, ano) {
  const m = /^(\d{2})\/(\d{2})\s+a\s+\d{2}\/\d{2}/.exec(String(periodo || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(ano, Number(m[2]) - 1, Number(m[1])));
  return isFinite(d.getTime()) ? d : null;
}

// A cotacao sai sempre na quinta-feira anterior ao inicio da semana.
function quintaEsperada(inicioSegunda) {
  return inicioSegunda ? new Date(inicioSegunda.getTime() - 4 * 86400000) : null;
}

// Semana ISO-8601 de uma data (ano e semana calculados juntos, pra nao
// descasar nas viradas de ano). Verificado contra as semanas fechadas
// reais desta empresa: bate com as 9 semanas ja gravadas no banco.
function isoWeekInfo(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const primeiraQuinta = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fdn = (primeiraQuinta.getUTCDay() + 6) % 7;
  primeiraQuinta.setUTCDate(primeiraQuinta.getUTCDate() - fdn + 3);
  const semana = 1 + Math.round((d - primeiraQuinta) / (7 * 86400000));
  return { ano: d.getUTCFullYear(), semana };
}

// Resolve a semana de um Mapa: casa com uma semana ja fechada (por
// igualdade exata entre a data da cotacao e a quinta esperada daquela
// semana); sem correspondencia, CALCULA pela regra da quinta + semana
// ISO — uma cotacao pode ser de uma semana que ainda nao fechou, ou que
// nunca vai fechar, e isso e normal, nao pendencia. So fica pendente de
// verdade quando a data da cotacao e ilegivel (sem calculo possivel).
function resolverSemanaDoMapa(dataSerial, semanasFechadas) {
  if (dataSerial == null) return { status: 'pendente' };
  const dCot = serialToDate(dataSerial);
  if (!dCot) return { status: 'pendente' };
  const casada = (semanasFechadas || []).find(s => {
    const q = quintaEsperada(inicioDoPeriodo(s.periodo, s.ano));
    return q && q.getTime() === dCot.getTime();
  });
  if (casada) return { status: 'casada', ano: casada.ano, semana: casada.semana, periodo: casada.periodo };
  const seg = new Date(dCot.getTime() + 4 * 86400000);
  const iso = isoWeekInfo(seg);
  return { status: 'calculada', ano: iso.ano, semana: iso.semana };
}

/* ====================== MONTAGEM DO CONJUNTO ====================== */
// Casa o texto de uma unidade (coluna "Unidades JBS" do Mapa) com a
// sigla de 3 letras da Programacao — por sigla literal no texto, por
// nome de cidade exato, por abreviatura de cidade, ou por similaridade.
// Devolve um array: 0 sighs (nao achou), 1 (resolveu), ou mais de 1
// quando o texto casa com mais de uma planta na mesma cidade (ambiguo —
// quem usa decide o que fazer com mais de um resultado).
// UF por extenso nunca aparece sozinho num nome de cidade nosso (conferido
// contra CIDADES) — sigla de estado colada ao nome da unidade no Mapa
// ("Diamantino MT", "Diamantino/MT", "Diamantino - MT") e ruido de digitação,
// nao parte do nome. Sem tirar isso, "diamantino mt" nao bate com
// "diamantino" nem no match exato nem na abreviatura (que exige TODA palavra
// da consulta casar), e sobra so a similaridade por bigrama — sujeita a cair
// abaixo do corte conforme o texto.
var UFS_BR = new Set(['ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma',
  'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr',
  'sc', 'sp', 'se', 'to']);

function criarResolvedor(plants) {
  const siglas = new Set(plants.map(p => p.sigla));
  const cidadeIdx = new Map();
  plants.forEach(p => {
    const k = norm(p.cidade);
    if (!cidadeIdx.has(k)) cidadeIdx.set(k, []);
    cidadeIdx.get(k).push(p.sigla);
  });
  const cidades = [...cidadeIdx.keys()];

  return function resolve(nome) {
    const toks = String(nome).match(/\b[A-Z]{3}\b/g) || [];
    const hit = toks.filter(t => siglas.has(t));
    if (hit.length) return hit;
    let n = norm(nome).replace(/\bcpg\b|\bcgr\b/g, 'campo grande').trim();
    n = n.split(' ').filter(w => !UFS_BR.has(w)).join(' ');
    if (cidadeIdx.has(n)) return cidadeIdx.get(n);
    // abreviaturas: "sao m guapore" casa com "sao miguel do guapore"
    const stop = { de: 1, do: 1, da: 1, dos: 1, das: 1, d: 1 };
    const tk = s => s.split(' ').filter(w => w && !stop[w]);
    const qt = tk(n);
    let cand = [];
    if (qt.length) {
      for (const c of cidades) {
        const ct = tk(c);
        const usado = new Array(ct.length).fill(false);
        let ok = 0;
        for (const w of qt) {
          for (let i = 0; i < ct.length; i++) {
            if (usado[i]) continue;
            if (ct[i].indexOf(w) === 0 || w.indexOf(ct[i]) === 0) { usado[i] = true; ok++; break; }
          }
        }
        if (ok === qt.length) cand.push(c);
      }
      if (cand.length === 1) return cidadeIdx.get(cand[0]);
    }
    let best = null, bs = 0;
    for (const c of cidades) { const s = sim(n, c); if (s > bs) { bs = s; best = c; } }
    return bs >= 0.72 ? cidadeIdx.get(best) : [];
  };
}

function montar(prod, nec, mapa) {
  const plants = prod.plants;
  const resolve = criarResolvedor(plants);
  const ufDe = {}; plants.forEach(p => ufDe[p.sigla] = p.uf);
  const naoMapeadas = new Set();
  const q = new Map();           // sigla|cliente -> melhor linha
  mapa.rows.forEach(r => {
    const n = netDe(r);
    if (!(r.of > 0) || !(n > 0)) return;
    const sg = resolve(r.un);
    if (!sg.length) { naoMapeadas.add(r.un); return; }
    sg.forEach(s => {
      const k = s + '|' + r.cli;
      const prev = q.get(k);
      if (!prev || n > prev.net) q.set(k, { sigla: s, uf: ufDe[s], cli: r.cli, dst: r.dst, net: n, modal: r.modal, src: r.i });
    });
  });
  // Ordem fixa (sigla, NET decrescente, cliente em ordem alfabetica) — sem
  // isto, o desempate de NET igual (em resolver() e bestTer, abaixo)
  // dependia da ordem das linhas no Mapa, que muda de upload pra upload sem
  // relacao nenhuma com o merito da oferta. Com a ordem fixa, duas ofertas
  // empatadas sempre resolvem pro mesmo lado (o cliente cujo nome vem
  // primeiro no alfabeto), documentado em CLAUDE.md.
  const quotes = [...q.values()]
    .sort((a, b) => a.sigla.localeCompare(b.sigla) || b.net - a.net || a.cli.localeCompare(b.cli));
  const proprios = new Map(nec.map(d => [d.cliente, d]));
  quotes.forEach(x => x.prop = proprios.has(x.cli));
  return { plants, quotes, proprios, naoMapeadas: [...naoMapeadas], ufDe };
}

/* ====================== FLUXO DE CUSTO MÍNIMO ====================== */
function mcmf(nNodes, edges, s, t) {
  const G = Array.from({ length: nNodes }, () => []);
  const E = [];
  const map = [];
  edges.forEach(([u, v, cap, cost]) => {
    map.push(E.length);
    G[u].push(E.length); E.push({ v, cap, cost, f: 0, rev: E.length + 1 });
    G[v].push(E.length); E.push({ v: u, cap: 0, cost: -cost, f: 0, rev: E.length - 1 });
  });
  let flow = 0, cost = 0;
  for (; ;) {
    const dist = new Array(nNodes).fill(Infinity);
    const inq = new Array(nNodes).fill(false);
    const pe = new Array(nNodes).fill(-1);
    dist[s] = 0;
    const qq = [s]; inq[s] = true;
    let guard = 0;
    while (qq.length) {
      if (++guard > 500000) break;
      const u = qq.shift(); inq[u] = false;
      for (const ei of G[u]) {
        const e = E[ei];
        if (e.cap - e.f > 1e-9 && dist[u] + e.cost < dist[e.v] - 1e-9) {
          dist[e.v] = dist[u] + e.cost; pe[e.v] = ei;
          if (!inq[e.v]) { inq[e.v] = true; qq.push(e.v); }
        }
      }
    }
    if (dist[t] === Infinity) break;
    let push = Infinity;
    for (let v = t; v !== s; v = E[E[pe[v]].rev].v) {
      const e = E[pe[v]]; push = Math.min(push, e.cap - e.f);
    }
    if (!(push > 1e-9)) break;
    for (let v = t; v !== s; v = E[E[pe[v]].rev].v) {
      const e = E[pe[v]]; e.f += push; E[e.rev].f -= push;
    }
    flow += push; cost += push * dist[t];
  }
  return { flow, cost, E, map };
}

// Trava fiscal por fabrica propria: tv e null/undefined (sem trava), uma UF
// pura ("Dentro de UF" — so aceita origem da mesma UF dela) ou "!"+UF
// ("Fora de UF" — so aceita origem de UF diferente). As duas valem nos dois
// modos de distribuicao (mercado/prioridade), igual a trava sempre valeu.
function travaBloqueia(tv, uf) {
  if (!tv) return false;
  if (tv.charAt(0) === '!') return uf === tv.slice(1);
  return uf !== tv;
}

function resolver(ds, travas, fixos, modo) {
  const { plants, quotes, proprios } = ds;
  fixos = fixos || {};
  // modo 'mercado' = proprias disputam igual a terceiro, sem prioridade.
  const LIVRE = modo === 'mercado';
  const qIdx = new Map();
  quotes.forEach(q => qIdx.set(q.sigla + '|' + q.cli, q));

  const oferta = {}; plants.forEach(p => oferta[p.sigla] = p.ton);
  // No modo livre a necessidade some: a propria concorre sem teto,
  // limitada so pelo total produzido.
  const TUDO = plants.reduce((a, b) => a + b.ton, 0);
  const pedido = {}; proprios.forEach((d, c) => pedido[c] = LIVRE ? TUDO : d.ton);

  // escolhas travadas pelo usuário saem da conta antes de otimizar o resto
  const fixado = [];
  const foraDeCotacao = [];
  Object.keys(fixos).forEach(sg => {
    (fixos[sg] || []).forEach(m => {
      if (!(m.ton > 0.001)) return;
      const q = qIdx.get(sg + '|' + m.cli);
      if (!q) { foraDeCotacao.push(sg + ' → ' + m.cli); return; }
      const t = Math.min(m.ton, oferta[sg] || 0);
      if (!(t > 0.001)) return;
      oferta[sg] -= t;
      if (q.prop) pedido[q.cli] = Math.max(0, (pedido[q.cli] || 0) - t);
      fixado.push(Object.assign({}, q, { ton: t, fixo: true }));
    });
  });

  const psobra = plants.filter(p => oferta[p.sigla] > 0.001);
  const dests = [];
  proprios.forEach((d, c) => { if (LIVRE || pedido[c] > 0.001) dests.push(d); });
  const P = psobra.length, D = dests.length;
  const idxP = new Map(psobra.map((p, i) => [p.sigla, i]));
  const idxD = new Map(dests.map((d, i) => [d.cliente, i]));
  const S = 0, T = 1, base = 2, baseD = 2 + P;
  const M = LIVRE ? 0 : 1e6;
  const CAP = plants.reduce((a, b) => a + b.ton, 0) + 1;

  const bestTer = new Map();
  quotes.forEach(x => {
    if (x.prop) return;
    const b = bestTer.get(x.sigla);
    if (!b || x.net > b.net) bestTer.set(x.sigla, x);
  });

  const edges = [];
  psobra.forEach((p, i) => edges.push([S, base + i, oferta[p.sigla], 0]));
  const arcos = [];
  quotes.forEach(x => {
    if (!x.prop) return;
    if (travaBloqueia(travas[x.cli], x.uf)) return;
    const i = idxP.get(x.sigla), j = idxD.get(x.cli);
    if (i == null || j == null) return;
    arcos.push({ ei: edges.length, x: x });
    edges.push([base + i, baseD + j, CAP, -(x.net + M)]);
  });
  const arcosTer = [];
  bestTer.forEach((x, sg) => {
    const i = idxP.get(sg);
    if (i == null) return;
    arcosTer.push({ ei: edges.length, x: x });
    edges.push([base + i, T, CAP, -x.net]);
  });
  dests.forEach((d, j) => edges.push([baseD + j, T, pedido[d.cliente], 0]));

  const semTerceiro = plants.filter(p => !bestTer.has(p.sigla)).map(p => p.sigla);
  const res = P ? mcmf(2 + P + D, edges, S, T) : { E: [], map: [] };

  const aloc = fixado.slice();
  arcos.forEach(a => { const f = res.E[res.map[a.ei]].f; if (f > 0.01) aloc.push(Object.assign({}, a.x, { ton: f })); });
  arcosTer.forEach(a => { const f = res.E[res.map[a.ei]].f; if (f > 0.01) aloc.push(Object.assign({}, a.x, { ton: f })); });

  const atendido = {};
  proprios.forEach((d, c) => atendido[c] = 0);
  aloc.forEach(a => { if (a.prop) atendido[a.cli] += a.ton; });
  const faltas = [];
  proprios.forEach((d, c) => {
    if (!LIVRE && d.ton > 0.01 && atendido[c] < d.ton - 0.01)
      faltas.push({ cliente: c, pedido: d.ton, atendido: atendido[c] });
  });

  const sobra = plants.filter(p => {
    const usado = aloc.filter(a => a.sigla === p.sigla).reduce((s, a) => s + a.ton, 0);
    return usado < p.ton - 0.01;
  }).map(p => p.sigla);

  aloc.sort((a, b) => a.uf.localeCompare(b.uf) || a.sigla.localeCompare(b.sigla) || b.net - a.net);
  const net = aloc.reduce((s, a) => s + a.ton * a.net, 0);
  return { aloc: aloc, faltas: faltas, semTerceiro: semTerceiro, sobra: sobra,
    foraDeCotacao: foraDeCotacao, net: net, bestTer: bestTer };
}

/* ====================== PROGRAMAÇÃO JÁ PREENCHIDA ====================== */
// Quando a Programação chega com os destinos preenchidos, a alocacao "realizada"
// e exatamente a da planilha — nao roda o modelo por cima. Cada destino vira
// uma linha, ligado a melhor cotacao do Mapa pra sigla+cliente quando existe
// (mesma fonte que resolver() usa pros fixos). manual (ST.manual) tem
// prioridade sobre a planilha por unidade: e assim que a edicao na tela
// depois de importar funciona — trocar uma unidade troca so ela, o resto
// continua vindo da planilha.
function alocarPreenchida(prod, ds, manual) {
  const { plants, quotes } = ds;
  const qIdx = new Map();
  quotes.forEach(q => qIdx.set(q.sigla + '|' + q.cli, q));
  const ehPropria = c => /biopower|flora/i.test(String(c || ''));
  const ufDe = {}; plants.forEach(p => ufDe[p.sigla] = p.uf);

  const porSigla = {};
  const origem = prod.destinosPreenchidos || {};
  Object.keys(origem).forEach(sg => { porSigla[sg] = origem[sg].map(d => Object.assign({}, d)); });
  Object.keys(manual || {}).forEach(sg => {
    porSigla[sg] = (manual[sg] || [])
      .filter(m => m.ton > 0.001)
      .map(m => ({ cliente: m.cli, destino: null, ton: m.ton }));
  });

  // linhas cujo sigla nao tem nenhum destino (nem planilha, nem edicao
  // manual) precisam existir mesmo vazias, pra "sobra" pegar a unidade
  // inteira e ela aparecer como "sem destino" pro usuario completar.
  plants.forEach(p => { if (!(p.sigla in porSigla)) porSigla[p.sigla] = []; });

  const aloc = [], semOferta = [];
  Object.keys(porSigla).forEach(sg => {
    porSigla[sg].forEach(d => {
      if (!(d.ton > 0.001)) return;
      const q = qIdx.get(sg + '|' + d.cliente);
      if (q) {
        aloc.push(Object.assign({}, q, { ton: d.ton, dst: d.destino || q.dst }));
      } else {
        semOferta.push({ sigla: sg, cliente: d.cliente });
        aloc.push({
          sigla: sg, uf: ufDe[sg] || '', cli: d.cliente, dst: d.destino || '',
          net: null, modal: null, src: null, ton: d.ton, prop: ehPropria(d.cliente)
        });
      }
    });
  });

  const bestTer = new Map();
  quotes.forEach(x => {
    if (x.prop) return;
    const b = bestTer.get(x.sigla);
    if (!b || x.net > b.net) bestTer.set(x.sigla, x);
  });
  const semTerceiro = plants.filter(p => !bestTer.has(p.sigla)).map(p => p.sigla);

  const usadoPorSigla = {};
  aloc.forEach(a => { usadoPorSigla[a.sigla] = (usadoPorSigla[a.sigla] || 0) + a.ton; });

  const sobra = plants.filter(p => (usadoPorSigla[p.sigla] || 0) < p.ton - 0.01).map(p => p.sigla);

  // diferenca > sobra: sobra so pega falta (planilha aloca de menos); aqui
  // pega os dois lados, inclusive quando a planilha aloca a MAIS do que a
  // unidade produz — a trava normal do modelo (capacidade no fluxo) nao
  // existe aqui porque a planilha manda, entao isso precisa de aviso proprio.
  const diferencas = plants
    .map(p => ({ sigla: p.sigla, producao: p.ton, alocado: usadoPorSigla[p.sigla] || 0,
      diferenca: (usadoPorSigla[p.sigla] || 0) - p.ton }))
    .filter(d => Math.abs(d.diferenca) > 0.05);

  aloc.sort((a, b) => a.uf.localeCompare(b.uf) || a.sigla.localeCompare(b.sigla) || (b.net || 0) - (a.net || 0));
  const net = aloc.reduce((s, a) => s + a.ton * (a.net || 0), 0);
  return { aloc: aloc, faltas: [], semTerceiro: semTerceiro, sobra: sobra,
    foraDeCotacao: [], semOferta: semOferta, diferencas: diferencas, net: net, bestTer: bestTer };
}

/* ====================== DEVOLVER A PROGRAMAÇÃO PREENCHIDA ====================== */
function repartir(prod, aloc) {
  const porSigla = {};
  aloc.forEach(a => (porSigla[a.sigla] || (porSigla[a.sigla] = [])).push(a));
  for (const s in porSigla) {
    porSigla[s].sort((a, b) => (b.prop ? 1 : 0) - (a.prop ? 1 : 0) || b.net - a.net);
  }
  const saldo = {};
  for (const s in porSigla) saldo[s] = porSigla[s].map(a => ({ a: a, resta: a.ton }));
  const porLinha = {};
  prod.linhas.forEach(l => {
    const lista = porLinha[l.r] || (porLinha[l.r] = []);
    let resta = l.ton;
    const ds = saldo[l.sigla] || [];
    let guarda = 0;
    while (resta > 0.01 && guarda++ < 50) {
      const d = ds.find(x => x.resta > 0.01);
      if (!d) break;
      const q = Math.round(Math.min(resta, d.resta) * 1000) / 1000;
      lista.push({ ton: q, dest: d.a });
      resta -= q; d.resta -= q;
    }
    if (resta > 0.01) lista.push({ ton: resta, dest: null });
  });
  return porLinha;
}

// Ano da semana, direto da Programacao — nao depende de alocacao nenhuma
// (nem de repartir/aloc), entao Salvar funciona a qualquer momento depois
// do import, mesmo antes de rodar ou com RES.alocFinal vazio.
function anoDaSemana(prod) {
  const l = (prod.linhas || []).find(x => x.emb != null);
  const d = l ? serialToDate(l.emb) : null;
  return d ? d.getFullYear() : new Date().getFullYear();
}

// Fabrica propria: mesmo criterio em todo lugar que precisa distinguir
// propria de terceiro (montarSemana, agregarSemana, comparacaoTerceiros).
// Um so lugar evita a lista divergir entre as tres contas.
function ehPropriaFabrica(c) { return /biopower|flora/i.test(String(c || '')); }

// Estatisticas de terceiro para UMA carga: media simples do NET entre os
// clientes terceiros (nunca fabrica propria) que ofertaram para a MESMA
// sigla de origem da carga — um valor por cliente (o de maior NET, quando
// ele tem mais de uma oferta pra essa sigla no Mapa). "quotesDaSigla" tem
// que vir SEM o corte top-N de opcoes(): aquele corte e para nao afogar a
// tela de edicao de opcoes, aqui a conta e estatistica e quer o universo
// inteiro. Sem nenhuma oferta elegivel (so a propria carga, ou ninguem),
// tudo sai null/0 — a carga fica fora da comparacao, mesma regra de sempre.
function comparacaoTerceiros(quotesDaSigla, clienteProprio, ehPropria) {
  const porCliente = new Map();
  let melhor = null;
  (quotesDaSigla || []).forEach(o => {
    if (o.cli === clienteProprio || ehPropria(o.cli)) return;
    const atual = porCliente.get(o.cli);
    if (atual == null || o.net > atual) porCliente.set(o.cli, o.net);
    if (!melhor || o.net > melhor.net) melhor = o;
  });
  const nets = [...porCliente.values()];
  if (!nets.length) {
    return { netTer: null, clienteTer: null, netTerMed: null, nTer: 0, netTerMin: null, netTerMax: null };
  }
  const soma = nets.reduce((s, n) => s + n, 0);
  return {
    netTer: melhor.net, clienteTer: melhor.cli,
    netTerMed: soma / nets.length, nTer: nets.length,
    netTerMin: Math.min.apply(null, nets), netTerMax: Math.max.apply(null, nets)
  };
}

// Monta o pacote que vai para o banco quando a semana e fechada.
// Desce ao nivel da linha de embarque porque o consolidado apura o mes pela
// data de cada carga — uma semana pode atravessar a virada do mes, e apurar
// pela semana inteira jogaria volume no mes errado.
// Vai o realizado e tambem o otimo do modelo: sem os dois, nao da para saber
// se um resultado ruim veio da decisao ou das trocas feitas na mao.
// "ds" e o conjunto (montar()) usado para rodar a alocacao — de la sai o
// universo COMPLETO de ofertas por sigla (ds.quotes), sem o corte top-N de
// opcoes(), pra media de terceiros. Sem "ds" (chamada antiga, defensivo),
// a media sai nula em toda carga — nunca quebra.
function montarSemana(prod, aloc, alocOtimo, ops, mapa, ds) {
  const ondeUn = {};
  prod.plants.forEach(p => ondeUn[p.sigla] = p);
  const rows = (mapa && mapa.rows) || [];
  const ehPropria = ehPropriaFabrica;
  const porSiglaCompleta = {};
  ((ds && ds.quotes) || []).forEach(x =>
    (porSiglaCompleta[x.sigla] || (porSiglaCompleta[x.sigla] = [])).push(x));
  let ano = null;

  function montar(qual) {
    const porLinha = repartir(prod, qual);
    const out = [];
    prod.linhas.forEach(l => {
      const partes = porLinha[l.r] || [];
      const d = (l.emb != null) ? serialToDate(l.emb) : null;
      const iso = d ? d.toISOString().slice(0, 10) : null;
      if (iso && !ano) ano = Number(iso.slice(0, 4));
      const un = ondeUn[l.sigla] || {};
      partes.forEach(p => {
        if (!(p.ton > 0.01) || !p.dest) return;
        const src = rows[p.dest.src] || {};
        const lista = (ops && ops[p.dest.sigla]) || [];
        // melhor alternativa qualquer (pode ser outra propria) — usa o
        // ranking ja cortado de opcoes(), sem relacao com a media abaixo
        let alt = null;
        lista.forEach(o => {
          if (o.cli === p.dest.cli) return;
          if (!alt || o.net > alt.net) alt = o;
        });
        // media (e melhor, so informativo) entre TERCEIROS de verdade para
        // esta mesma sigla — "quanto o mercado pagaria por esta mesma carga"
        const comp = comparacaoTerceiros(porSiglaCompleta[p.dest.sigla], p.dest.cli, ehPropria);
        out.push({
          dataEmbarque: iso,
          sigla: l.sigla,
          origemCidade: un.cidade || null,
          origemUf: un.uf || null,
          produto: null,
          cliente: p.dest.cli,
          proprio: !!p.dest.prop,
          destino: p.dest.dst || null,
          destinoUf: (String(p.dest.dst || '').match(/([A-Z]{2})\s*$/) || [])[1] || null,
          toneladas: Math.round(p.ton * 1000) / 1000,
          oferta: src.ofEdit != null ? src.ofEdit : (src.of != null ? src.of : null),
          net: p.dest.net,
          net2: alt ? alt.net : null,
          cliente2: alt ? alt.cli : null,
          netTer: comp.netTer,
          clienteTer: comp.clienteTer,
          netTerMed: comp.netTerMed,
          nTer: comp.nTer,
          netTerMin: comp.netTerMin,
          netTerMax: comp.netTerMax,
          icms: src.icms != null ? src.icms : null,
          modal: p.dest.modal || src.modal || null
        });
      });
    });
    return out;
  }

  const linhas = montar(aloc);
  const linhasOtimo = (alocOtimo && alocOtimo.length) ? montar(alocOtimo) : [];

  return {
    cabecalho: {
      ano: ano || new Date().getFullYear(),
      semana: Number(prod.semana),
      periodo: prod.periodo || null,
      mapaData: (mapa && mapa.data) || null
    },
    linhas: linhas,
    linhasOtimo: linhasOtimo,
    cotacoes: extrairCotacoes(mapa, prod)
  };
}

// Recalcula netTerMed/nTer das cargas de uma semana JA FECHADA, a partir do
// pacote completo que foi guardado no fechamento (dados.prod + dados.mapa —
// ver montarPacoteDados() em ui.js). Usada pela migracao em db.js para
// semanas fechadas antes de net_ter_med existir. "linhas" e o minimo que
// uma linha de alocacoes precisa: {id, sigla, cliente}. Pura — sem banco,
// sem rede — devolve so o que mudou, pra quem chama fazer o UPDATE.
// Sem prod/mapa no pacote (semana fechada antes da coluna "dados" existir),
// devolve lista vazia: nao ha como recalcular, e essa semana fica marcada
// como "sem pacote" em outro lugar (db.js/consolidado.html), nao aqui.
function recalcularTerceirosSemana(dadosPacote, linhas) {
  const prod = dadosPacote && dadosPacote.prod;
  const mapa = dadosPacote && dadosPacote.mapa;
  if (!prod || !mapa || !Array.isArray(mapa.rows) || !Array.isArray(prod.plants)) return [];
  const ds = montar(prod, [], mapa);
  const porSigla = {};
  ds.quotes.forEach(x => (porSigla[x.sigla] || (porSigla[x.sigla] = [])).push(x));
  return (linhas || []).map(l => {
    const comp = comparacaoTerceiros(porSigla[l.sigla], l.cliente, ehPropriaFabrica);
    return { id: l.id, netTerMed: comp.netTerMed, nTer: comp.nTer };
  });
}

// Motivo pelo qual uma fabrica propria ficou com ZERO no cenario "otimo" —
// so faz sentido chamar quando ela realmente recebeu zero nesse cenario.
// modo 'prioridade': a propria nunca disputa NET pela propria necessidade
// (resolver() trava o arco dela no volume digitado, sem concorrer por
// preco — ver "dests.push(d)" so quando pedido[c]>0), entao zero so pode
// ser falta de necessidade digitada ou, se digitou, falta de oferta
// daquela origem pra atender.
// modo 'mercado': a propria disputa NET igual a um terceiro, entao o
// motivo vem de quem realmente levou cada origem que ela cotou — preco
// maior (terceiro ou outra propria) ou empate perdido no desempate (NET
// igual resolve por ordem alfabetica do cliente, ver montar() acima e
// CLAUDE.md). "quotes" e ds.quotes (ou reconstruido do pacote guardado,
// pra semana ja fechada); "alocOtimo" e a alocacao real do cenario otimo,
// normalizada como {sigla, cli, net, ton, prop} por item (RES.otimoAloc ao
// vivo, ou as linhas de alocacoes cenario='otimo' de uma semana fechada).
// "trava" e ST.travas[cliente] (null, UF, ou "!"+UF — ver travaBloqueia())
// — quando ela tem cotacao mas a trava exclui TODAS as origens que cotou,
// o motivo e a trava, nao um NET perdido (ela nunca chegou a disputar).
function motivoModeloZero(cliente, modo, necDigitada, quotes, alocOtimo, trava) {
  const todas = (quotes || []).filter(q => q.cli === cliente);
  if (trava && todas.length && todas.every(q => travaBloqueia(trava, q.uf))) {
    return { tipo: 'travaFiscal', dentro: trava.charAt(0) !== '!' };
  }
  if (modo !== 'mercado') {
    if (!(Number(necDigitada) > 0)) return { tipo: 'semNecessidade' };
    return { tipo: 'semOferta' };
  }
  const minhas = todas.filter(q => !trava || !travaBloqueia(trava, q.uf));
  if (!minhas.length) return { tipo: 'semCotacao' };

  const porSigla = {};
  (alocOtimo || []).forEach(a => {
    if (!(a.ton > 0.001) || a.cli === cliente) return;
    (porSigla[a.sigla] || (porSigla[a.sigla] = [])).push(a);
  });

  // empate tem prioridade sobre "batido por NET maior": e o motivo mais
  // especifico (e o que estava sendo mostrado errado como "terceiro
  // pagando mais"), entao procura ele primeiro, em todas as origens dela,
  // em ordem alfabetica de sigla pra ser deterministico.
  const ordenadas = minhas.slice().sort((a, b) => a.sigla.localeCompare(b.sigla));
  for (const q of ordenadas) {
    const empatou = (porSigla[q.sigla] || []).find(v => Math.abs(v.net - q.net) < 0.005);
    if (empatou) return { tipo: 'empate', quem: empatou.cli };
  }
  let melhorBatido = null;
  ordenadas.forEach(q => {
    (porSigla[q.sigla] || []).forEach(v => {
      if (v.net > q.net + 0.005 && (!melhorBatido || v.net > melhorBatido.net)) {
        melhorBatido = { quem: v.cli, prop: !!v.prop, net: v.net };
      }
    });
  });
  if (melhorBatido) return { tipo: melhorBatido.prop ? 'propria' : 'terceiro', quem: melhorBatido.quem };
  // teve cotacao, ninguem pagou mais nem empatou — a origem simplesmente
  // sobrou (producao maior que a demanda de qualquer destino).
  return { tipo: 'semDemanda' };
}

// Texto pronto pra tela a partir do motivo acima — fica junto da logica que
// decide o motivo pra nao existir uma segunda fonte de verdade do texto (o
// Consolidado usa isto no servidor, ver db.js; a tela ao vivo usa direto).
function textoMotivoZero(motivo) {
  if (!motivo) return null;
  switch (motivo.tipo) {
    case 'semNecessidade': return 'porque não foi digitada necessidade para esta fábrica.';
    case 'semOferta': return 'porque não havia oferta disponível para essas origens.';
    case 'semCotacao': return 'porque não havia cotação desta fábrica no Mapa.';
    case 'terceiro': return 'porque havia terceiro pagando mais por essas cargas.';
    case 'propria': return 'porque a oferta de ' + motivo.quem + ' tinha NET maior nessas origens.';
    case 'empate': return 'porque o NET era igual ao de ' + motivo.quem + ', que ficou com as cargas.';
    case 'semDemanda': return 'porque não havia destino disputando essa origem.';
    case 'travaFiscal': return 'porque a trava ' + (motivo.dentro ? 'Dentro de UF' : 'Fora de UF') +
      ' excluiu as origens que ela cotou.';
    default: return null;
  }
}

// Agrega as linhas de montarSemana() por fabrica propria, no realizado e no
// otimo, com a mesma conta (peso por tonelada) que db.js usa em
// consolidado() -> CTE "dados". Pura: sem rede, sem banco — tem que
// funcionar so com o que ja esta em memoria, antes de fechar a semana.
// PROPRIAS e a uniao dos clientes do Mapa e dos clientes que aparecem nas
// linhas, filtrados pelo regex canonico de propria — nao uma lista
// cravada (evita uma 3a definicao de "propria" divergente, tipo BioPower
// Mafra ausente de uma lista fixa) e nao um casamento de nomes entre Mapa
// e alocacao (nome abreviado no Mapa nao pode virar zero calado).
// net_ter_realizado/net_ter_otimo continuam com esse nome (media ponderada
// por tonelada), mas agora sao a MEDIA de terceiros (netTerMed), nao mais o
// melhor terceiro — e essa media que define saving/Diferenca. O melhor
// terceiro (netTer, historico) vira so informativo em
// net_ter_melhor_realizado/otimo, fora da conta. n_ter_realizado/otimo e a
// quantidade media de ofertas usada no calculo (ponderada por tonelada,
// igual as demais medias), pro "media de N ofertas" da tela.
// ton_comp_realizado/otimo e quanto do volume TEVE comparacao — o resto
// (ton_realizado - ton_comp_realizado) e "sem comparacao", mostrado a parte.
function agregarSemana(linhas, linhasOtimo, mapaRows) {
  const ehPropria = ehPropriaFabrica;
  const doMapa = (mapaRows || []).map(r => r.cli);
  const daAlocacao = [].concat(linhas || [], linhasOtimo || []).map(l => l.cliente);
  const PROPRIAS = Array.from(new Set(doMapa.concat(daAlocacao).filter(ehPropria))).sort();

  function porCliente(lista) {
    const g = {};
    (lista || []).forEach(l => {
      if (!l.proprio) return;
      const d = g[l.cliente] || (g[l.cliente] = {
        ton: 0, somaNet: 0, tonComp: 0, somaTerMed: 0, somaTerMelhor: 0, somaNTer: 0, saving: 0,
        siglasSemComp: new Set()
      });
      d.ton += l.toneladas;
      d.somaNet += l.net * l.toneladas;
      if (l.netTerMed != null) {
        d.tonComp += l.toneladas;
        d.somaTerMed += l.netTerMed * l.toneladas;
        d.somaTerMelhor += l.netTer * l.toneladas;
        d.somaNTer += (l.nTer || 0) * l.toneladas;
        d.saving += (l.net - l.netTerMed) * l.toneladas;
      } else if (l.sigla) {
        // a tonelada entra no volume e no NET medio da propria (ja somados
        // acima), mas fica fora da Diferenca (tonComp/saving nao contam ela)
        // — aqui so guarda QUAL origem faltou terceiro, pra tela apontar.
        d.siglasSemComp.add(l.sigla);
      }
    });
    return g;
  }
  const somaTonTotal = lista => (lista || []).reduce((s, l) => s + l.toneladas, 0);
  const netPonderado = lista => {
    let ton = 0, soma = 0;
    (lista || []).forEach(l => { ton += l.toneladas; soma += l.net * l.toneladas; });
    return ton > 0 ? soma / ton : null;
  };

  const r = porCliente(linhas), o = porCliente(linhasOtimo);
  const porPropria = PROPRIAS.map(cliente => {
    const dr = r[cliente], do_ = o[cliente];
    return {
      cliente,
      ton_realizado: dr ? dr.ton : 0,
      net_realizado: dr && dr.ton > 0 ? dr.somaNet / dr.ton : null,
      net_ter_realizado: dr && dr.tonComp > 0 ? dr.somaTerMed / dr.tonComp : null,
      net_ter_melhor_realizado: dr && dr.tonComp > 0 ? dr.somaTerMelhor / dr.tonComp : null,
      n_ter_realizado: dr && dr.tonComp > 0 ? dr.somaNTer / dr.tonComp : null,
      ton_comp_realizado: dr ? dr.tonComp : 0,
      saving_realizado: dr && dr.tonComp > 0 ? dr.saving : null,
      origens_sem_comp_realizado: dr ? [...dr.siglasSemComp].sort() : [],
      ton_otimo: do_ ? do_.ton : 0,
      net_otimo: do_ && do_.ton > 0 ? do_.somaNet / do_.ton : null,
      net_ter_otimo: do_ && do_.tonComp > 0 ? do_.somaTerMed / do_.tonComp : null,
      net_ter_melhor_otimo: do_ && do_.tonComp > 0 ? do_.somaTerMelhor / do_.tonComp : null,
      n_ter_otimo: do_ && do_.tonComp > 0 ? do_.somaNTer / do_.tonComp : null,
      ton_comp_otimo: do_ ? do_.tonComp : 0,
      saving_otimo: do_ && do_.tonComp > 0 ? do_.saving : null,
      origens_sem_comp_otimo: do_ ? [...do_.siglasSemComp].sort() : []
    };
  });

  return {
    total: { toneladas: somaTonTotal(linhas), net_medio: netPonderado(linhas) },
    porPropria
  };
}

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function celula(row, col, r, spec, estilo) {
  const cs = row.getElementsByTagName('c');
  let alvo = null;
  for (let i = 0; i < cs.length; i++) {
    const ref = cs[i].getAttribute('r') || '';
    if (ref.replace(/\d+$/, '') === col) { alvo = cs[i]; break; }
  }
  if (!alvo) return;
  alvo.setAttribute('r', col + r);
  if (estilo != null) alvo.setAttribute('s', String(estilo));
  if (!spec) return;
  while (alvo.firstChild) alvo.removeChild(alvo.firstChild);
  alvo.removeAttribute('t');
  if (spec.limpar) return;
  const doc = row.ownerDocument;
  const NS = row.namespaceURI;
  const cria = n => NS ? doc.createElementNS(NS, n) : doc.createElement(n);
  if (spec.f != null) {
    const f = cria('f'); f.textContent = spec.f; alvo.appendChild(f);
  }
  if (spec.txt != null) {
    if (spec.si != null) {
      alvo.setAttribute('t', 's');
      const v = cria('v'); v.textContent = String(spec.si); alvo.appendChild(v);
    } else {
      alvo.setAttribute('t', 'inlineStr');
      const is = cria('is'), t = cria('t');
      t.textContent = spec.txt; is.appendChild(t); alvo.appendChild(is);
    }
  } else if (spec.v != null) {
    const v = cria('v');
    v.textContent = (typeof spec.v === 'number' && isFinite(spec.v)
      ? Number(spec.v.toPrecision(12)) : spec.v).toString();
    alvo.appendChild(v);
  }
}

function letra(i) {
  let s = '';
  i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; }
  return s;
}

function colunasDestino(rows, hi) {
  const h = rows[hi].map(norm);
  const iCli = h.findIndex(x => x.indexOf('clientes') === 0 || x === 'cliente');
  if (iCli < 0) throw new Error('não achei a coluna Clientes na Programação');
  const achaEm = (ini, fim, cands) => {
    for (const cand of cands) {
      for (let i = ini; i < fim; i++) if (h[i] && h[i].indexOf(cand) === 0) return letra(i);
    }
    return null;
  };
  const fim = h.length;
  return {
    emb: achaEm(0, iCli, ['data embarque', 'embarque']),
    cts: achaEm(0, iCli, ['n cts', 'no cts', 'n carretas', 'carretas', 'cts']),
    tonProd: achaEm(0, iCli, ['toneladas', 'ton']),
    cli: letra(iCli),
    dst: achaEm(iCli, fim, ['cidade uf', 'cidade']),
    ton: achaEm(iCli + 1, fim, ['toneladas', 'ton']),
    of: achaEm(iCli, fim, ['oferta']),
    net: achaEm(iCli, fim, ['net', 'valor net']),
    net2: achaEm(iCli, fim, ['valor net melhor', 'valor net', 'net melhor']),
    cli2: achaEm(iCli, fim, ['nome melhor', 'melhor cliente', 'nome']),
    // segunda melhor oferta (a proxima depois da de CD.net2/cli2 acima).
    // "segunda"/"segundo" por extenso de proposito: norm() (acima) tira
    // digitos e ordinais como "2º"/"3º" do texto, entao um cabecalho tipo
    // "Valor NET 3º melhor oferta" normalizaria pro MESMO texto que "Valor
    // NET melhor oferta" (CD.net2) e um roubaria a coluna do outro. Por
    // extenso ("segunda") sobra distinto depois de normalizado.
    net3: achaEm(iCli, fim, ['valor net segunda melhor', 'net segunda melhor', 'segunda melhor oferta']),
    cli3: achaEm(iCli, fim, ['nome segunda melhor', 'segunda melhor cliente', 'segundo melhor cliente']),
    icms: achaEm(iCli, fim, ['icms']),
    pis: achaEm(iCli, fim, ['pis']),
    modal: achaEm(iCli, fim, ['modal cif', 'frete cif', 'modal', 'frete c']),
    vfrete: achaEm(iCli, fim, ['valor frete']),
    entrega: achaEm(iCli, fim, ['data entrega', 'entrega'])
  };
}

/* ---- estimativa de trânsito ---- */
var KM_DIA = 500, FATOR_ROD = 1.25;

function geo(cidade, uf) {
  const p = CIDADES[norm(cidade) + '|' + uf];
  return (p && p.length > 3) ? { lat: p[2], lon: p[3] } : null;
}

function geoDestino(dst) {
  const s = String(dst || '').trim();
  const m = /[,\s]([A-Za-z]{2})$/.exec(s);
  const uf = m ? m[1].toUpperCase() : null;
  const cid = m ? s.slice(0, m.index) : s;
  if (!norm(cid)) return null;
  if (uf) return geo(cid, uf);
  const alvo = norm(cid) + '|';
  for (const k in CIDADES) {
    if (k.indexOf(alvo) === 0 && CIDADES[k].length > 3)
      return { lat: CIDADES[k][2], lon: CIDADES[k][3] };
  }
  return null;
}

function kmEntre(a, b) {
  const R = 6371, g = Math.PI / 180;
  const dLat = (b.lat - a.lat) * g, dLon = (b.lon - a.lon) * g;
  const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * g) * Math.cos(b.lat * g) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function diasTransito(origem, destino) {
  if (!origem || !destino) return null;
  const km = kmEntre(origem, destino) * FATOR_ROD;
  return Math.max(1, Math.ceil(km / KM_DIA));
}

/* ---- aba de vendas, um bloco por cliente ---- */
function abaVendas(zip, prod, aloc, mapa, estilos) {
  const ondeUn = {};
  prod.plants.forEach(p => ondeUn[p.sigla] = p);
  const grupos = new Map();
  aloc.forEach(a => {
    const k = a.cli + '|' + a.sigla;
    const g = grupos.get(k) || { cli: a.cli, sigla: a.sigla, dst: a.dst, ton: 0, src: a.src };
    g.ton += a.ton;
    grupos.set(k, g);
  });
  const porCli = new Map();
  grupos.forEach(g => {
    const l = porCli.get(g.cli) || [];
    l.push(g); porCli.set(g.cli, l);
  });
  const clientes = [...porCli.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const CAB = ['Data', 'Sigla', 'Unidades', 'UF', 'Cliente', 'Cidade', 'Volume',
    'A Faturar', 'ICMS', 'PIS/COFiNS', 'Frete', 'Pagamento'];
  const COL = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const linhas = [];
  let r = 1;
  clientes.forEach(cli => {
    const cab = { r: r++, cels: [] };
    CAB.forEach((t, i) => cab.cels.push({ col: COL[i], txt: t, s: estilos.cab }));
    linhas.push(cab);
    porCli.get(cli).sort((a, b) => b.ton - a.ton).forEach(g => {
      const un = ondeUn[g.sigla] || {};
      const src = mapa.rows[g.src] || {};
      const of = src.ofEdit != null ? src.ofEdit : src.of;
      const lin = { r: r++, cels: [] };
      const põe = (col, o) => lin.cels.push(Object.assign({ col: col }, o));
      if (mapa.dataSerial != null) põe('A', { v: mapa.dataSerial, s: estilos.data });
      else põe('A', { txt: mapa.data || '', s: estilos.txt });
      põe('B', { txt: 'JBS - ' + g.sigla, s: estilos.txt });
      põe('C', { txt: String(un.cidade || '').toUpperCase(), s: estilos.txt });
      põe('D', { txt: un.uf || '', s: estilos.centro });
      põe('E', { txt: g.cli, s: estilos.txt });
      põe('F', { txt: g.dst || '', s: estilos.txt });
      põe('G', { v: g.ton, s: estilos.ton });
      põe('H', { v: of != null ? of : '', s: estilos.moeda });
      põe('I', { v: src.icms != null ? src.icms : '', s: estilos.perc });
      põe('J', { txt: src.pis != null
        ? (src.pis * 100).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + '%' : '',
        s: estilos.centro });
      põe('K', { txt: ehModal(src.modal) ? src.modal.toUpperCase() : '', s: estilos.centro });
      põe('L', { txt: src.pgt || '', s: estilos.centro });
      linhas.push(lin);
    });
    r++;
  });
  return { linhas: linhas, blocos: clientes.length, larguras: [13, 12, 24, 6, 40, 26, 11, 13, 9, 12, 8, 13] };
}

function garantirNumFmt(xml, codeEsc) {
  // procurar SO dentro de <numFmts>: os numFmt de <dxfs> usam outra numeracao
  const esc = codeEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bloco = (/<numFmts[^>]*>[\s\S]*?<\/numFmts>/.exec(xml) || [''])[0];
  const m = new RegExp('<numFmt numFmtId="(\\d+)" formatCode="' + esc + '"\\s*/>').exec(bloco);
  if (m) return { xml: xml, id: parseInt(m[1], 10) };
  let maior = 163;
  (xml.match(/<numFmt numFmtId="(\d+)"/g) || []).forEach(s =>
    maior = Math.max(maior, parseInt(/\d+/.exec(s)[0], 10)));
  const id = maior + 1;
  const novo = '<numFmt numFmtId="' + id + '" formatCode="' + codeEsc + '"/>';
  const mn = /<numFmts count="(\d+)">/.exec(xml);
  const out = mn
    ? xml.replace(/<numFmts count="\d+">/, '<numFmts count="' + (parseInt(mn[1], 10) + 1) + '">')
        .replace('</numFmts>', () => novo + '</numFmts>')
    : xml.replace(/(<styleSheet[^>]*>)/, m2 => m2 + '<numFmts count="1">' + novo + '</numFmts>');
  return { xml: out, id: id };
}

function novoXf(xml, baseIdx, numFmtId) {
  const m = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(xml);
  const xfs = m[2].match(/<xf [^>]*\/>|<xf [^>]*>[\s\S]*?<\/xf>/g) || [];
  const base = (baseIdx != null && xfs[baseIdx]) ? xfs[baseIdx]
    : '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>';
  let novo = /numFmtId="\d+"/.test(base)
    ? base.replace(/numFmtId="\d+"/, () => 'numFmtId="' + numFmtId + '"')
    : base.replace('<xf ', () => '<xf numFmtId="' + numFmtId + '" ');
  if (novo.indexOf('applyNumberFormat') < 0)
    novo = novo.replace('<xf ', () => '<xf applyNumberFormat="1" ');
  const idx = xfs.length;
  const out = xml.replace(/<cellXfs count="\d+">/, '<cellXfs count="' + (idx + 1) + '">')
    .replace('</cellXfs>', () => novo + '</cellXfs>');
  return { xml: out, idx: String(idx) };
}

async function gravarAba(zip, nome, conteudo, texto) {
  const rels = await entryText(zip, 'xl/_rels/workbook.xml.rels');
  const wb = await entryText(zip, 'xl/workbook.xml');
  const ct = await entryText(zip, '[Content_Types].xml');

  // já existe uma aba com esse nome? reaproveita
  let caminho = null, wbNovo = wb, relsNovo = rels, ctNovo = ct;
  const mSheet = new RegExp('<sheet [^>]*name="' + nome + '"[^>]*/>').exec(wb);
  if (mSheet) {
    const rid = /r:id="([^"]+)"/.exec(mSheet[0]);
    const mRel = new RegExp('<Relationship[^>]*Id="' + rid[1] + '"[^>]*/>').exec(rels);
    let alvo = /Target="([^"]+)"/.exec(mRel[0])[1];
    if (alvo.charAt(0) === '/') alvo = alvo.slice(1);
    else if (!/^xl\//.test(alvo)) alvo = 'xl/' + alvo;
    caminho = alvo;
  } else {
    let k = 1;
    while (zip.has('xl/worksheets/sheet' + k + '.xml')) k++;
    caminho = 'xl/worksheets/sheet' + k + '.xml';
    let maxR = 0;
    (rels.match(/Id="rId(\d+)"/g) || []).forEach(s => {
      maxR = Math.max(maxR, parseInt(/\d+/.exec(s)[0], 10));
    });
    const rid = 'rId' + (maxR + 1);
    let maxId = 0;
    (wb.match(/sheetId="(\d+)"/g) || []).forEach(s => {
      maxId = Math.max(maxId, parseInt(/\d+/.exec(s)[0], 10));
    });
    relsNovo = rels.replace('</Relationships>',
      '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/' +
      'officeDocument/2006/relationships/worksheet" Target="worksheets/' +
      caminho.split('/').pop() + '"/></Relationships>');
    wbNovo = wb.replace('</sheets>', '<sheet name="' + nome + '" sheetId="' +
      (maxId + 1) + '" r:id="' + rid + '"/></sheets>');
    ctNovo = ct.replace('</Types>', '<Override PartName="/' + caminho +
      '" ContentType="application/vnd.openxmlformats-officedocument.' +
      'spreadsheetml.worksheet+xml"/></Types>');
  }

  const cols = conteudo.larguras.map((w, i) =>
    '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('');
  const linhas = conteudo.linhas.map(l => {
    const cels = l.cels.map(cel => {
      const ref = cel.col + l.r;
      const s = cel.s != null ? ' s="' + cel.s + '"' : '';
      if (cel.txt != null) {
        if (cel.txt === '') return '';
        const t = texto(cel.txt);
        return t.si != null
          ? '<c r="' + ref + '"' + s + ' t="s"><v>' + t.si + '</v></c>'
          : '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t>' + escXml(cel.txt) + '</t></is></c>';
      }
      if (cel.v === '' || cel.v == null) return '';
      return '<c r="' + ref + '"' + s + '><v>' +
        (typeof cel.v === 'number' ? Number(cel.v.toPrecision(12)) : cel.v) + '</v></c>';
    }).join('');
    return '<row r="' + l.r + '">' + cels + '</row>';
  }).join('');
  const ultima = conteudo.linhas.length ? conteudo.linhas[conteudo.linhas.length - 1].r : 1;
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="A1:' + (conteudo.colunas || 'L') + ultima + '"/>' +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    '<cols>' + cols + '</cols>' +
    '<sheetData>' + linhas + '</sheetData>' +
    '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '<pageSetup orientation="landscape" paperSize="9"/></worksheet>';

  await trocarEntrada(zip, caminho, xml);
  if (!mSheet) {
    await trocarEntrada(zip, 'xl/workbook.xml', wbNovo);
    await trocarEntrada(zip, 'xl/_rels/workbook.xml.rels', relsNovo);
    await trocarEntrada(zip, '[Content_Types].xml', ctNovo);
  }
}

async function programacaoPreenchida(buf, prod, aloc, ops, dataMapa, serialMapa) {
  const zip = await unzip(buf);
  const relTxt = await entryText(zip, 'xl/_rels/workbook.xml.rels');
  const relDoc = new DOMParser().parseFromString(relTxt, 'application/xml');
  const rel = {};
  for (const r of relDoc.getElementsByTagName('Relationship')) {
    let t = r.getAttribute('Target');
    if (t.charAt(0) === '/') t = t.slice(1); else if (!/^xl\//.test(t)) t = 'xl/' + t;
    rel[r.getAttribute('Id')] = t;
  }
  const wbTxt = await entryText(zip, 'xl/workbook.xml');
  const wbDoc = new DOMParser().parseFromString(wbTxt, 'application/xml');
  let caminho = null;
  for (const sh of wbDoc.getElementsByTagName('sheet')) {
    if (sh.getAttribute('name') !== prod.aba) continue;
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    caminho = rel[rid];
  }
  if (!caminho) throw new Error('não localizei a aba ' + prod.aba + ' dentro do arquivo');

  const xml = await entryText(zip, caminho);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const sd = doc.getElementsByTagName('sheetData')[0];
  const orig = [].slice.call(sd.getElementsByTagName('row'));
  const porLinha = repartir(prod, aloc);
  const somaAloc = aloc.reduce((s, a) => s + a.ton, 0);

  const CD = prod.colDest;
  if (!CD) throw new Error('a Programação não tem as colunas de destino (Clientes, Cidade/UF, Ton...)');
  const COLS = [];
  for (let i = 0; i < 26; i++) COLS.push(letra(i));
  const ondeFica = {};
  prod.plants.forEach(p => ondeFica[p.sigla] = geo(p.cidade, p.uf));
  const embarqueDe = {};
  prod.linhas.forEach(l => { if (l.emb != null) embarqueDe[l.r] = l.emb; });
  const transito = [], semRota = [];
  const ssTxt = await entryText(zip, 'xl/sharedStrings.xml');
  let nSS = 0, novasSS = [];
  const jaSS = new Map();
  if (ssTxt) {
    const sd0 = new DOMParser().parseFromString(ssTxt, 'application/xml');
    const sis = sd0.getElementsByTagName('si');
    nSS = sis.length;
    for (let i = 0; i < nSS; i++) {
      let s = '';
      const ts = sis[i].getElementsByTagName('t');
      for (let k = 0; k < ts.length; k++) s += ts[k].textContent;
      if (!jaSS.has(s)) jaSS.set(s, i);
    }
  }
  const texto = s => {
    const v = String(s == null ? '' : s);
    if (!ssTxt) return { txt: v };
    if (!jaSS.has(v)) { jaSS.set(v, nSS + novasSS.length); novasSS.push(v); }
    return { txt: v, si: jaSS.get(v) };
  };
  const novas = [];
  let n = 0, ultimaDado = 0;

  orig.forEach(row => {
    const rOld = parseInt(row.getAttribute('r'), 10);
    const partes = porLinha[rOld];
    const lista = (partes && partes.length) ? partes : [null];
    const copias = lista.map((x, k) => k === 0 ? row : row.cloneNode(true));
    lista.forEach((p, k) => {
      const el = copias[k];
      n++;
      el.setAttribute('r', String(n));
      COLS.forEach(col => celula(el, col, n, null));
      // nas linhas de embarque o bloco de destino é reescrito do zero
      if (porLinha[rOld]) {
        ['cli', 'dst', 'ton', 'of', 'net', 'net2', 'cli2', 'net3', 'cli3', 'icms', 'pis', 'modal',
          'vfrete', 'entrega']
          .forEach(k2 => { if (CD[k2]) celula(el, CD[k2], n, { limpar: true }); });
      }
      // fórmulas compartilhadas viram fórmulas normais: duplicar a definição
      // mestre ao dividir uma linha faz o Excel acusar arquivo corrompido
      [].slice.call(el.getElementsByTagName('f')).forEach(f => {
        const cel = f.parentNode;
        const col = (cel.getAttribute('r') || '').replace(/\d+$/, '');
        f.removeAttribute('t'); f.removeAttribute('si'); f.removeAttribute('ref');
        const t = f.textContent;
        // A linha de totais da Tabela do Excel usa SUBTOTAL/AGGREGATE e referencia
        // estruturada (Tabela1[Coluna]). Ela mora na coluna de Toneladas, entao
        // caia na regra do CTS*35 abaixo e era destruida — o Excel abria pedindo
        // reparo porque a tabela declara totalsRowCount mas a linha nao era mais
        // de totais. Formula de agregacao fica intacta e o Excel recalcula sozinho.
        if (/^\s*(SUBTOTAL|AGGREGATE)\s*\(/i.test(t) || /[A-Za-z0-9_]+\[/.test(t)) return;
        const mSum = /^SUM\(([A-Z]{1,3})\d+:[A-Z]{1,3}\d+\)$/.exec(t);
        if (col === CD.tonProd && CD.cts) f.textContent = CD.cts + n + '*35';
        else if (mSum) f.textContent = 'SUM(' + mSum[1] + '2:' + mSum[1] + ultimaDado + ')';
        else if (!t) cel.removeChild(f);
        else if (/^[A-Z]{1,3}\d+\*35$/.test(t) && CD.cts) f.textContent = CD.cts + n + '*35';
      });
      if (p) {
        ultimaDado = n;
        const inteiro = Math.abs(p.ton / 35 - Math.round(p.ton / 35)) < 1e-9;
        if (CD.cts) celula(el, CD.cts, n, { v: inteiro ? Math.round(p.ton / 35) : p.ton / 35 });
        if (CD.tonProd) celula(el, CD.tonProd, n,
          (inteiro && CD.cts) ? { f: CD.cts + n + '*35', v: p.ton } : { v: p.ton });
        if (p.dest) {
          const src = MAPA_ROWS ? MAPA_ROWS[p.dest.src] : null;
          const put = (col, spec) => { if (col) celula(el, col, n, spec); };
          put(CD.cli, texto(p.dest.cli));
          put(CD.dst, texto(p.dest.dst || ''));
          put(CD.ton, { v: p.ton });
          if (src) {
            put(CD.of, { v: src.ofEdit != null ? src.ofEdit : src.of });
            put(CD.net, { v: p.dest.net });
            if (CD.net2 || CD.cli2 || CD.net3 || CD.cli3) {
              // [0] e a melhor alternativa (CD.net2/cli2, o que a tela ja
              // chama de "2º melhor" — a propria carga conta como a 1a),
              // [1] e a segunda melhor alternativa (CD.net3/cli3, a nova
              // coluna pedida). Filtros em melhoresAlternativas() acima.
              const [alt, alt2] = melhoresAlternativas((ops && ops[p.dest.sigla]) || [], p.dest.cli);
              if (alt) {
                put(CD.net2, { v: alt.net });
                put(CD.cli2, texto(alt.cli));
              }
              if (alt2) {
                put(CD.net3, { v: alt2.net });
                put(CD.cli3, texto(alt2.cli));
              }
            }
            put(CD.icms, { v: src.icms });
            put(CD.pis, { v: src.pis });
            put(CD.modal, texto(ehModal(src.modal) ? src.modal.toUpperCase() : ''));
            put(CD.vfrete, { v: src.fcli });
            if (CD.entrega && /cif/i.test(src.modal || '')) {
              const dias = diasTransito(ondeFica[p.dest.sigla], geoDestino(p.dest.dst));
              const emb = embarqueDe[rOld];
              if (dias != null && emb != null) {
                put(CD.entrega, { v: emb + dias });
                transito.push({ sigla: p.dest.sigla, destino: p.dest.dst, dias: dias });
              } else if (dias == null) {
                semRota.push(p.dest.dst || p.dest.cli);
              }
            }
          }
        }
      } else if (porLinha[rOld]) {
        ultimaDado = n;
      }
      novas.push(el);
    });
  });

  while (sd.firstChild) sd.removeChild(sd.firstChild);
  novas.forEach(el => sd.appendChild(el));

  const estiloDe = (linha, col) => {
    if (!col) return null;
    for (const row of novas) {
      if (parseInt(row.getAttribute('r'), 10) !== linha) continue;
      const cs = row.getElementsByTagName('c');
      for (let i = 0; i < cs.length; i++)
        if ((cs[i].getAttribute('r') || '').replace(/\d+$/, '') === col)
          return cs[i].getAttribute('s');
    }
    return null;
  };

  // ---- formato padronizado por coluna ----
  let stXml = await entryText(zip, 'xl/styles.xml');
  const stOriginal = stXml;
  const MOEDA = '&quot;R$&quot;\\ #,##0';
  const cacheNF = new Map(), cacheXF = new Map();
  const idFmt = code => {
    if (cacheNF.has(code)) return cacheNF.get(code);
    const g = garantirNumFmt(stXml, code);
    stXml = g.xml; cacheNF.set(code, g.id); return g.id;
  };
  const estiloCom = (sBase, code) => {
    const nid = idFmt(code);
    const k = (sBase == null ? '' : sBase) + '|' + nid;
    if (cacheXF.has(k)) return cacheXF.get(k);
    const x = novoXf(stXml, sBase == null ? null : parseInt(sBase, 10), nid);
    stXml = x.xml; cacheXF.set(k, x.idx); return x.idx;
  };
  const estMoeda0 = estiloCom(estiloDe(2, CD.of), MOEDA);

  const FMTCOL = {};
  const fmt = (col, code) => { if (col && !FMTCOL[col]) FMTCOL[col] = code; };
  fmt(CD.cts, '#,##0');
  fmt(CD.tonProd, '#,##0.##');
  fmt(CD.ton, '#,##0.##');
  fmt(CD.of, MOEDA);
  fmt(CD.net, MOEDA);
  fmt(CD.net2, MOEDA);
  fmt(CD.net3, MOEDA);
  fmt(CD.vfrete, MOEDA);
  fmt(CD.icms, '0%');
  fmt(CD.pis, '0.000%');
  fmt(CD.emb, 'dd/mm/yyyy');
  fmt(CD.entrega, 'dd/mm/yyyy');
  novas.forEach(row => {
    if (parseInt(row.getAttribute('r'), 10) < 2) return;
    const cs = row.getElementsByTagName('c');
    for (let i = 0; i < cs.length; i++) {
      const col = (cs[i].getAttribute('r') || '').replace(/\d+$/, '');
      const code = FMTCOL[col];
      if (!code || cs[i].getAttribute('t') === 's') continue;
      cs[i].setAttribute('s', estiloCom(cs[i].getAttribute('s'), code));
    }
  });

  // ---- acumulado por cliente (vai para a aba Resumo) ----
  const acum = new Map();
  aloc.forEach(a => {
    const k = a.cli + '|' + a.uf;
    const cur = acum.get(k) || { cli: a.cli, uf: a.uf, dst: a.dst, ton: 0, valor: 0 };
    const src = MAPA_ROWS ? MAPA_ROWS[a.src] : null;
    const of = src ? (src.ofEdit != null ? src.ofEdit : src.of) : null;
    cur.ton += a.ton;
    if (of != null) cur.valor += of * a.ton;
    acum.set(k, cur);
  });
  const porCliente = {};
  acum.forEach(x => porCliente[x.cli] = (porCliente[x.cli] || 0) + x.ton);
  const resumo = [...acum.values()].sort((a, b) =>
    porCliente[b.cli] - porCliente[a.cli] || a.cli.localeCompare(b.cli) || a.uf.localeCompare(b.uf));
  const ultimaLinha = n;

  const dim = doc.getElementsByTagName('dimension')[0];
  if (dim) {
    const ref = dim.getAttribute('ref') || '';
    const mDim = /^([A-Z]+\d+):([A-Z]+)\d+$/.exec(ref);
    if (mDim) dim.setAttribute('ref', mDim[1] + ':' + mDim[2] + ultimaLinha);
  }

  // linha de total ganha a soma do volume alocado
  const ultima = novas[novas.length - 1];
  const totalRow = novas.find(el => {
    const fs = el.getElementsByTagName('f');
    for (let i = 0; i < fs.length; i++) if (/^SUM\(J2:J/.test(fs[i].textContent)) return true;
    return false;
  });
  if (totalRow && CD.ton) {
    const rT = totalRow.getAttribute('r');
    celula(totalRow, CD.ton, rT, { f: 'SUM(' + CD.ton + '2:' + CD.ton + ultimaDado + ')', v: somaAloc });
  }

  const saida = new XMLSerializer().serializeToString(doc);
  await trocarEntrada(zip, caminho, saida);


  // se a aba usa Tabela do Excel, o intervalo precisa acompanhar as linhas novas
  const acrescidas = n - orig.length;
  if (acrescidas > 0) {
    for (const nome of [...zip.keys()]) {
      if (!/^xl\/tables\/.+\.xml$/.test(nome)) continue;
      const t = await entryText(zip, nome);
      await trocarEntrada(zip, nome, t.replace(
        /ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g,
        (m0, c1, r1, c2, r2) => 'ref="' + c1 + r1 + ':' + c2 + (parseInt(r2, 10) + acrescidas) + '"'));
    }
  }

  // o mapa de cálculo antigo não vale mais
  const ct = (await entryText(zip, '[Content_Types].xml'))
    .replace(/<Override[^>]*calcChain[^>]*\/>/, '');
  await trocarEntrada(zip, '[Content_Types].xml', ct);
  const rl = relTxt.replace(/<Relationship[^>]*calcChain[^>]*\/>/, '');
  await trocarEntrada(zip, 'xl/_rels/workbook.xml.rels', rl);
  let wb = wbTxt.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="0" fullCalcOnLoad="1"/>');
  if (wb.indexOf('fullCalcOnLoad') < 0) wb = wb.replace('</workbook>',
    '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>');
  await trocarEntrada(zip, 'xl/workbook.xml', wb);

  if (stXml !== stOriginal) await trocarEntrada(zip, 'xl/styles.xml', stXml);

  const estResumo = {
    cab: estiloDe(1, CD.cli), txt: estiloDe(2, CD.cli), centro: estiloDe(2, CD.modal),
    ton: estiloDe(2, CD.tonProd), moeda: estMoeda0
  };
  const linhasR = [];
  let rr = 1;
  linhasR.push({ r: rr++, cels: [
    { col: 'A', txt: 'UF Fornecedora', s: estResumo.cab },
    { col: 'B', txt: 'Clientes', s: estResumo.cab },
    { col: 'C', txt: 'Cidade/UF', s: estResumo.cab },
    { col: 'D', txt: '$ Oferta', s: estResumo.cab },
    { col: 'E', txt: 'Toneladas', s: estResumo.cab }] });
  const primeiraR = rr;
  resumo.forEach(x => {
    linhasR.push({ r: rr++, cels: [
      { col: 'A', txt: x.uf, s: estResumo.centro },
      { col: 'B', txt: x.cli, s: estResumo.txt },
      { col: 'C', txt: x.dst || '', s: estResumo.txt },
      { col: 'D', v: x.ton > 0 ? x.valor / x.ton : 0, s: estResumo.moeda },
      { col: 'E', v: x.ton, s: estResumo.ton }] });
  });
  linhasR.push({ r: rr, cels: [
    { col: 'B', txt: 'TOTAL', s: estResumo.cab },
    { col: 'E', f: 'SUM(E' + primeiraR + ':E' + (rr - 1) + ')',
      v: resumo.reduce((s, x) => s + x.ton, 0), s: estResumo.cab }] });
  await gravarAba(zip, 'Resumo',
    { linhas: linhasR, larguras: [15, 42, 26, 14, 13], colunas: 'E' }, texto);

  const estVendas = {
    cab: estiloDe(1, CD.cli), txt: estiloDe(2, CD.cli), centro: estiloDe(2, CD.modal),
    data: estiloDe(2, CD.emb), ton: estiloDe(2, CD.tonProd),
    moeda: estMoeda0, perc: estiloDe(2, CD.icms)
  };
  const vendas = abaVendas(zip, prod, aloc, { rows: MAPA_ROWS || [], data: dataMapa,
    dataSerial: serialMapa }, estVendas);
  await gravarAba(zip, 'Vendas', vendas, texto);

  if (ssTxt && novasSS.length) {
    const add = novasSS.map(s =>
      '<si><t xml:space="preserve">' + escXml(s) + '</t></si>').join('');
    let ss = ssTxt.replace('</sst>', add + '</sst>');
    const uniq = nSS + novasSS.length;
    const cnt = /count="(\d+)"/.exec(ss);
    if (cnt) ss = ss.replace(/count="\d+"/, 'count="' + (parseInt(cnt[1], 10) + novasSS.length) + '"');
    ss = ss.replace(/uniqueCount="\d+"/, 'uniqueCount="' + uniq + '"');
    await trocarEntrada(zip, 'xl/sharedStrings.xml', ss);
  }

  const nomes = [...zip.keys()].filter(x => x !== 'xl/calcChain.xml');
  return { arquivo: rezip(nomes, zip), transito: transito, semRota: [...new Set(semRota)],
    linhas: ultimaDado - 1, resumo: resumo.length, vendas: vendas.blocos };
}

var MAPA_ROWS = null;

/* ====================== RANKING DE TERCEIROS ====================== */
function opcoes(ds, travas, topN, manter, modo) {
  // No mercado livre a propria disputa so por preco: exigir volume digitado
  // a tirava do ranking. A trava fiscal continua valendo nos dois modos.
  const LIVRE = modo === 'mercado';
  const por = {};
  ds.quotes.forEach(x => {
    if (x.prop) {
      if (travaBloqueia(travas[x.cli], x.uf)) return;
      const d = ds.proprios.get(x.cli);
      if (!d) return;
      if (!LIVRE && !(d.ton > 0)) return;
    }
    (por[x.sigla] || (por[x.sigla] = [])).push(x);
  });
  const usados = manter || {};
  for (const s in por) {
    por[s].sort((a, b) => b.net - a.net);
    const n = topN || 8;
    const corte = por[s].slice(0, n);
    por[s].slice(n).forEach(x => { if ((usados[s] || []).indexOf(x.cli) >= 0) corte.push(x); });
    por[s] = corte;
  }
  return por;
}

// A melhor e a segunda melhor oferta de terceiro pra uma carga de fabrica
// propria, entre as opcoes da MESMA sigla (o pool ja vem filtrado por
// sigla — ver opcoes(), que tambem so cita quem passou pela trava fiscal).
// Mesmos filtros de sempre: fora o cliente desta propria carga (nao faz
// sentido comparar com ela mesma), e so terceiro de verdade — fabrica
// propria nunca conta como "oferta de terceiro" aqui, mesmo que tenha NET
// maior. "lista" ja tem no maximo uma linha por cliente (a de maior NET
// dele, ver montar()), entao nao precisa dedupli-la de novo. Devolve
// [melhor, segunda] — qualquer um vem null quando nao ha candidato
// suficiente (nunca inventa valor). Usado pela exportacao (ver
// programacaoPreenchida(), colunas "2º/segunda melhor").
function melhoresAlternativas(lista, clienteDestino) {
  // dedup por cliente (a melhor oferta dele) — defensivo: ops[sigla] ja
  // vem de ds.quotes, que so tem uma linha por cliente (ver montar()), mas
  // a funcao nao depende disso pra estar correta sozinha.
  const porCliente = new Map();
  (lista || []).forEach(o => {
    if (o.cli === clienteDestino || o.prop) return;
    const atual = porCliente.get(o.cli);
    if (!atual || o.net > atual.net) porCliente.set(o.cli, o);
  });
  const candidatos = [...porCliente.values()].sort((a, b) => b.net - a.net);
  return [candidatos[0] || null, candidatos[1] || null];
}

// Isomorfico: no navegador este arquivo e colado dentro de um <script> por
// build.js (typeof module e "undefined" la, o bloco abaixo nao roda). Em
// Node (db.js, migracao de net_ter_med para semanas fechadas antigas)
// "require('./src/core.js')" pega so o que interessa do lado do servidor —
// nada de leitura de xlsx nem geracao de planilha, que sao coisa de navegador.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    montar, comparacaoTerceiros, ehPropriaFabrica, recalcularTerceirosSemana, agregarSemana,
    motivoModeloZero, textoMotivoZero
  };
}
