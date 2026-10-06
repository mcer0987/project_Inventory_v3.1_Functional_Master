// [WHY]: Faz 0.4 smoke-test baseline. Every phase compares its console-error and duplicate-load counts against this.
// [HOW]: Serves the repo on 127.0.0.1 (→ inventory_demo), opens index/admin read-only, counts errors and load logs, saves JSON + screenshots.
// Usage: node scratch/smoke-test.js [label] [--emu]
//        --emu (Faz 4 · J0): uygulama yerel emülatöre bağlanır (?emu=1); önce `npm run emu` + `npm run emu:seed`.
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const CSP = require('./csp');   // Faz 4 · J5: firebase.json güvenlik başlıkları + CSP ihlal toplayıcı

const ROOT = path.resolve(__dirname, '..');
const PORT = 5599;
const WAIT_MS = 9000;
const ARGS = process.argv.slice(2);
const EMU = ARGS.includes('--emu');
const LABEL = (ARGS.find(a => !a.startsWith('--')) || 'run') + (EMU ? '_emu' : '');
const PAGES = ['index.html', 'admin.html'];

const csp = CSP.createCollector();
const SEC_HEADERS = CSP.testHeaders({ emu: EMU });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function startServer() {
    const server = http.createServer((req, res) => {
        if (csp.handle(req, res)) return;
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404); return res.end('not found');
        }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', ...(ext === '.html' ? SEC_HEADERS : {}) });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(PORT, '127.0.0.1', () => r(server)));
}

function findChrome() {
    return [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].find(p => fs.existsSync(p));
}

async function probe(browser, pageName, outDir) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    // admin.html's gate is a localStorage expiry flag; seeding it opens the UI while Firebase stays anonymous (read-only).
    if (pageName === 'admin.html') {
        await page.evaluateOnNewDocument(() => {
            if (location.pathname.endsWith('admin.html')) localStorage.setItem('admin_auth', JSON.stringify({ expiry: Date.now() + 600000 }));
        });
    }
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [], consoleErrors = [], logs = [], scriptRequests = {};

    page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 300)));
    page.on('console', m => {
        const t = m.text();
        if (m.type() === 'error') consoleErrors.push(t.slice(0, 300));
        logs.push(t);
    });
    const failedRequests = [], externalOrigins = {};
    page.on('request', r => { const o = new URL(r.url()).origin; if (o !== `http://127.0.0.1:${PORT}`) externalOrigins[o] = (externalOrigins[o] || 0) + 1; });
    page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().replace(`http://127.0.0.1:${PORT}`, '')}`); });
    page.on('request', r => {
        const u = new URL(r.url());
        if (u.origin === `http://127.0.0.1:${PORT}` && u.pathname.endsWith('.js')) {
            const key = u.pathname + u.search;
            scriptRequests[key] = (scriptRequests[key] || 0) + 1;
        }
    });

    await page.goto(`http://127.0.0.1:${PORT}/${pageName}${EMU ? '?emu=1' : ''}`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, WAIT_MS));

    const env = await page.evaluate(() => window.COLLECTION_ROOT || (window.AppEnv && window.AppEnv.COLLECTION_ROOT) || null).catch(() => null);
    if (env && env !== 'inventory_demo') throw new Error(`ABORT: ${pageName} resolved COLLECTION_ROOT=${env}, expected inventory_demo`);
    const emulator = await page.evaluate(() => !!(window.AppEnv && window.AppEnv.EMULATOR)).catch(() => null);
    if (EMU && !emulator) throw new Error(`ABORT: ${pageName} emülatöre bağlanmadı`);

    const count = re => logs.filter(l => re.test(l)).length;
    const loadedLogs = {};
    logs.filter(l => /yüklendi|loaded/i.test(l)).forEach(l => { const k = l.slice(0, 90); loadedLogs[k] = (loadedLogs[k] || 0) + 1; });

    // A module fetched under two URLs (with/without ?v=) executes twice.
    const byPath = {};
    Object.keys(scriptRequests).forEach(k => { const p = k.split('?')[0]; (byPath[p] = byPath[p] || new Set()).add(k); });
    const dualUrlModules = Object.entries(byPath).filter(([, s]) => s.size > 1).map(([p, s]) => ({ path: p, urls: [...s] }));

    const shot = path.join(outDir, pageName.replace('.html', '.png'));
    await page.screenshot({ path: shot });
    const finalUrl = page.url();
    await context.close();

    return {
        page: pageName,
        finalUrl: finalUrl.replace(`http://127.0.0.1:${PORT}/`, ''),
        collectionRoot: env,
        emulator,
        pageErrorCount: errors.length,
        consoleErrorCount: consoleErrors.length,
        veriCekildiCount: count(/Veri Çekildi/),
        duplicateLoadLogs: Object.fromEntries(Object.entries(loadedLogs).filter(([, n]) => n > 1)),
        dualUrlModules,
        failedRequests,
        externalOrigins,
        loadedLogs,
        pageErrors: errors,
        consoleErrors,
        screenshot: path.relative(ROOT, shot),
    };
}

