# Painel de alocacao de sebo

Painel semanal de distribuicao de sebo bovino entre unidades Friboi,
fabricas proprias (BioPower, Flora) e clientes terceiros.

## Como roda

Servidor Express que entrega `public/index.html`. O painel e autocontido:
toda a logica de importacao de planilha, otimizacao e exportacao roda no
navegador, sem chamada de rede.

## Rodar localmente

```
npm install
npm start
```

Abre em http://localhost:3000

## Variaveis de ambiente

- `PORT` - porta do servidor. O Railway define sozinho.
- `SENHA` - opcional. Se definida, o painel pede senha para abrir.
  Usuario pode ser qualquer coisa; a senha e o que vale.

## Proximas fases

- Fase 2: Postgres para guardar cada semana enviada.
- Fase 3: tela de consolidado mensal somando as semanas.
