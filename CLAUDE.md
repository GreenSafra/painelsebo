# Painel de alocacao de sebo

Ferramenta interna de distribuicao semanal de sebo bovino entre unidades
Friboi, fabricas proprias (BioPower, Flora) e clientes terceiros.

## Regra inviolavel

**Nunca altere `public/index.html`.**

Ele e um painel autocontido de 134072 bytes, ja validado, com toda a logica
de importacao de planilha, otimizacao e exportacao rodando no navegador.
Qualquer edicao quebra a ferramenta. Se algo parecer errado nele, pare e
avise — nao conserte.

## Modo de trabalho

- Trabalhe de forma autonoma. Nao peca confirmacao a cada passo.
- Resolva os problemas que aparecerem no caminho.
- So pare se esbarrar em algo destrutivo, irreversivel, ou que envolva
  credencial.
- Reporte apenas no final, de forma objetiva.

## Contexto tecnico

- Servidor: Node com Express, em `server.js`. Entrega o painel e expoe
  `/saude`.
- Variavel `SENHA`: se definida, protege o painel com senha unica. Opcional.
- Hospedagem: Railway, projeto separado da GreenSafra.
- Repositorio: https://github.com/GreenSafra/painelsebo.git
- Dado comercial da JBS. O repositorio deve ser privado.

## Fases do projeto

- **Fase 1 (atual):** publicar o painel numa URL.
- **Fase 2:** Postgres para guardar cada semana enviada.
- **Fase 3:** tela de consolidado mensal somando as semanas.

Nao adiante fases. Nao adicione Postgres agora.

## Idioma

Responda sempre em portugues do Brasil.
