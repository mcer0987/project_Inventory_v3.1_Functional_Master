// [WHY]: Faz 4 · J2 (4.3) — XSS regresyon kapısı. Kayıt verisi bugüne kadar onlarca yerde innerHTML'e ham basıldı (SEC-01,
//        EBYS-03, ADM-01); her yeni ekran aynı hatayı yeniden yapabiliyordu ve bunu yakalayan bir kontrol yoktu.
// [HOW]: Aktif JS dosyaları ve HTML'deki inline script'ler acorn ile ayrıştırılır. HTML içeren her şablon dizgesindeki ve
//        innerHTML / outerHTML / insertAdjacentHTML / document.write'a giden her birleştirmedeki dinamik ifade sınıflandırılır:
//        - güvenli: escapeHtml/esc/jsArg/... çağrısı, sabit, sayısal ifade, `.length`, kendi şablonu ayrıca denetlenen
//          birleştirilmiş HTML (…Html, rows, map(→şablon).join), koşullu/mantıksal ifadede tüm dallar güvenliyse;
//        - izinli: ifadenin içinde /* xss-ok: <neden> */ yorumu (gözden geçirilmiş istisna — nedeni zorunlu);
//        - izinsiz: geri kalan her şey → çıkış kodu 1.
// Kullanım: node scratch/xss-lint.js [--json <dosya>] [--verbose]
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const ROOT = path.resolve(__dirname, '..');
const EXCLUDE = /(^|[\\/])(node_modules|backup|backup_txt|scratch|functions|tests|Mimari ve Geliştirmeler|audits|\.[^\\/]+)([\\/]|$)/;
const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes('--json') ? ARGS[ARGS.indexOf('--json') + 1] : null;
const VERBOSE = ARGS.includes('--verbose');

const ESCAPE_FNS = new Set(['escapeHtml', 'esc', '_esc', '_escapeHtml', 'jsArg', 'encodeURIComponent', 'Number', 'parseInt', 'parseFloat', 'toFixed', 'Math', 'max', 'min', 'round', 'floor', 'ceil', 'abs']);
// Kendi şablonu ayrıca denetlenen HTML üreticileri (çıktıları birleştirilmiş HTML'dir).
const HTML_BUILDER_NAME = /(Html|HTML|html|Badge|badge|Row|Rows|rows|Cell|cells|Options|options|Cards|cards|Icon|icon|Button|button|Btn|btn|Markup|markup|Tpl|tpl|Template|template|Chip|chip|Pill|pill|Tag|tags)$/;
const HTML_VAR_NAME = /^(html|rows|rowsHtml|cells|options|optionsHtml|cards|items?Html|body|bodyHtml|content|markup|badge|badges|icon|icons|buttons?|btns?|actions?|actionsHtml|chips|pills|list|listHtml|tpl|header|footer|section|inner|out|str|result|res|stepsHtml)$|Html$|HTML$/;
const NUMERIC_NAME = /^(i|j|k|n|idx|index|count|total|len|page|pageNo|pct|percent|ratio|width|height|size|step|stepIndex|order|num|qty|level|delay|ms|sec|seconds|minutes|hours|days|offset|top|left|right|bottom|x|y|z|w|h|dx|dy|colspan|rowspan)$/;
const NUMERIC_PROP = /^(length|size|count|total|adet|qty|miktar|stok|limit|kritikLimit|minStock|toFixed|percent|pct|index|order|currentStep|width|height|value)$/;

function listFiles() {
    const out = [];
    (function rec(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            const rel = path.relative(ROOT, p);
            if (EXCLUDE.test(rel)) continue;
            if (e.isDirectory()) rec(p);
            else if (/\.(js|html)$/.test(e.name)) out.push(p);
        }
    })(ROOT);
    return out;
}

