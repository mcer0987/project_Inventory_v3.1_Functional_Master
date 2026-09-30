// [WHY]: Faz 4 · J0 (KJ-1) — Emülatör boş başlar; akış testleri demo verisine (ürünler, personel, birimler) dayanıyor.
//        Ayrıca admin oturumu isteyen akışlar ilk kez otomatik test edilebilsin diye emülatörde sahte bir admin hesabı gerekir.
// [HOW]: pull → gerçek inventory_demo'yu anonim oturumla SALT-OKUNUR çeker, scratch/emu-data/inventory_demo.json'a yazar
//        (git dışı). push → çalışan emülatöre (npm run emu) bu kopyayı kural atlamalı yazar ve Auth emülatöründe
//        EMU-ONLY admin hesabını açar. Canlı köke (lifeserver_master) hiçbir koşulda dokunmaz; gerçek projeye yazmaz.
// Kullanım: node scratch/emu-seed.mjs pull | push
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HANDLER = readFileSync(resolve(ROOT_DIR, 'src/services/firebase-handler.js'), 'utf8');
const OUT_DIR = resolve(ROOT_DIR, 'scratch/emu-data');
const OUT_FILE = resolve(OUT_DIR, 'inventory_demo.json');
const SOURCE_ROOT = 'inventory_demo';
const PROJECT_ID = 'medipol-inventory-v3';
const EMU = { host: '127.0.0.1', firestore: 8080, auth: 9099 };

// Yalnız emülatörde geçerli sahte admin (gerçek parola DEĞİLDİR). Giriş ekranına EMU_ADMIN_CODE yazılır;
// security.js başına "0" ekler. Aynı sabit scratch/flow-tests.js'te (EMU_ADMIN_CODE) kullanılır.
const EMU_ADMIN_EMAIL = 'admin@medipol.local';
const EMU_ADMIN_CODE = 'emu01';

function parseConfig() {
    const block = HANDLER.match(/const firebaseConfig = \{([\s\S]*?)\};/);
    if (!block) throw new Error('firebaseConfig bulunamadı');
    const cfg = {};
    for (const m of block[1].matchAll(/(\w+):\s*"([^"]*)"/g)) cfg[m[1]] = m[2];
    return cfg;
}

function parseCollections() {
    const m = HANDLER.match(/export const COLLECTIONS = [^[]*\[([^\]]+)\]/);
    if (!m) throw new Error('COLLECTIONS bulunamadı');
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).concat(['system_config', 'workflowTemplates']);
}

// Firestore Timestamp'leri JSON'da tip bilgisini kaybetmesin.
const encode = v => (v && typeof v.toMillis === 'function' && 'seconds' in v) ? { __ts: [v.seconds, v.nanoseconds] }
    : Array.isArray(v) ? v.map(encode)
    : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) : v;

async function pull() {
    const { initializeApp } = await import('firebase/app');
    const { getAuth, signInAnonymously } = await import('firebase/auth');
    const { getFirestore, collection, getDocs } = await import('firebase/firestore');
    const app = initializeApp(parseConfig(), 'emu-seed-pull');
    await signInAnonymously(getAuth(app));
    const db = getFirestore(app);
    const dump = { root: SOURCE_ROOT, pulledAt: new Date().toISOString(), collections: {} };
    for (const col of parseCollections()) {
        const snap = await getDocs(collection(db, SOURCE_ROOT, col, 'items'));
        dump.collections[col] = Object.fromEntries(snap.docs.map(d => [d.id, encode(d.data())]));
        console.log(`  ${col}: ${snap.size}`);
    }
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(dump));
    console.log(`✔ ${OUT_FILE}`);
    process.exit(0);
}

async function authEmu(path, init) {
    const r = await fetch(`http://${EMU.host}:${EMU.auth}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(body)}`);
    return body;
}

async function push() {
    if (!existsSync(OUT_FILE)) throw new Error(`Önce: node scratch/emu-seed.mjs pull (${OUT_FILE} yok)`);
    const dump = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
    const { doc, writeBatch, Timestamp } = await import('firebase/firestore');
    const decode = v => (v && v.__ts) ? new Timestamp(v.__ts[0], v.__ts[1])
        : Array.isArray(v) ? v.map(decode)
        : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)])) : v;

    const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host: EMU.host, port: EMU.firestore } });
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        for (const [col, docs] of Object.entries(dump.collections)) {
            const entries = Object.entries(docs);
            for (let i = 0; i < entries.length; i += 400) {
                const batch = writeBatch(db);
                for (const [id, data] of entries.slice(i, i + 400)) batch.set(doc(db, SOURCE_ROOT, col, 'items', id), decode(data));
                await batch.commit();
            }
            console.log(`  ${col}: ${entries.length}`);
        }
    });
    await env.cleanup();

    await authEmu(`/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
    await authEmu(`/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emu`, {
        method: 'POST', body: JSON.stringify({ email: EMU_ADMIN_EMAIL, password: '0' + EMU_ADMIN_CODE, returnSecureToken: true }),
    });
    console.log(`✔ emülatör tohumlandı (${dump.pulledAt} kopyası) · EMU admin kodu: ${EMU_ADMIN_CODE}`);
    process.exit(0);
}

const cmd = process.argv[2];
if (cmd === 'pull') await pull();
else if (cmd === 'push') await push();
else { console.log('Kullanım: node scratch/emu-seed.mjs pull | push'); process.exit(1); }
