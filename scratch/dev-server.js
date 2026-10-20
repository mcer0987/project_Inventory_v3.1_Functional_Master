// [WHY]: Uygulamayı emülatöre bağlı elle denemek için yerel bir sunucu gerekiyor (Live Server her makinede açık değil); Live
//        Server ayrıca güvenlik başlıklarını (CSP) göndermediği için canlıda engellenecek bir kaynak yerelde fark edilmiyordu.
// [HOW]: Akış testlerinin sunucusuyla aynı: depo kökü 127.0.0.1'de, HTML yanıtlarında firebase.json başlıkları + emülatör
//        kaynakları (scratch/csp.js). CSP ihlalleri terminale yazılır. Yalnız 127.0.0.1 (ağdan erişilemez); kök dışına çıkılamaz.
// Usage: npm run serve  [-- --port 5500]   →  http://127.0.0.1:5500/index.html?emu=1  (emülatör: npm run emu)
const http = require('http');
const fs = require('fs');
const path = require('path');
const CSP = require('./csp');

const ROOT = path.resolve(__dirname, '..');
const i = process.argv.indexOf('--port');
const PORT = i > -1 ? Number(process.argv[i + 1]) : 5500;
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const HEADERS = CSP.testHeaders({ emu: true });
const csp = CSP.createCollector();
let reported = 0;

const server = http.createServer((req, res) => {
    if (csp.handle(req, res)) {
        const s = csp.summary();
        if (s.count > reported) { reported = s.count; console.log(`⚠ CSP ihlali (${s.count}):`, JSON.stringify(s.distinct)); }
        return;
    }
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end(); console.log(`404 ${rel}`); return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', ...(ext === '.html' ? HEADERS : {}) });
    fs.createReadStream(file).pipe(res);
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `✖ ${PORT} portu kullanımda (Live Server açık olabilir). Başka port: npm run serve -- --port 5501` : e.message); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => {
    console.log(`✔ http://127.0.0.1:${PORT}/index.html?emu=1   (emülatöre bağlı)`);
    console.log(`  http://127.0.0.1:${PORT}/index.html         (inventory_demo, gerçek proje)`);
    console.log('  Kapatmak için Ctrl+C.');
});
