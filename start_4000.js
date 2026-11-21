process.env.PORT = '4000';
const http = require('http');
const requestHandler = require('./server.js');
const server = http.createServer(requestHandler);
server.listen(4000, '0.0.0.0', () => {
  console.log('Servidor COD rodando em http://localhost:4000');
});
