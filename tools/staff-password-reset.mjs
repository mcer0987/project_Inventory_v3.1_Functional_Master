#!/usr/bin/env node
/**
 * tools/staff-password-reset.mjs — v3.8 · VP-3 · Spark Planı Çevrimdışı Personel Parola Sıfırlama Aracı.
 *
 * [WHY]: Firebase Spark planında (Cloud Functions / tarayıcı Admin SDK olmadan) mevcut kodunu tamamen unutmuş
 *        bir personelin Firebase Auth parolasını UID'sini BOZMADAN (ownerUid, EBYS, zimmet ve B3 geçmişi korunarak)
 *        güncellemek için güvenli yerel yönetici aracı gerekir.
 * [HOW]: - Harici npm bağımlılığı yoktur; yalnız Node.js yerleşik modülleri (node:crypto, node:fs, node:vm, fetch) kullanılır.
 *        - Parola/kod ASLA CLI argümanından (process.argv) kabul edilmez; yalnız maskeli etkileşimli stdin üzerinden okunur.
 *        - Düz metin parola/kod hiçbir koşulda stdout, stderr veya hata mesajlarına yazılmaz.
 *        - Emülatör (--emulator 127.0.0.1:9099 --project demo-...) veya canlı hizmet hesabı (--service-account ./key.json)
 *          üzerinden Google Identity Toolkit REST API (accounts:lookup + accounts:update) ile mevcut UID korunarak güncellenir.
 *
 * Kullanım:
 *   Canlı:    node tools/staff-password-reset.mjs --pri ayse.yilmaz --service-account ./service-account.json
 *   Emülatör: node tools/staff-password-reset.mjs --pri ayse.yilmaz --emulator 127.0.0.1:9099 --project demo-rules-test
 */
import { createSign, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const STAFF_DOMAIN = 'staff.medipol.local';
const PASSWORD_PAD = 'Mdp!';

// Saf çekirdek kuralları (PRI normalizasyonu + zayıf kod reddi) uygulama kodundan tek kaynak olarak yüklenir.
function loadLifecycleCore() {
    const win = { AppModules: {}, crypto: webcrypto };
    const ctx = vm.createContext({ window: win, crypto: webcrypto, Uint32Array });
    const src = readFileSync(new URL('../src/utils/staff-lifecycle.js', import.meta.url), 'utf8');
    vm.runInContext(src, ctx, { filename: 'staff-lifecycle.js' });
    return win.AppModules.StaffLifecycle;
}

const SL = loadLifecycleCore();

const FORBIDDEN_FLAGS = new Set(['--password', '-p', '--code', '-c', '--pin', '--pass', '--secret']);

// [WHY]: Komut satırı geçmişinde (bash/PowerShell history, ps çıktısı) parola kalmaması için CLI parola bayrakları reddedilir.
// [HOW]: Yasaklı bayrak saptanırsa hemen çıkış kodu 1 ile reddeder.
function parseArgs(argv) {
    const out = { pri: '', emulator: '', project: '', serviceAccount: process.env.GOOGLE_APPLICATION_CREDENTIALS || '', help: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const flagName = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
        if (FORBIDDEN_FLAGS.has(flagName)) {
            throw new Error('GÜVENLİK REDDİ: Giriş kodu veya parola komut satırı argümanı olarak verilemez. Kodu yalnız maskeli stdin isteminden girin.');
        }
        if (arg === '--help' || arg === '-h') { out.help = true; continue; }
        if (arg === '--pri' && argv[i + 1]) { out.pri = argv[++i]; continue; }
        if (arg.startsWith('--pri=')) { out.pri = arg.slice(6); continue; }
        if (arg === '--emulator' && argv[i + 1]) { out.emulator = argv[++i]; continue; }
        if (arg.startsWith('--emulator=')) { out.emulator = arg.slice(11); continue; }
        if (arg === '--project' && argv[i + 1]) { out.project = argv[++i]; continue; }
        if (arg.startsWith('--project=')) { out.project = arg.slice(10); continue; }
        if (arg === '--service-account' && argv[i + 1]) { out.serviceAccount = argv[++i]; continue; }
        if (arg.startsWith('--service-account=')) { out.serviceAccount = arg.slice(18); continue; }
        throw new Error(`Bilinmeyen argüman: ${flagName}`);
    }
    return out;
}

// [WHY]: Terminalde girilen geçici kodun ekranda açık görünmemesi gerekir.
// [HOW]: TTY raw mode ile her karakteri '*' olarak maskeler; pipe (non-TTY) girdisinde satır bazlı okur ve echo yapmaz.
function readMaskedLine(promptText) {
    return new Promise((resolve, reject) => {
        if (!process.stdin.isTTY) {
            let buf = '';
            process.stdin.setEncoding('utf8');
            const onData = chunk => {
                buf += chunk;
                const nl = buf.indexOf('\n');
                if (nl !== -1) {
                    cleanup();
                    resolve(buf.slice(0, nl).replace(/\r$/, ''));
                }
            };
            const onEnd = () => { cleanup(); resolve(buf.replace(/\r?\n$/, '')); };
            const onErr = err => { cleanup(); reject(err); };
            const cleanup = () => {
                process.stdin.removeListener('data', onData);
                process.stdin.removeListener('end', onEnd);
                process.stdin.removeListener('error', onErr);
            };
            process.stdin.on('data', onData);
            process.stdin.on('end', onEnd);
            process.stdin.on('error', onErr);
            process.stdin.resume();
            return;
        }

        process.stderr.write(promptText);
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        let value = '';
        const finish = (err, result) => {
            stdin.removeListener('data', onData);
            try { stdin.setRawMode(!!wasRaw); } catch (_) { /* yoksay */ }
            stdin.pause();
            process.stderr.write('\n');
            if (err) reject(err); else resolve(result);
        };
        const onData = ch => {
            if (ch === '\u0003') { finish(new Error('İşlem kullanıcı tarafından iptal edildi.')); return; }
            if (ch === '\r' || ch === '\n') { finish(null, value); return; }
            if (ch === '\u007f' || ch === '\b') {
                if (value.length > 0) {
                    value = value.slice(0, -1);
                    process.stderr.write('\b \b');
                }
                return;
            }
            if (ch >= ' ') {
                value += ch;
                process.stderr.write('*');
            }
        };
        stdin.on('data', onData);
    });
}

function base64Url(input) {
    return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// [WHY]: Harici firebase-admin bağımlılığı eklemeden hizmet hesabı JSON anahtarıyla OAuth2 erişim jetonu alınır.
// [HOW]: RS256 JWT imzalanır ve Google OAuth2 token ucundan kısa ömürlü identitytoolkit jetonu istenir.
async function getServiceAccountAccessToken(sa) {
    if (!sa || !sa.client_email || !sa.private_key || !sa.project_id) {
        throw new Error('Geçersiz hizmet hesabı JSON dosyası (client_email, private_key, project_id gerekli).');
    }
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64Url(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/identitytoolkit',
        aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 300,
    }));
    const unsigned = `${header}.${claim}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const sig = signer.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const assertion = `${unsigned}.${sig}`;

    const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }),
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`OAuth2 jetonu alınamadı (HTTP ${res.status}).`);
    const body = await res.json();
    if (!body.access_token) throw new Error('OAuth2 yanıtında access_token bulunamadı.');
    return body.access_token;
}

async function identityToolkitCall({ baseUrl, projectId, accessToken, endpoint, payload }) {
    const url = `${baseUrl}/v1/projects/${encodeURIComponent(projectId)}/${endpoint}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        throw new Error(`Identity Toolkit isteği başarısız (${endpoint}, HTTP ${res.status}).`);
    }
    return res.json();
}

