// [WHY]: Faz 4 · J5 (SEC-03) — nginx yapılandırması yalnız `nginx -t` ile değil, çalışan konteynerde doğrulanmalı: engeller
//        regex sırası yüzünden aşılıyordu, başlıklar location'larda düşüyordu, JS/CSS bir yıl önbellekte kalıyordu.
// [HOW]: Çalışan bir konteynere (varsayılan http://localhost:8088) HTTP denetimleri + iki sayfanın tarayıcıda açılışı (CSP
//        ihlali, pageerror, "Veri Çekildi"). Adres localhost olduğu için uygulama inventory_demo köküne bağlanır.
// Usage: node scratch/docker-check.js [baseUrl] [--emu]   (--emu: konteyner CSP_CONNECT_EXTRA ile, emülatör açık)
const fs = require('fs');
const puppeteer = require('puppeteer');
const CSP = require('./csp');

const ARGS = process.argv.slice(2);
const BASE = (ARGS.find(a => !a.startsWith('--')) || 'http://localhost:8088').replace(/\/$/, '');
const EMU = ARGS.includes('--emu');
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/\s*;\s*/g, '; ').trim();

async function http() {
    const out = { headers: {}, blocked: {}, cache: {}, misc: {} };
    const idx = await fetch(`${BASE}/index.html`);
    const h = Object.fromEntries(idx.headers);
    const want = CSP.testHeaders({ emu: EMU });
    const wantCsp = norm(want['Content-Security-Policy'].replace(/; report-uri .*$/, ''));
    out.headers = {
        status: idx.status,
        cspEqualsFirebaseJson: norm(h['content-security-policy']) === wantCsp,
        others: ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy'].every(k => h[k.toLowerCase()] === want[k]),
        noXssProtection: !('x-xss-protection' in h),
        hstsOnHttp: 'strict-transport-security' in h,
        server: h.server,
    };
    // Engeller: hiçbiri 200 dönmemeli (imajda yoklar; nginx kuralı ikinci hat)
    const paths = ['/firebase.json', '/package.json', '/firestore.rules', '/.git/config', '/.firebaserc', '/backup/x.js', '/scratch/flow-tests.js',
        '/tests/rules/rules.test.mjs', '/audits/README.md', '/DOCKER_GUIDE.md', '/nginx/nginx.conf', '/Dockerfile', '/docker-compose.yml',
        '/plan.json', '/node_modules/x.js', '/Mimari%20ve%20Geli%C5%9Ftirmeler/x.md', '/yok-boyle-bir-yol'];
    for (const p of paths) out.blocked[p] = (await fetch(BASE + p)).status;
    const nf = await fetch(`${BASE}/yok-boyle-bir-yol`);
    out.misc.notFoundPageServed = (await nf.text()).includes('<html') && !!nf.headers.get('content-security-policy');
    // Önbellek: hash'siz JS/CSS → no-cache + ETag → koşullu istekte 304
    for (const p of ['/src/services/firebase-handler.js', '/style.css', '/index.html']) {
        const r = await fetch(BASE + p);
        const etag = r.headers.get('etag');
        const again = etag ? await fetch(BASE + p, { headers: { 'If-None-Match': etag } }) : null;
        out.cache[p] = { status: r.status, type: r.headers.get('content-type'), cacheControl: r.headers.get('cache-control'), etag: !!etag, revalidate304: again && again.status, csp: !!r.headers.get('content-security-policy') };
    }
    return out;
}

async function browser() {
    const b = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const res = {};
    try {
        for (const name of ['index.html', 'admin.html']) {
            const ctx = await b.createBrowserContext(), p = await ctx.newPage();
            const errs = [], logs = [];
            p.on('pageerror', e => errs.push(e.message));
            p.on('console', m => logs.push(m.text()));
            await p.evaluateOnNewDocument(() => {
                window.__csp = [];
                document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ← ${e.blockedURI}`));
                if (location.pathname.endsWith('admin.html')) localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 }));
            });
            await p.goto(`${BASE}/${name}${EMU ? '?emu=1' : ''}`, { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 9000));
            res[name] = await p.evaluate(() => ({ root: window.COLLECTION_ROOT, emulator: !!(window.AppEnv && window.AppEnv.EMULATOR), csp: window.__csp }));
            res[name].pageErrors = errs;
            res[name].veriCekildi = logs.filter(l => l.includes('Veri Çekildi')).length;
            res[name].sriOrBlockedErrors = logs.filter(l => /integrity|Refused to/i.test(l)).slice(0, 5);
            await ctx.close();
        }
    } finally { await b.close(); }
    return res;
}

(async () => {
    const out = { base: BASE, emu: EMU, http: await http(), browser: await browser() };
    console.log(JSON.stringify(out, null, 1));
    const bad = Object.values(out.http.blocked).some(s => s === 200) || !out.http.headers.cspEqualsFirebaseJson || !out.http.headers.others
        || Object.values(out.browser).some(r => r.csp.length || r.pageErrors.length || r.root !== 'inventory_demo' || r.emulator !== EMU);
    console.log(bad ? '✖ docker-check: sorun var' : '✔ docker-check: tümü geçti');
    process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
