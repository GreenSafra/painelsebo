# Painel de alocacao de sebo

Ferramenta interna de distribuicao semanal de sebo bovino entre unidades
Friboi, fabricas proprias (BioPower, Flora) e clientes terceiros.

## Estrutura do repositorio

```
src/            fontes do painel  <-- e AQUI que se edita
  shell.html      esqueleto, CSS e marcacao
  core.js         motor: leitura de planilha, otimizacao, exportacao
  ui.js           tela: render, eventos, estado
  states.json     contornos dos estados para o mapa
  logos.json      logos das fabricas em base64
  cidades.json    coordenadas das cidades
  build.js        monta public/index.html a partir dos arquivos acima

public/         servido pelo Express
  index.html      GERADO pelo build. Nao editar a mao.
  entrar.html     login e cadastro
  admin.html      aprovacao de usuarios, so para o master

test/           dez baterias, 187 verificacoes
  rodar.js        roda todas e resume
  in/             planilhas de teste

server.js       Express, rotas de auth, entrega o painel
db.js           Postgres: usuarios, sessoes, senha com scrypt nativo
```

## Regra inviolavel

**Nunca edite `public/index.html` a mao.**

Ele nao e codigo-fonte, e resultado de build. Editar direto faz a alteracao
ser perdida no proximo build. Toda mudanca no painel se faz em `src/` e
depois roda o build.

## Como alterar o painel

1. Editar o arquivo certo em `src/` (`core.js` para regra de negocio,
   `ui.js` para tela, `shell.html` para CSS e marcacao).
2. `node src/build.js` — regrava `public/index.html` e imprime o tamanho.
3. `cd test && npm install && node rodar.js` — as dez baterias.
   O `npm install` so precisa na primeira vez.
4. So commitar se o runner terminar com `TUDO CERTO` e 187 verificacoes.
   Se cair para menos de 187, alguma bateria deixou de rodar: investigue,
   nao ignore.
5. Commitar `src/` e `public/index.html` juntos.

Se uma bateria falhar, **nao suba**. Conserte ou reverta.

## Modo de trabalho

- Trabalhe de forma autonoma. Nao peca confirmacao a cada passo.
- Resolva os problemas que aparecerem no caminho.
- So pare se esbarrar em algo destrutivo, irreversivel, ou que envolva
  credencial.
- Reporte apenas no final, de forma objetiva.

## Contexto tecnico

- Hospedagem: Railway, projeto separado da GreenSafra.
- Repositorio: https://github.com/GreenSafra/painelsebo.git
- Dado comercial da JBS. O repositorio deve ser privado.
- O painel e autocontido: toda a logica roda no navegador, sem chamada de
  rede. O servidor so autentica e entrega o arquivo.
- Variaveis no Railway: `DATABASE_URL` (referencia ao servico Postgres) e
  `EMAIL_MASTER`. A variavel `SENHA` da fase 1 nao e mais usada.
- O `package.json` da raiz tem so `express` e `pg`. As dependencias de
  teste ficam em `test/package.json`, separadas de proposito, para nao
  entrarem no build do Railway. **Nao mova `jsdom` para a raiz.**

## Estado atual

- **Fase 1** — painel publicado numa URL. Pronto.
- **Fase 2** — Postgres, login, cadastro com aprovacao pelo master. Pronto.
- **Fase 2.1** — dois criterios de distribuicao, escolhidos por radio no
  bloco "Destinos da semana":
  - *Prioridade de volume* — atende primeiro os volumes digitados, o resto
    vai pelo melhor NET.
  - *Mercado livre* — ninguem tem prioridade. Toda planta propria disputa
    como terceiro, com a cotacao dela do Mapa. A necessidade e ignorada.

  As travas fiscais (monofasia do ICMS) valem nos dois modos — e lei, nao
  regra comercial. O botao virou "Acrescentar terceiro". Terceiro sem logo
  recebe um marcador redondo com a inicial.
