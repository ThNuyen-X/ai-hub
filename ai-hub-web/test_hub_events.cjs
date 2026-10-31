const http = require('http');

console.log('Connecting to Hub SSE...');
const hubReq = http.request('http://127.0.0.1:20130/api/hub/events', (res) => {
  console.log('Hub SSE connected, status:', res.statusCode);
  res.on('data', (chunk) => {
    const str = chunk.toString();
    console.log('[HUB EVENT RECEIVED]', str.trim().slice(0, 100));
  });
});
hubReq.end();

setTimeout(() => {
  console.log('Test completed.');
  process.exit(0);
}, 3000);
