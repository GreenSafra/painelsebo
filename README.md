# Painel de alocacao de sebo

Painel semanal de distribuicao de sebo bovino entre unidades Friboi,
fabricas proprias (BioPower, Flora) e clientes terceiros.

## Como roda

Servidor Express que autentica o usuario e entrega `public/index.html`.
O painel e autocontido: toda a logica de importacao de planilha,
otimizacao e exportacao roda no navegador, sem chamada de rede.

## Estrutura

- `src/` — fontes do painel. E aqui que se edita.
- `public/index.html` — gerado pelo build. Nao editar a mao.
- `test/` — dez baterias de teste, 187 verificacoes.

## Alterar o painel

```
node src/build.js        # regera public/index.html
cd test && node rodar.js # roda as dez baterias
```

Na primeira vez, `cd test && npm install` para instalar o jsdom.

## Rodar o servidor localmente

```
npm install
npm start
```

Precisa de um Postgres acessivel via `DATABASE_URL`.

## Variaveis de ambiente

- `DATABASE_URL` — conexao com o Postgres. No Railway, referencia ao servico.
- `EMAIL_MASTER` — e-mail que vira administrador ao se cadastrar.
- `PORT` — porta do servidor. O Railway define sozinho.

## Proxima fase

Fase 3: gravar as semanas fechadas no banco e tela de consolidado mensal.