function printUsage() {
    process.stdout.write(
        'Kullanım:\n' +
        '  Canlı:    node tools/staff-password-reset.mjs --pri <ad.soyad> --service-account <anahtar.json>\n' +
        '  Emülatör: node tools/staff-password-reset.mjs --pri <ad.soyad> --emulator 127.0.0.1:9099 --project <demo-proje>\n\n' +
        'Güvenlik: Parola/kod CLI argümanından alınmaz; yalnız maskeli stdin isteminden okunur.\n'
    );
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { printUsage(); return; }

    const pri = SL.normalizePri(args.pri);
    if (!SL.isValidPriId(pri)) {
        throw new Error('Geçerli bir --pri parametresi gerekli (ör. --pri ayse.yilmaz).');
    }

    let baseUrl = '';
    let projectId = '';
    let accessToken = '';

    if (args.emulator) {
        if (!/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(args.emulator)) {
            throw new Error('--emulator yalnız 127.0.0.1:<port> biçiminde olabilir.');
        }
        projectId = args.project || 'demo-rules-test';
        baseUrl = `http://${args.emulator}/identitytoolkit.googleapis.com`;
        accessToken = 'owner';
    } else {
        if (!args.serviceAccount) {
            throw new Error('Canlı ortam için --service-account <dosya.json> veya GOOGLE_APPLICATION_CREDENTIALS gerekli.');
        }
        const sa = JSON.parse(readFileSync(args.serviceAccount, 'utf8'));
        projectId = args.project || sa.project_id;
        baseUrl = 'https://identitytoolkit.googleapis.com';
        accessToken = await getServiceAccountAccessToken(sa);
    }

    let code = '';
    let confirm = '';
    try {
        code = (await readMaskedLine(`"${pri}" için yeni geçici/giriş kodu (gizli): `)).trim();
        const check = SL.validateNewCode(code);
        if (!check.ok) throw new Error(check.message);

        if (process.stdin.isTTY) {
            confirm = (await readMaskedLine('Yeni kodu doğrulamak için tekrar girin (gizli): ')).trim();
            if (confirm !== code) throw new Error('Girilen kodlar eşleşmiyor; işlem iptal edildi.');
        }

        const email = `${pri}@${STAFF_DOMAIN}`;
        const lookup = await identityToolkitCall({
            baseUrl, projectId, accessToken,
            endpoint: 'accounts:lookup',
            payload: { email: [email] },
        });
        const user = Array.isArray(lookup.users) && lookup.users[0];
        if (!user || !user.localId) {
            throw new Error(`Firebase Auth üzerinde "${email}" hesabı bulunamadı.`);
        }

        await identityToolkitCall({
            baseUrl, projectId, accessToken,
            endpoint: 'accounts:update',
            payload: { localId: user.localId, password: code + PASSWORD_PAD },
        });

        process.stdout.write(`✔ Parola UID korunarak güncellendi. PRI: ${pri} · UID: ${user.localId} · Proje: ${projectId}\n`);
    } finally {
        code = '';
        confirm = '';
    }
}

main().catch(err => {
    process.stderr.write(`✖ ${err && err.message ? err.message : 'Bilinmeyen hata'}\n`);
    process.exit(1);
});
