/** Prints the security-relevant response headers for the soft-launch checks. */
const http = require('http');
http.get('http://127.0.0.1:5050/', (res) => {
  const wanted = ['x-robots-tag', 'content-security-policy', 'x-powered-by', 'set-cookie', 'referrer-policy'];
  for (const name of wanted) {
    console.log(`${name}: ${res.headers[name] ? String(res.headers[name]).slice(0, 90) : '(absent)'}`);
  }
  res.resume();
});
