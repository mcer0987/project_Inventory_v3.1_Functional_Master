/**
 * utils/ownership.js — Kayıt sahipliği (UID) alanları, sahiplik göçü ve değiştirilemezlik muhafızı (Faz 4B · Tur J9)
 * Klasik script; iki sayfada <head>'de schema.js'ten sonra. Çekirdek saf: Firestore'a dokunmaz (yazma/okuma enjekte edilen
 * `store` üzerinden) → tests/unit/ownership.test.mjs, tests/integration/ownership.emu.test.mjs.
 *
 * [WHY]: Kurallar (J10) "kim kimin kaydını değiştirebilir" sorusunu ancak kayıtta Auth uid'si varsa cevaplayabilir. Bugün sahiplik
 *        ad / personel id / eski giriş kodu ile tutuluyor: ad değişebilir ve çakışabilir, kod gizli olmalı, id kuralın bildiği
 *        bir kimlik değil.
 * [HOW]: Alanlar
 *          requests.personelUid · purchaseOrders.createdByUid · tasks.creatorUid  → SAHİPLİK: ilk yazımdan sonra DEĞİŞMEZ
 *          tasks.assigneeUid · workflowTemplates/purchaseOrders.workflow.steps[].userUid → TÜRETİLMİŞ: görev başkasına atanınca /
 *          şablon düzenlenince yeniden hesaplanır (atanan ve onaylayıcı meşru olarak değişir; sahibi değişmez)
 *        UID kaynağı (GPT-6 kural 1): yalnız Firebase Auth — ya oturumun kendi uid'si (window.userAuth) ya da J7'de hesap açılırken
 *        Auth'un döndürdüğü ve personel kaydına bağlanan uid (personel.uid; authEmail personel id'siyle tutarlı olmalı). Addan
 *        uid TÜRETİLMEZ; ad yalnız TEK bir personeli işaret ediyorsa o personelin Auth uid'sine götürür. Belirsiz / hesapsız /
 *        sistem adımlarına (ör. "Admin", "Sistem", havuz) uid YAZILMAZ — alan null kalır ve raporlanır.
 *        Göç (GPT-6 kural 2): önizleme saf (yazmaz); uygulama kayıt başına Firestore transaction'ı ile — her kayıt transaction
 *        içinde yeniden okunur ve plan TAZE veriyle yeniden hesaplanır; önizlemedekiyle aynı değilse kayıt atlanır ("değişti").
 *        Dayanılan personel kayıtları da transaction içinde doğrulanır. Parçalar 100 kayıtlık (Firestore sınırı 500); bir parça
 *        düşerse durur, yazılan / düşen / denenmeyen sayıları ayrı ayrı döner (gizlenmez). Yeniden çalıştırmak güvenlidir.
 */
