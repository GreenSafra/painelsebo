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
- **Fase 3 (nao iniciada)** — gravar as semanas fechadas no banco, com
  versionamento, e tela de consolidado mensal. Nao adiante.

## Idioma

Responda sempre em portugues do Brasil.