// HTML'deki inline <script> blokları (src'siz); satır numaraları dosyaya göre korunur.
function inlineScripts(html) {
    const blocks = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
        if (/\bsrc\s*=/.test(m[1])) continue;
        const startOffset = m.index + m[0].indexOf('>') + 1;
        const line = html.slice(0, startOffset).split('\n').length;
        blocks.push({ code: m[2], line, module: /type\s*=\s*["']module["']/.test(m[1]) });
    }
    return blocks;
}

function parse(code, preferModule) {
    const opts = { ecmaVersion: 'latest', locations: true, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };
    const comments = [];
    for (const sourceType of preferModule ? ['module', 'script'] : ['script', 'module']) {
        comments.length = 0;
        try { return { ast: acorn.parse(code, { ...opts, sourceType, onComment: comments }), comments }; } catch (e) { /* diğerini dene */ }
    }
    return null;
}

const looksLikeHtml = s => /<[a-zA-Z!\/]/.test(s);
const calleeName = c => c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : null;

function returnedExpr(fn) {
    if (!fn || !/Function/.test(fn.type)) return null;
    if (fn.body.type !== 'BlockStatement') return fn.body;
    const ret = fn.body.body.find(s => s.type === 'ReturnStatement');
    return ret ? ret.argument : null;
}

// Metin dönüştüren metotlar: sonuç kaynağı kadar güvenlidir (x.trim() ← x).
const PASS_THROUGH = new Set(['trim', 'toUpperCase', 'toLowerCase', 'toLocaleUpperCase', 'toLocaleLowerCase', 'charAt', 'slice', 'substring', 'substr', 'padStart', 'padEnd', 'toString', 'String']);

// Kapsam duyarlı basit veri akışı: bir ad, ifadeyi saran EN YAKIN kapsamdaki tanımına göre çözülür; o tanımın ilk değeri
// ve dosyadaki tüm `ad = …` atamaları güvenliyse ad güvenlidir. Parametreler, döngü değişkenleri ve tanımı bulunamayan
// (global) adlar güvensiz kalır (muhafazakâr).
const SCOPE_TYPES = /^(Program|BlockStatement|FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ForStatement|ForOfStatement|ForInStatement|SwitchStatement|CatchClause)$/;
const FN_SCOPE = /^(Program|FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/;
let SCOPES = new Map(), ASSIGNS = new Map(), CURRENT_ANC = [], CUR_DEF_ANC = [];
const _resolving = new Set();
function collectDefs(ast) {
    SCOPES = new Map(); ASSIGNS = new Map();
    const add = (scope, name, init) => {
        if (!scope) return;
        if (!SCOPES.has(scope)) SCOPES.set(scope, new Map());
        const m = SCOPES.get(scope);
        if (!m.has(name)) m.set(name, []);
        m.get(name).push({ init, anc: CUR_DEF_ANC });
    };
    const nearest = (anc, re) => { for (let i = anc.length - 2; i >= 0; i--) if (re.test(anc[i].type)) return anc[i]; return null; };
    const PARAM = { type: '__param' };
    walk.fullAncestor(ast, (n, _s, anc) => {
        CUR_DEF_ANC = anc.slice(0, -1);
        if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') {
            const decl = anc[anc.length - 2];
            const loop = anc[anc.length - 3];
            if (loop && /^For(Of|In)Statement$/.test(loop.type) && loop.left === decl) { add(loop, n.id.name, { type: '__loop' }); return; }
            add(nearest(anc, decl && decl.kind === 'var' ? FN_SCOPE : SCOPE_TYPES), n.id.name, n.init);
        } else if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier') {
            const name = n.left.name;
            if (!ASSIGNS.has(name)) ASSIGNS.set(name, []);
            ASSIGNS.get(name).push({ init: n.operator === '=' ? n.right : { type: 'BinaryExpression', operator: '+', left: { type: 'Literal' }, right: n.right }, anc: anc.slice(0, -1) });
        } else if (/Function/.test(n.type)) {
            n.params.forEach(p => {
                const id = p.type === 'AssignmentPattern' ? p.left : p;
                if (id.type === 'Identifier') add(n, id.name, PARAM);
            });
        } else if (n.type === 'CatchClause' && n.param && n.param.type === 'Identifier') add(n, n.param.name, PARAM);
    });
}
function identifierSafe(name) {
    if (_resolving.has(name)) return false;
    for (let i = CURRENT_ANC.length - 1; i >= 0; i--) {
        const defs = SCOPES.get(CURRENT_ANC[i])?.get(name);
        if (!defs) continue;
        const all = defs.concat(ASSIGNS.get(name) || []);
        _resolving.add(name);
        const saved = CURRENT_ANC;
        try {
            return all.every(d => {
                if (!d.init || d.init.type.startsWith('__')) return false;
                CURRENT_ANC = d.anc;   // tanım, bulunduğu kapsamda değerlendirilir
                return classify(d.init) === true;
            });
        } finally { CURRENT_ANC = saved; _resolving.delete(name); }
    }
    return false;
}

// true = güvenli; aksi halde nedeni döner.
function classify(e) {
    if (!e) return true;
    switch (e.type) {
        case 'ChainExpression': return classify(e.expression);
        case 'AwaitExpression': return classify(e.argument);
        case 'Literal': return true;
        case 'TemplateLiteral':
            if (looksLikeHtml(e.quasis.map(q => q.value.raw).join(''))) return true;   // kendisi ayrıca denetlenir
            for (const x of e.expressions) { const r = classify(x); if (r !== true) return r; }
            return true;
        case 'ConditionalExpression': { const a = classify(e.consequent); if (a !== true) return a; return classify(e.alternate); }
        case 'LogicalExpression': { const a = classify(e.left); if (a !== true) return a; return classify(e.right); }
        case 'BinaryExpression':
            if (e.operator !== '+') return true;   // aritmetik / karşılaştırma
            { const a = classify(e.left); if (a !== true) return a; return classify(e.right); }
        case 'UnaryExpression': case 'UpdateExpression': return true;
        case 'ArrayExpression': return true;
        case 'Identifier':
            if (NUMERIC_NAME.test(e.name) || HTML_VAR_NAME.test(e.name) || /^[A-Z0-9_]+$/.test(e.name)) return true;
            if (identifierSafe(e.name)) return true;
            return `değişken "${e.name}"`;
        case 'MemberExpression': {
            const prop = !e.computed && e.property.name;
            if (prop && NUMERIC_PROP.test(prop)) return true;
            if (prop && (HTML_VAR_NAME.test(prop) || HTML_BUILDER_NAME.test(prop))) return true;
            const obj = e.object;
            if (obj.type === 'Identifier' && /^[A-Z][A-Z0-9_]+$/.test(obj.name)) return true;   // SABIT.alan
            return `alan "${prop || '[…]'}"`;
        }
        case 'CallExpression': {
            const name = calleeName(e.callee);
            if (name && ESCAPE_FNS.has(name)) return true;
            if (name && PASS_THROUGH.has(name)) return e.callee.type === 'MemberExpression' ? classify(e.callee.object) : classify(e.arguments[0]);
            if (name === 'join' && e.callee.type === 'MemberExpression') {
                const target = e.callee.object;
                if (target.type === 'CallExpression' && calleeName(target.callee) === 'map') return classify(returnedExpr(target.arguments[0]));
                return classify(target);
            }
            if (name && HTML_BUILDER_NAME.test(name)) return true;
            if (name && /^(toLocaleString|toLocaleDateString|toLocaleTimeString|toISOString|getTime|getFullYear)$/.test(name)
                && e.callee.object && e.callee.object.type === 'NewExpression') return true;   // new Date().toLocale…
            return `çağrı "${name || '…'}()"`;
        }
        default: return `ifade ${e.type}`;
    }
}

function lintCode(code, file, lineOffset, preferModule, acc) {
    const parsed = parse(code, preferModule);
    if (!parsed) { acc.parseErrors.push(file); return; }
    const { ast, comments } = parsed;
    collectDefs(ast);
    // İstisna yorumu ifadenin kapsamında olmalı: şablonda `${ … }` aralığı, diğerlerinde ifadenin kendisi.
    const okComment = (span) => comments.some(c => c.start >= span.start && c.end <= span.end && /xss-ok:\s*\S/.test(c.value));
    // Şablon dışı sink'lerde (innerHTML = x) gerekçe ifadeyle aynı satırın sonunda da olabilir.
    const lineSpan = (node) => { const eol = code.indexOf('\n', node.end); return { start: node.start, end: eol === -1 ? code.length : eol }; };
    const report = (node, kind, span = lineSpan(node)) => {
        const r = classify(node);
        acc.stats.expressions++;
        if (r === true) { acc.stats.safe++; return; }
        if (okComment(span)) { acc.stats.allowed++; acc.allowed.push({ file, line: node.loc.start.line + lineOffset - 1, expr: code.slice(node.start, node.end).slice(0, 120) }); return; }
        acc.violations.push({ file, line: node.loc.start.line + lineOffset - 1, kind, reason: r, expr: code.slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 140) });
    };
    const concatParts = (e) => (e.type === 'BinaryExpression' && e.operator === '+') ? [...concatParts(e.left), ...concatParts(e.right)] : [e];
    const checkSinkValue = (value, kind) => {
        if (!value) return;
        acc.stats.sinks++;
        if (value.type === 'TemplateLiteral') {
            // HTML içeren şablon TemplateLiteral ziyaretinde denetlenir; etiketsiz şablon da sink'e gidiyorsa burada.
            if (!looksLikeHtml(value.quasis.map(q => q.value.raw).join('')))
                value.expressions.forEach((x, i) => report(x, kind + ' (şablon)', { start: value.quasis[i].end, end: value.quasis[i + 1].start }));
            return;
        }
        const parts = concatParts(value);
        if (parts.length > 1) { parts.filter(p => p.type !== 'Literal' && p.type !== 'TemplateLiteral').forEach(p => report(p, kind + ' (+)')); return; }
        if (value.type !== 'Literal') report(value, kind);
    };
    walk.fullAncestor(ast, (node, _s, anc) => {
        CURRENT_ANC = anc;
        if (node.type === 'TemplateLiteral') {
            const raw = node.quasis.map(q => q.value.raw).join('');
            if (!looksLikeHtml(raw)) return;
            acc.stats.htmlTemplates++;
            node.expressions.forEach((x, i) => report(x, 'şablon', { start: node.quasis[i].end, end: node.quasis[i + 1].start }));
        } else if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && !node.left.computed
            && ['innerHTML', 'outerHTML'].includes(node.left.property.name)) {
            checkSinkValue(node.right, node.left.property.name);
        } else if (node.type === 'CallExpression') {
            const name = calleeName(node.callee);
            if (name === 'insertAdjacentHTML') checkSinkValue(node.arguments[1], 'insertAdjacentHTML');
            else if ((name === 'write' || name === 'writeln') && node.callee.type === 'MemberExpression') checkSinkValue(node.arguments[0], 'document.write');
        }
    });
}