(async () => {
    const chrome = findChrome();
    if (!chrome) throw new Error('Chrome/Edge not found');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = path.join(ROOT, 'scratch', 'baseline', `${stamp}_${LABEL}`);
    fs.mkdirSync(outDir, { recursive: true });

    if (EMU) await fetch('http://127.0.0.1:8080/').catch(() => { throw new Error('Emülatör çalışmıyor: önce npm run emu'); });
    const server = await startServer();
    const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
    try {
        const results = [];
        for (const p of PAGES) results.push(await probe(browser, p, outDir));
        // J5 · pozitif kontrol: CSP gerçekten uygulanıyor mu? İzinsiz bir adrese istek engellenmeli ve raporlanmalı.
        const appViolations = csp.violations.length;
        const ctl = await (await browser.createBrowserContext()).newPage();
        await ctl.goto(`http://127.0.0.1:${PORT}/404.html`, { waitUntil: 'domcontentloaded' });
        const ctlFetch = await ctl.evaluate(() => fetch('https://csp-control.invalid/x').then(() => 'ALLOWED', e => 'blocked: ' + e.name));
        await new Promise(r => setTimeout(r, 800));
        const enforced = csp.violations.slice(appViolations).some(v => String(v.blocked).includes('csp-control.invalid'));
        csp.violations.splice(appViolations);
        await ctl.browserContext().close();
        // Faz 4 · J2: XSS kapısı smoke raporunun parçası (izinsiz sink sayısı baseline'ı aşarsa tur kapanmaz).
        const lint = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'xss-lint.js'), '--json', path.join(outDir, 'xss-lint.json')], { encoding: 'utf8' });
        let xssLint = null;
        try { const j = JSON.parse(fs.readFileSync(path.join(outDir, 'xss-lint.json'), 'utf8')); xssLint = { violations: j.violations.length, allowed: j.stats.allowed, sinks: j.stats.sinks, expressions: j.stats.expressions, exit: lint.status }; } catch (e) { xssLint = { error: e.message, exit: lint.status }; }
        const cspReport = { ...csp.summary(), enforcedControl: { enforced, fetch: ctlFetch }, nginx: CSP.checkNginxCsp() };
        const report = { label: LABEL, timestamp: new Date().toISOString(), waitMs: WAIT_MS, xssLint, csp: cspReport, results };
        fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
        for (const r of results) {
            console.log(`\n=== ${r.page} → ${r.finalUrl} (root: ${r.collectionRoot}${r.emulator ? ' @ emulator' : ''}) ===`);
            console.log(`pageerror: ${r.pageErrorCount} | console.error: ${r.consoleErrorCount} | "Veri Çekildi": ${r.veriCekildiCount}`);
            console.log(`duplicate load logs: ${JSON.stringify(r.duplicateLoadLogs)}`);
            console.log(`dual-URL modules: ${r.dualUrlModules.map(m => m.path).join(', ') || 'none'}`);
            console.log(`failed requests: ${r.failedRequests.join(', ') || 'none'}`);
            console.log(`external origins: ${Object.keys(r.externalOrigins).join(' ') || 'none'}`);
        }
        console.log(`
CSP uygulanıyor (pozitif kontrol): ${enforced ? '✔' : '✖'} · CSP ihlali: ${cspReport.count}${cspReport.count ? ' ' + JSON.stringify(cspReport.distinct) : ''} · nginx = firebase.json: CSP ${cspReport.nginx.cspEqual ? '✔' : '✖'} · diğer başlıklar ${cspReport.nginx.otherHeadersEqual ? '✔' : '✖ ' + cspReport.nginx.mismatched.join(',')}`);
        console.log(`\nxss-lint: izinsiz ${xssLint.violations ?? '?'} · gerekçeli istisna ${xssLint.allowed ?? '?'} · ${xssLint.sinks ?? '?'} sink`);
        console.log(`Report: ${path.relative(ROOT, outDir)}`);
    } finally {
        await browser.close();
        server.close();
    }
})().catch(e => { console.error(e.message); process.exit(1); });
