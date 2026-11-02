// Yerel UAT hesaplarını çalışan emülatöre, mevcut test verilerini silmeden ekler.
// Kullanım: npm run emu (ayrı terminal), sonra node scratch/emu-ensure-uat.mjs
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const projectId = 'medipol-inventory-v3';
const authBase = 'http://127.0.0.1:9099';
const host = '127.0.0.1';
const root = 'inventory_demo';
const staff = [
    { id: 'ft_staff', name: 'Flow Test Personel', pri: 'flow.personel', code: 'ftkod77' },
    { id: 'ft_staff2', name: 'Flow Test Onaylayıcı', pri: 'flow.onaylayici', code: 'ftkod88' },
];

async function authRequest(operation, email, password) {
    const response = await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:${operation}?key=emu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const body = await response.json();
    return { ok: response.ok, uid: body.localId, error: body.error?.message };
}

async function ensureAccount(email, password) {
    const signIn = await authRequest('signInWithPassword', email, password);
    if (signIn.ok) return signIn.uid;
    if (signIn.error !== 'EMAIL_NOT_FOUND') {
        throw new Error(`${email}: hesap mevcut olabilir; parolasını değiştirmeden işlem durduruldu (${signIn.error})`);
    }
    const created = await authRequest('signUp', email, password);
    if (!created.ok) throw new Error(`${email}: hesap açılamadı (${created.error})`);
    return created.uid;
}

// Doğru emülatör ve beklenen boş/uyumlu kimlik kayıtları doğrulanmadan hiçbir yazma yapılmaz.
const env = await initializeTestEnvironment({ projectId, firestore: { host, port: 8080 } });
try {
    await env.withSecurityRulesDisabled(async (admin) => {
        const db = admin.firestore();
        const gateRef = doc(db, root, 'accessGate', 'items', 'staff');
        const gate = await getDoc(gateRef);
        if (gate.exists() && gate.data().staffAccessEnabled !== true) {
            throw new Error('Personel erişim kilidi kapalı; mevcut kararı değiştirmeden işlem durduruldu.');
        }
        const unit = await getDoc(doc(db, root, 'units', 'items', 'ft_unit'));
        if (unit.exists() && (unit.data().name !== 'Test' || unit.data().active === false)) {
            throw new Error('ft_unit: mevcut birim farklı veya pasif; işlem durduruldu.');
        }
        for (const person of staff) {
            const ref = doc(db, root, 'personel', 'items', person.id);
            const snapshot = await getDoc(ref);
            if (snapshot.exists() && snapshot.data().pri !== person.pri) {
                throw new Error(`${person.id}: mevcut personel kaydı farklı bir kimliğe bağlı; işlem durduruldu.`);
            }
        }
    });

    const adminUid = await ensureAccount('admin@medipol.local', 'emu-yonetici-0001');
    const linked = [];
    for (const person of staff) {
        const email = `${person.pri}@staff.medipol.local`;
        linked.push({ ...person, email, uid: await ensureAccount(email, `${person.code}Mdp!`) });
    }
    await env.withSecurityRulesDisabled(async (admin) => {
        const db = admin.firestore();
        const unitRef = doc(db, root, 'units', 'items', 'ft_unit');
        if (!(await getDoc(unitRef)).exists()) {
            await setDoc(unitRef, {
                id: 'ft_unit', name: 'Test', code: 'UAT-TEST', organizationId: 'UAT', parentUnitId: '',
                active: true, personnelIds: staff.map(person => person.id), personnel: staff.map(person => person.name),
            });
        }
        for (const person of linked) {
            const personRef = doc(db, root, 'personel', 'items', person.id);
            const existing = await getDoc(personRef);
            if (existing.exists() && existing.data().uid && existing.data().uid !== person.uid) {
                throw new Error(`${person.id}: eşleme sırasında UID değişti; işlem durduruldu.`);
            }
            const accountRef = doc(db, root, 'staffAccounts', 'items', person.uid);
            const account = await getDoc(accountRef);
            if (account.exists() && (account.data().personelId !== person.id || account.data().pri !== person.pri)) {
                throw new Error(`${person.pri}: mevcut hesap eşlemesi başka personele ait; işlem durduruldu.`);
            }
            await setDoc(personRef, {
                id: person.id, name: person.name, birim: 'Test', unitId: 'ft_unit', pri: person.pri,
                uid: person.uid, authEmail: person.email, authProvisionedAt: Date.now(), active: true,
            }, { merge: true });
            await setDoc(accountRef, {
                personelId: person.id, pri: person.pri, linkedAt: Date.now(),
            }, { merge: true });
        }
        const gateRef = doc(db, root, 'accessGate', 'items', 'staff');
        if (!(await getDoc(gateRef)).exists()) {
            await setDoc(gateRef, {
                staffAccessEnabled: true, changedAt: new Date(), changedBy: 'emu-ensure-uat',
                reason: 'Yerel UAT hesapları', version: 1,
            });
        }
    });
    // Kimlik eşlemeleri yazıldıktan sonra girişin gerçekten çalıştığını tekrar denetle.
    for (const person of linked) {
        const result = await authRequest('signInWithPassword', person.email, `${person.code}Mdp!`);
        if (!result.ok || result.uid !== person.uid) throw new Error(`${person.pri}: giriş doğrulanamadı`);
    }
    console.log(`Yerel UAT hazır: yönetici ${adminUid ? 'var' : 'yok'}, ${linked.map(p => p.pri).join(', ')} girişleri ve Test birimi doğrulandı.`);
} finally {
    await env.cleanup();
}