// Öz-test: kapı gerçekten yakalıyor mu? Her örnek beklenen izinsiz sayısıyla (denetçi için kanıt).
function selfTest() {
    const cases = [
        ['ham alan', 'el.innerHTML = `<td>${item.ürün}</td>`;', 1],
        ['kaçırılmış alan', 'el.innerHTML = `<td>${escapeHtml(item.ürün)}</td>`;', 0],
        ['birleştirme', "el.innerHTML = '<b>' + user.name + '</b>';", 1],
        ['etiketsiz şablon sink', 'el.innerHTML = `✅ ${message}`;', 1],
        ['insertAdjacentHTML', "el.insertAdjacentHTML('beforeend', row.not);", 1],
        ['document.write', 'w.document.write(`<p>${x.not}</p>`);', 1],
        ['onclick gömme', 'h = `<b onclick="f(\'${p.name}\')">x</b>`;', 1],
        ['jsArg', 'h = `<b onclick="f(${jsArg(p.name)})">x</b>`;', 0],
        ['map/join ham', 'h = `<p title="${list.map(p => p.name).join(", ")}"></p>`;', 1],
        ['map/join kaçışlı', 'h = `<p>${list.map(p => escapeHtml(p.name)).join(", ")}</p>`;', 0],
        ['parametre', 'function f(name) { return `<i>${name}</i>`; }', 1],
        ['güvenli yerel', 'function f(p) { const safe = escapeHtml(p.name); return `<i>${safe}</i>`; }', 0],
        ['yeniden atanmış yerel', 'function f(p) { let s = escapeHtml(p.a); s = p.b; return `<i>${s}</i>`; }', 1],
        ['sayı ve uzunluk', 'h = `<i>${items.length} / ${count}</i>`;', 0],
        ['gerekçeli istisna', 'h = `<i>${cls /* xss-ok: sabit sınıf */}</i>`;', 0],
        ['gerekçesiz yorum', 'h = `<i>${cls /* xss-ok: */}</i>`;', 1],
        ['koşullu dal', 'h = `<i>${ok ? escapeHtml(a.x) : a.y}</i>`;', 1],
    ];
    let failed = 0;
    for (const [name, code, expected] of cases) {
        const acc = { violations: [], allowed: [], parseErrors: [], stats: { files: 0, sinks: 0, htmlTemplates: 0, expressions: 0, safe: 0, allowed: 0 } };
        lintCode(code, 'self-test', 1, false, acc);
        const got = acc.violations.length + acc.parseErrors.length;
        const ok = got === expected;
        if (!ok) failed++;
        console.log(`  ${ok ? '✔' : '✖'} ${name}: beklenen ${expected}, bulunan ${got}`);
    }
    console.log(failed ? `xss-lint öz-testi: ${failed} başarısız` : `xss-lint öz-testi: ${cases.length}/${cases.length} ✔`);
    process.exit(failed ? 1 : 0);
}

