// [WHY]: Faz 4 · J5 (M15, KJ-4) — CSP'yi canlıya yayınlamadan önce yerelde, uygulamanın gerçek akışlarında sıfır ihlalle
//        doğrulamak. Firebase Hosting ve nginx aynı politikayı taşımalı; kopyalar zamanla ayrışırsa biri sessizce bozulur.
// [HOW]: Tek kaynak firebase.json ("**" başlıkları). Test sunucuları (smoke, flow) HTML yanıtlarına aynı başlıkları ekler; emülatör
//        modunda connect-src'ye yalnız emülatör adresleri eklenir (canlı politika bunları içermez). Tarayıcı ihlalleri
//        report-uri ile test sunucusuna POST eder; sayı ve ayrıntı rapora girer. nginx kopyası checkNginxCsp ile denetlenir.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = '/__csp-report';
const EMULATOR_ORIGINS = 'http://127.0.0.1:8080 http://127.0.0.1:9099';

function hostingHeaders() {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
    const all = (cfg.hosting.headers || []).find(h => h.source === '**');
    if (!all) throw new Error('firebase.json: "**" başlık bloğu yok');
    return Object.fromEntries(all.headers.map(h => [h.key, h.value]));
}

const productionCsp = () => hostingHeaders()['Content-Security-Policy'];

function withConnectExtra(csp, extra) {
    if (!extra) return csp;
    return csp.split(';').map(d => d.trim()).map(d => d.startsWith('connect-src ') ? `${d} ${extra}` : d).join('; ');
}

// Test sunucusunun HTML yanıtına ekleyeceği başlıklar.
function testHeaders({ emu }) {
    const h = hostingHeaders();
    h['Content-Security-Policy'] = withConnectExtra(h['Content-Security-Policy'], emu ? EMULATOR_ORIGINS : '') + `; report-uri ${REPORT_PATH}`;
    return h;
}

// İhlal toplayıcı: server handler'ın başında çağrılır; rapor isteğiyse true döner (yanıt verilmiş olur).
function createCollector() {
    const violations = [];
    function handle(req, res) {
        if (req.method !== 'POST' || !req.url.startsWith(REPORT_PATH)) return false;
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            try {
                const r = JSON.parse(body)['csp-report'] || {};
                violations.push({ directive: r['violated-directive'] || r['effective-directive'], blocked: r['blocked-uri'], page: (r['document-uri'] || '').replace(/^https?:\/\/[^/]+/, ''), sample: r['script-sample'] || '', source: r['source-file'] ? `${String(r['source-file']).replace(/^https?:\/\/[^/]+/, '')}:${r['line-number'] || ''}` : '' });
            } catch (e) {
                violations.push({ parseError: e.message });
            }
            res.writeHead(204); res.end();
        });
        return true;
    }
    function summary() {
        const byKey = {};
        violations.forEach(v => { const k = `${v.directive} ← ${v.blocked}`; byKey[k] = (byKey[k] || 0) + 1; });
        return { count: violations.length, distinct: byKey, samples: violations.slice(0, 10) };
    }
    return { handle, summary, violations };
}

// nginx'in güvenlik başlıkları şablonu firebase.json ile aynı mı (CSP_CONNECT_EXTRA boşken)?
function checkNginxCsp() {
    const file = path.join(ROOT, 'nginx', 'templates', 'security-headers.inc.template');
    const tpl = fs.readFileSync(file, 'utf8');
    const norm = s => s.replace(/\s+/g, ' ').replace(/\s*;\s*/g, '; ').trim().replace(/;$/, '');
    const m = tpl.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"/);
    const nginxCsp = m ? norm(m[1].replace(/\s*\$\{CSP_CONNECT_EXTRA\}/, '')) : null;
    const want = norm(productionCsp());
    const others = Object.entries(hostingHeaders()).filter(([k]) => k !== 'Content-Security-Policy')
        .map(([k, v]) => ({ k, ok: new RegExp(`add_header\\s+${k}\\s+"${v.replace(/[()]/g, '\\$&')}"`).test(tpl) }));
    return { cspEqual: nginxCsp === want, otherHeadersEqual: others.every(o => o.ok), mismatched: others.filter(o => !o.ok).map(o => o.k), nginxCsp, firebaseCsp: want };
}

module.exports = { testHeaders, createCollector, checkNginxCsp, productionCsp, REPORT_PATH };