- **Fase 2.2** — apuracao do "Ganho sobre o mercado" (tela e Consolidado)
  passou a comparar cada carga de fabrica propria com a MEDIA do NET entre
  os terceiros que ofertaram para a mesma sigla de origem, nao mais so o
  melhor terceiro. Universo: uma oferta por cliente terceiro (a de maior
  NET dele, se tiver mais de uma), sem o corte top-8 que a tela de troca
  usa pra nao afogar o seletor. Fabrica propria nunca entra nessa media.
  Sem nenhuma oferta de terceiro pra aquela sigla, a carga continua de fora
  da comparacao (regra de sempre). O melhor terceiro isolado (net_ter,
  cliente_ter) continua gravado e aparece na tela como linha informativa
  menor, fora da conta. Funcoes-chave em `src/core.js`: `comparacaoTerceiros()`
  (a media, usada dentro de `montarSemana()`) e `recalcularTerceirosSemana()`
  (mesma conta pra semana ja fechada, a partir do pacote guardado). Colunas
  novas em `alocacoes`: `net_ter_med`, `n_ter`. Semana fechada antes delas
  existirem so ganha os valores se tiver o pacote completo guardado
  (Programacao + Mapa, coluna `semanas.dados`); sem pacote fica pra sempre
  sem media e aparece marcada ("sem media de terceiros") no Consolidado, de
  fora do total. A migracao (`db.js: migrarNetTerMedio()`) roda sozinha,
  de forma idempotente, toda subida do servidor, dentro de `iniciar()`.
- **Fase 2.3** — motivo correto quando o modelo manda ZERO pra uma fabrica
  propria (tela da semana e Consolidado), e destaque ao que foi feito de
  verdade:
  - Antes, a frase sempre dizia "porque havia terceiro pagando mais", mesmo
    quando o motivo real era outro (ex.: semana 39, BioPower Lins e Flora SP
    empatadas em NET nas origens ANF/BTG/LIF, as duas acima do melhor
    terceiro — o modelo mandou tudo pra Flora SP por causa do desempate, nao
    por preco). Agora `src/core.js:motivoModeloZero()` olha de fato quem
    levou cada origem que a fabrica cotou no cenario do modelo: terceiro com
    NET maior, outra propria com NET maior (sem empate), empate perdido pra
    outra oferta (nomeia quem ficou com as cargas), sem oferta nenhuma
    cadastrada pra ela no Mapa, sem demanda que disputasse aquela origem
    (sobra), ou — modo Prioridade de volume, onde a propria nunca disputa
    NET pela propria necessidade — sem necessidade digitada ou necessidade
    digitada sem oferta suficiente. `textoMotivoZero()` traduz pra frase.
    Na tela ao vivo entra direto (`ST.modo`/`ST.nec`/`DS.quotes`/
    `RES.otimoAloc`, tudo em memoria). No Consolidado, `db.js:
    preencherMotivosZeroOtimo()` reconstroi a mesma conta a partir do
    pacote guardado (`semanas.dados`) e das linhas cruas do cenario `otimo`
    — so funciona no modo Semana (uma semana so) e quando a semana tem
    pacote; sem isso (semana fechada antes da migracao, ou modo Mes) a
    frase fica so no fato, sem arriscar o motivo.
  - **Desempate de NET igual e deterministico, por ordem alfabetica do
    cliente** — nao pela ordem das linhas no Mapa (isso era o defeito:
    arbitrario e sem relacao com o merito da oferta). `src/core.js:montar()`
    ordena `ds.quotes` por `(sigla, NET decrescente, cliente A-Z)` antes de
    devolver; como `resolver()` (a disputa em si) e `bestTer` (melhor
    terceiro por sigla) percorrem `quotes` nessa ordem, e o algoritmo de
    fluxo (SPFA) so troca um caminho ja achado por um estritamente melhor,
    quem vem primeiro no alfabeto fica com o empate. Testado (com o Mapa em
    ordens diferentes, mesmo resultado sempre) em `test/test_motivo_modelo.js`.
  - `semanas` ganhou as colunas `modo` (prioridade/mercado, gravado no
    fechamento) e `necessidades` (JSONB, `{cliente: toneladas digitadas}`),
    usadas so pra reconstruir o motivo acima — Consolidado mostra o modo de
    cada semana na tabela de gerenciamento, ao lado do Periodo. Semana
    fechada antes destas colunas existirem fica com as duas NULL.
  - Na tela da semana e no Consolidado, o card de cada fabrica propria
    mudou de layout: "O que foi feito" ocupa a largura toda do card, em
    destaque (numeros maiores) — e o que realmente aconteceu, importa
    primeiro. "O que o modelo mandava" fica recolhido, atras de um link
    ("ver o que o modelo mandava"); quando o modelo nao indicou a fabrica,
    o motivo (acima) aparece dentro do proprio link, sem precisar abrir. O
    selo de comparacao continua no cabecalho do card, sem mudanca.
- **Fase 3 (nao iniciada)** — gravar as semanas fechadas no banco, com
  versionamento, e tela de consolidado mensal. Nao adiante.

## Idioma

Responda sempre em portugues do Brasil.