function main() {
    if (ARGS.includes('--self-test')) return selfTest();
    const acc = { violations: [], allowed: [], parseErrors: [], stats: { files: 0, sinks: 0, htmlTemplates: 0, expressions: 0, safe: 0, allowed: 0 } };
    for (const abs of listFiles()) {
        const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
        const src = fs.readFileSync(abs, 'utf8');
        acc.stats.files++;
        if (rel.endsWith('.html')) inlineScripts(src).forEach(b => lintCode(b.code, rel, b.line, b.module, acc));
        else lintCode(src, rel, 1, /^\s*(import|export)\s/m.test(src), acc);
    }
    const byFile = {};
    acc.violations.forEach(v => { byFile[v.file] = (byFile[v.file] || 0) + 1; });
    const s = acc.stats;
    console.log(`xss-lint · ${s.files} dosya · ${s.sinks} sink · ${s.htmlTemplates} HTML şablonu · ${s.expressions} dinamik ifade`);
    console.log(`  güvenli ${s.safe} · izinli (xss-ok) ${s.allowed} · İZİNSİZ ${acc.violations.length}${acc.parseErrors.length ? ' · ayrıştırılamayan: ' + acc.parseErrors.join(', ') : ''}`);
    Object.entries(byFile).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`  ${String(n).padStart(4)}  ${f}`));
    if (VERBOSE || acc.violations.length <= 60) acc.violations.forEach(v => console.log(`  ✖ ${v.file}:${v.line}  [${v.kind}] ${v.reason}  →  ${v.expr}`));
    if (JSON_OUT) {
        fs.mkdirSync(path.dirname(path.resolve(ROOT, JSON_OUT)), { recursive: true });
        fs.writeFileSync(path.resolve(ROOT, JSON_OUT), JSON.stringify({ generatedAt: new Date().toISOString(), stats: s, violations: acc.violations, allowed: acc.allowed, parseErrors: acc.parseErrors }, null, 2) + '\n');
    }
    process.exit(acc.violations.length || acc.parseErrors.length ? 1 : 0);
}

main();