(function () {
    const OWNER_FIELDS = Object.freeze({ requests: 'personelUid', purchaseOrders: 'createdByUid', tasks: 'creatorUid' });
    const MIGRATION_COLLECTIONS = Object.freeze(['requests', 'purchaseOrders', 'tasks', 'workflowTemplates']);
    const CHUNK_SIZE = 100;
    // Kişi değil sistem / rol / havuz anlamına gelen değerler: hiçbir zaman bir personele eşlenmez (sahte uid üretilmez).
    const SYSTEM_ACTORS = Object.freeze(['system', 'sistem', 'admin', 'yönetici', 'yonetici', 'pool', 'havuz', 'unknown', 'bilinmeyen', 'bilinmeyen kullanıcı']);

    const blank = v => v === undefined || v === null || String(v).trim() === '';
    const S = () => window.Schema;
    const norm = s => S().normName(s);
    const isSystemActor = v => !blank(v) && SYSTEM_ACTORS.includes(norm(v));

    // ─── Personel dizini ───────────────────────────────────────────────────────────────────────────────
    /**
     * @param {object[]} personel
     * @param {{staffEmail?: Function}} [opts]  staffEmail(id) → beklenen J7 hesap e-postası (tutarlılık denetimi)
     */
    function buildPersonIndex(personel, { staffEmail } = {}) {
        const byId = new Map(), byCode = new Map(), byName = new Map(), byUid = new Map();
        const push = (m, k, p) => m.set(k, [...(m.get(k) || []), p]);
        (personel || []).forEach(p => {
            if (!p || typeof p !== 'object' || blank(p.id)) return;
            byId.set(String(p.id), p);
            if (!blank(p.code)) push(byCode, String(p.code).trim(), p);
            const n = norm(p.name || p.adSoyad);
            if (n) push(byName, n, p);
            if (!blank(p.uid)) push(byUid, String(p.uid), p);
        });
        return { byId, byCode, byName, byUid, staffEmail: typeof staffEmail === 'function' ? staffEmail : null };
    }

    /** Personelin Auth uid'si (J7 bağı). Tutarsız bağ (paylaşılan uid, e-posta uyumsuzluğu) güvenilmez. */
    function accountOf(index, p) {
        if (!p || blank(p.uid)) return { status: 'no-account' };
        const uid = String(p.uid).trim();
        if ((index.byUid.get(uid) || []).length > 1) return { status: 'account-inconsistent', detail: 'aynı giriş hesabı birden fazla personele bağlı' };
        if (index.staffEmail) {
            const expected = index.staffEmail(p.id);
            if (!expected || blank(p.authEmail) || String(p.authEmail).trim().toLowerCase() !== expected.toLowerCase()) {
                return { status: 'account-inconsistent', detail: 'hesap e-postası personel kaydıyla uyuşmuyor' };
            }
        }
        return { status: 'ok', uid };
    }

    const label = p => (p && (p.name || p.adSoyad)) || '-';

    /**
     * Bir kaydın sahibini bulur. Öncelik: id (yetkili, varsa tek başına karar verir) → eski giriş kodu (tekilse) → ad(lar).
     * Ad birden fazla personele denk geliyorsa OTOMATİK EŞLEME YAPILMAZ (GPT-6 kural 2). Kaynaklar farklı kişileri işaret
     * ediyorsa 'conflict'. Dönen nesne kodun kendisini içermez (önizleme/rapor güvenli).
     * @param {{id?, code?, names?: string[]}} refs
     * @returns {{status:'ok'|'not-found'|'ambiguous'|'conflict'|'unmatched'|'system'|'no-account'|'account-inconsistent',
     *            person?:object, uid?:string, via?:string, detail?:string, candidates?:string[]}}
     */
    function resolveOwner(index, { id, code, names = [] } = {}) {
        const nameList = names.filter(n => !blank(n));
        if (blank(id) && blank(code) && nameList.length === 0) return { status: 'unmatched', detail: 'kayıtta kişi bilgisi yok' };
        if (blank(id) && blank(code) && nameList.every(isSystemActor)) return { status: 'system', detail: 'sistem / rol / havuz değeri' };

        let person = null, via = null;
        if (!blank(id)) {
            person = index.byId.get(String(id)) || null;
            if (!person) return { status: 'not-found', via: 'id', detail: 'kayıttaki personel id listede yok (silinmiş olabilir)' };
            via = 'id';
        } else if (!blank(code)) {
            const hits = index.byCode.get(String(code).trim()) || [];
            if (hits.length > 1) return { status: 'ambiguous', via: 'code', detail: `eski giriş kodu ${hits.length} personelde ortak`, candidates: hits.map(label) };
            if (hits.length === 1) { person = hits[0]; via = 'code'; }
        }
        if (via !== 'id') {
            for (const n of nameList) {
                if (isSystemActor(n)) continue;
                const hits = index.byName.get(norm(n)) || [];
                if (hits.length === 0) continue;   // ad değişmiş olabilir; başka kaynak karar verir
                if (person) {
                    if (!hits.includes(person)) return { status: 'conflict', detail: `kayıttaki ad (${n}) başka bir personeli işaret ediyor`, candidates: [label(person), ...hits.map(label)] };
                    continue;   // ad belirsiz olsa da kod/id ile seçilen kişi aralarında
                }
                if (hits.length > 1) return { status: 'ambiguous', via: 'name', detail: `"${n}" adı ${hits.length} personelde`, candidates: hits.map(label) };
                person = hits[0]; via = 'name';
            }
            // aynı kayıtta iki farklı ad alanı farklı (tekil) kişileri işaret ediyor mu?
            if (person && via === 'name') {
                for (const n of nameList) {
                    const hits = isSystemActor(n) ? [] : (index.byName.get(norm(n)) || []);
                    if (hits.length === 1 && hits[0] !== person) return { status: 'conflict', detail: 'kayıttaki ad alanları farklı personelleri işaret ediyor', candidates: [label(person), label(hits[0])] };
                }
            }
        }
        if (!person) return { status: 'not-found', detail: 'kayıttaki ad / kod hiçbir personelle eşleşmiyor' };
        const acct = accountOf(index, person);
        if (acct.status !== 'ok') return { status: acct.status, person, via, detail: acct.detail || 'personelin giriş hesabı yok (önce VIP → Auth Göç Aracı)' };
        return { status: 'ok', person, uid: acct.uid, via };
    }

    /** Ad → tek personelin Auth uid'si; aksi hâlde null (belirsiz, hesapsız, sistem). Yeni kayıt / şablon / görev ataması için. */
    function uidForName(index, name) {
        if (blank(name) || isSystemActor(name)) return null;
        const r = resolveOwner(index, { names: [name] });
        return r.status === 'ok' ? r.uid : null;
    }

    // ─── Kayıt başına göç planı ────────────────────────────────────────────────────────────────────────
    // Her kaydın sahiplik kaynakları (yalnız kişi bilgisi; giriş kodu rapora ÇIKMAZ).
    const OWNER_REFS = {
        requests: d => ({ id: d.personelId, code: d.personelKodu, names: [d.personel] }),
        purchaseOrders: d => {
            // createdBy: J8+ personel id'si, J8 öncesi giriş kodu, şablondan açılanlarda ad olabilir.
            const by = blank(d.createdBy) ? null : String(d.createdBy);
            return { id: null, createdBy: by, names: [d.createdByName, d.talepEden] };
        },
        tasks: d => ({ id: null, code: null, names: [d.creatorId] }),
    };
    function resolveRecordOwner(index, col, d) {
        const refs = OWNER_REFS[col](d);
        if (col === 'purchaseOrders' && refs.createdBy && !isSystemActor(refs.createdBy)) {
            if (index.byId.has(refs.createdBy)) return resolveOwner(index, { id: refs.createdBy });
            if (index.byCode.has(refs.createdBy)) return resolveOwner(index, { code: refs.createdBy, names: refs.names });
            return resolveOwner(index, { names: [refs.createdBy, ...refs.names] });
        }
        return resolveOwner(index, refs);
    }

    /**
     * Tek kayıt için yazılacak uid'ler. Var olan (dolu) uid'ye ASLA dokunulmaz; çözümle uyuşmuyorsa 'mismatch' raporlanır.
     * @returns {{patch:object|null, assigns:string[], issues:{field, status, detail?, candidates?}[], already:number}}
     *          assigns: önizleme/uygulama karşılaştırma anahtarı ("alan=uid" listesi, sıralı)
     */
    function planDoc(col, doc, index) {
        const out = { patch: null, assigns: [], issues: [], already: 0 };
        if (!doc || typeof doc !== 'object') return out;
        const set = (k, v) => { out.patch = out.patch || {}; out.patch[k] = v; };
        const ownerField = OWNER_FIELDS[col];
        if (ownerField) {
            const r = resolveRecordOwner(index, col, doc);
            if (!blank(doc[ownerField])) {
                out.already++;
                if (r.status === 'ok' && r.uid !== String(doc[ownerField])) out.issues.push({ field: ownerField, status: 'mismatch', detail: 'kayıttaki uid personelin bugünkü hesabından farklı (değiştirilmez)' });
            } else if (r.status === 'ok') {
                set(ownerField, r.uid); out.assigns.push(`${ownerField}=${r.uid}`);
            } else {
                out.issues.push({ field: ownerField, status: r.status, detail: r.detail, candidates: r.candidates });
            }
        }
        if (col === 'tasks' && blank(doc.assigneeUid) && !blank(doc.assigneeId) && !isSystemActor(doc.assigneeId)) {
            const r = resolveOwner(index, { names: [doc.assigneeId] });
            if (r.status === 'ok') { set('assigneeUid', r.uid); out.assigns.push(`assigneeUid=${r.uid}`); }
            else out.issues.push({ field: 'assigneeUid', status: r.status, detail: r.detail, candidates: r.candidates });
        } else if (col === 'tasks' && !blank(doc.assigneeUid)) out.already++;

        const steps = col === 'workflowTemplates' ? doc.steps : (col === 'purchaseOrders' && doc.workflow ? doc.workflow.steps : null);
        if (Array.isArray(steps)) {
            let changed = false;
            const next = steps.map((s, i) => {
                if (!s || typeof s !== 'object') return s;
                if (!blank(s.userUid)) { out.already++; return s; }
                if (blank(s.user) || isSystemActor(s.user)) {
                    if (!blank(s.user)) out.issues.push({ field: `steps[${i}].userUid`, status: 'system', detail: 'sistem / rol adımı' });
                    return s;
                }
                const r = resolveOwner(index, { names: [s.user] });
                if (r.status !== 'ok') { out.issues.push({ field: `steps[${i}].userUid`, status: r.status, detail: r.detail, candidates: r.candidates }); return s; }
                changed = true;
                out.assigns.push(`steps[${i}].userUid=${r.uid}`);
                return { ...s, userUid: r.uid };
            });
            if (changed) {
                if (col === 'workflowTemplates') set('steps', next);
                else set('workflow', { ...doc.workflow, steps: next });
            }
        }
        out.assigns.sort();
        return out;
    }

    // Personel kayıtlarının sahiplik çözümünü etkileyen alanları — önizleme ile uygulama arasında değişti mi?
    const personFingerprint = p => JSON.stringify([String(p.id), norm(p.name || p.adSoyad), blank(p.code) ? '' : String(p.code).trim(), blank(p.uid) ? '' : String(p.uid), blank(p.authEmail) ? '' : String(p.authEmail).toLowerCase()]);
    function personelFingerprint(personel) {
        return (personel || []).filter(p => p && !blank(p.id)).map(personFingerprint).sort().join('\n');
    }

    /**
     * Önizleme (SAF — hiçbir yere yazmaz).
     * @param {{data: Object<string, object[]>, personel: object[], staffEmail?: Function}} input
     * @returns {{items:{col,id,patch,key,label}[], summary:Object, issues:{col,id,label,field,status,detail,candidates}[], personelFingerprint:string, totals}}
     */
    function planMigration({ data, personel, staffEmail }) {
        const index = buildPersonIndex(personel, { staffEmail });
        const items = [], issues = [], summary = {};
        MIGRATION_COLLECTIONS.forEach(col => {
            const docs = (data && data[col]) || [];
            const s = summary[col] = { total: 0, toUpdate: 0, assigns: 0, alreadyFields: 0, issues: 0 };
            docs.forEach(d => {
                if (!d || blank(d.id)) return;
                s.total++;
                const p = planDoc(col, d, index);
                s.alreadyFields += p.already;
                const lbl = recordLabel(col, d);
                p.issues.forEach(i => { issues.push({ col, id: String(d.id), label: lbl, ...i }); s.issues++; });
                if (p.patch) { items.push({ col, id: String(d.id), patch: p.patch, key: p.assigns.join(';'), label: lbl }); s.toUpdate++; s.assigns += p.assigns.length; }
            });
        });
        const dupUids = [...index.byUid.entries()].filter(([, v]) => v.length > 1).map(([, v]) => v.map(label));
        return {
            items, issues, summary, duplicateUidGroups: dupUids,
            personelFingerprint: personelFingerprint(personel),
            totals: { records: items.length, assigns: items.reduce((n, it) => n + it.key.split(';').filter(Boolean).length, 0), issues: issues.length },
        };
    }

    function recordLabel(col, d) {
        const pick = (...v) => v.find(x => !blank(x));
        if (col === 'requests') return `${pick(d.ürün, d.urun, '-')} · ${pick(d.personel, '-')}`;
        if (col === 'purchaseOrders') return `${pick(d.evrakNo, d.urun, '-')} · ${pick(d.createdByName, d.talepEden, '-')}`;
        if (col === 'tasks') return `${pick(d.title, '-')}`;
        return `${pick(d.name, '-')}`;
    }

    // ─── Uygulama (transaction, parçalı) ──────────────────────────────────────────────────────────────
    /**
     * @param {object} o
     * @param {object} o.plan             planMigration sonucu (önizleme)
     * @param {object} o.store            { readAll(col) → [{id, data}], transaction(fn(tx)) → sonuç; tx: get(col,id) → data|null, update(col,id,patch) }
     * @param {Function} [o.staffEmail]
     * @param {Function} [o.onProgress]   (done, total)
     * @returns {Promise<{status:'done'|'stopped'|'aborted', written:{col,id}[], skipped:{col,id,reason}[], failed:{col,id,code,message}[],
     *                   notAttempted:number, error?:{code,message}}>}
     */
    async function applyMigration({ plan, store, staffEmail, onProgress, chunkSize = CHUNK_SIZE }) {
        const result = { status: 'done', written: [], skipped: [], failed: [], notAttempted: 0 };
        if (!plan || !Array.isArray(plan.items)) throw new Error('applyMigration: önizleme planı gerekli');
        // 1. Personel listesi önizlemeden sonra değiştiyse (yeni / silinen / yeniden adlandırılan / hesabı değişen personel) DUR.
        const freshPersonel = (await store.readAll('personel')).map(r => ({ id: r.id, ...r.data }));
        if (personelFingerprint(freshPersonel) !== plan.personelFingerprint) {
            return { ...result, status: 'aborted', notAttempted: plan.items.length, error: { code: 'personel-changed', message: 'Personel listesi önizlemeden sonra değişti; önizlemeyi yenileyin.' } };
        }
        const index = buildPersonIndex(freshPersonel, { staffEmail });
        const byIdFresh = new Map(freshPersonel.map(p => [String(p.id), p]));
        let done = 0;
        for (let i = 0; i < plan.items.length; i += chunkSize) {
            const chunk = plan.items.slice(i, i + chunkSize);
            let outcome;
            try {
                outcome = await store.transaction(async tx => {
                    const local = { written: [], skipped: [] };   // transaction yeniden denenebilir: her denemede sıfırdan
                    const fresh = [];
                    for (const it of chunk) fresh.push(await tx.get(it.col, it.id));
                    // 2. Dayanılan personel kayıtları transaction içinde (okuma kümesine girer: değişirlerse transaction yeniden dener)
                    const deps = new Set();
                    chunk.forEach(it => it.key.split(';').filter(Boolean).forEach(a => {
                        const uid = a.split('=')[1];
                        (index.byUid.get(uid) || []).forEach(p => deps.add(String(p.id)));
                    }));
                    for (const pid of deps) {
                        const live = await tx.get('personel', pid);
                        const before = byIdFresh.get(pid);
                        if (!live || !before || personFingerprint({ id: pid, ...live }) !== personFingerprint(before)) {
                            throw Object.assign(new Error('Bir personel kaydı göç sırasında değişti; önizlemeyi yenileyin.'), { code: 'personel-changed' });
                        }
                    }
                    const writes = [];
                    chunk.forEach((it, k) => {
                        const d = fresh[k];
                        if (!d) { local.skipped.push({ col: it.col, id: it.id, reason: 'deleted' }); return; }
                        const p = planDoc(it.col, { ...d, id: d.id ?? it.id }, index);
                        if (!p.patch) { local.skipped.push({ col: it.col, id: it.id, reason: 'already' }); return; }
                        if (p.assigns.join(';') !== it.key) { local.skipped.push({ col: it.col, id: it.id, reason: 'changed-since-preview' }); return; }
                        writes.push({ it, patch: p.patch });
                    });
                    writes.forEach(w => { tx.update(w.it.col, w.it.id, w.patch); local.written.push({ col: w.it.col, id: w.it.id, patch: w.patch }); });
                    return local;
                });
            } catch (e) {
                chunk.forEach(it => result.failed.push({ col: it.col, id: it.id, code: (e && e.code) || 'write-failed', message: (e && e.message) || 'bilinmeyen hata' }));
                result.notAttempted = plan.items.length - i - chunk.length;
                result.status = 'stopped';
                result.error = { code: (e && e.code) || 'write-failed', message: (e && e.message) || 'bilinmeyen hata' };
                return result;
            }
            result.written.push(...outcome.written);
            result.skipped.push(...outcome.skipped);
            done += chunk.length;
            if (onProgress) onProgress(done, plan.items.length);
        }
        return result;
    }

    // ─── Değiştirilemezlik muhafızı (veri katmanı: applyItemOps / runStockOps / saveData) ─────────────────
    /**
     * @param {{col, op:'set'|'update'|'delete', data:object, prev:object|null, actorUid:string|null, isAdmin:boolean}} p
     *        prev: Firestore'daki son hâl (mirror) ya da null (yeni kayıt). 'set' ve saveData'da data YERİNDE düzeltilir:
     *        dolu sahiplik alanı gönderilmemişse eski değer taşınır (tam değiştirme alanı silmesin).
     * @returns {null | {code:string, message:string, field:string}}
     */
    function ownerGuard({ col, op, data, prev, actorUid, isAdmin }) {
        const f = OWNER_FIELDS[col];
        if (!f || op === 'delete' || !data || typeof data !== 'object') return null;
        const before = prev && !blank(prev[f]) ? String(prev[f]) : null;
        const has = Object.prototype.hasOwnProperty.call(data, f);
        const next = has && !blank(data[f]) ? String(data[f]) : null;
        const err = (code, message) => ({ code, field: f, message });
        if (before) {
            if (next === null) {
                // Alan gönderilmemiş ya da boş/null ile ezilmek isteniyor: tam değiştirmede ('set') eski değer taşınır,
                // kısmi güncellemede ('update') boş değer hiç yazılmaz. İki durumda da sahiplik korunur.
                if (op === 'set') data[f] = before;
                else if (has) delete data[f];
                return null;
            }
            if (next !== before) return err('owner-immutable', `${col} kaydının sahiplik alanı (${f}) değiştirilemez.`);
            return null;
        }
        if (next === null) return null;
        if (prev) {
            // Var olan kayda sahiplik ilk kez yazılıyor: yalnız yönetici (Sahiplik Göç Aracı ile aynı yetki).
            if (!isAdmin) return err('owner-first-write', `${col} kaydına sahiplik alanı (${f}) yalnız yönetici tarafından eklenebilir.`);
            return null;
        }
        // Yeni kayıt: sahiplik yalnız oturumun KENDİ Auth uid'si olabilir (başkası adına kayıt açılamaz).
        if (!actorUid || next !== String(actorUid)) return err('owner-uid-mismatch', `${col} kaydının sahiplik alanı (${f}) oturumun kendi kimliği olmalı.`);
        return null;
    }

    // ─── Oturum yardımcıları (tarayıcı) ───────────────────────────────────────────────────────────────
    // Personelin kendi kaydı (talep, satın alma): yalnız oturum KENDİ personel hesabıysa ve hesap aktif kullanıcının kaydına
    // bağlıysa. Anonim (eski yol) ve yönetici oturumunda null — göç aracı sonradan personel kaydındaki uid ile doldurur.
    function selfUid() {
        const Sess = window.AppModules && window.AppModules.Session;
        const u = window.userAuth;
        if (!u || !Sess || !Sess.isStaffAccountSession(u)) return null;
        const me = typeof window.getActiveUser === 'function' ? window.getActiveUser() : null;
        return me && !blank(me.uid) && String(me.uid) === String(u.uid) ? String(u.uid) : null;
    }
    // İşlemi yapan hesap (görevi oluşturan): personelin kendi hesabı ya da yönetici hesabı. Anonim → null.
    function actorUid() {
        const u = window.userAuth;
        if (!u || u.isAnonymous) return null;
        if (typeof window.isDbAdmin === 'function' && window.isDbAdmin()) return String(u.uid);
        return selfUid();
    }
    function currentIndex() {
        const SP = window.StaffProvisioning;
        return buildPersonIndex((window.data && window.data.personel) || [], { staffEmail: SP ? SP.staffEmail : null });
    }
    const uidForPersonName = name => uidForName(currentIndex(), name);

    const Ownership = {
        OWNER_FIELDS, MIGRATION_COLLECTIONS, CHUNK_SIZE, SYSTEM_ACTORS,
        buildPersonIndex, accountOf, resolveOwner, uidForName, planDoc, planMigration, applyMigration, ownerGuard,
        personelFingerprint, isSystemActor,
        selfUid, actorUid, uidForPersonName,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.Ownership = Ownership;
    window.Ownership = Ownership;
})();
