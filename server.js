// Painel de alocacao de sebo - servidor
// Fase 1: entrega o painel. O banco entra na fase 2.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// senha unica opcional: defina SENHA nas variaveis do Railway.
// se nao definir, o painel fica aberto para quem tiver a URL.
const SENHA = process.env.SENHA;

if (SENHA) {
  app.use((req, res, next) => {
    const cab = req.headers.authorization || '';
    const [tipo, dados] = cab.split(' ');
    if (tipo === 'Basic' && dados) {
      const [, pass] = Buffer.from(dados, 'base64').toString().split(':');
      if (pass === SENHA) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Painel de sebo"');
    res.status(401).send('Acesso restrito.');
  });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/saude', (req, res) => {
  res.json({ ok: true, quando: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Painel no ar na porta ' + PORT);
});
