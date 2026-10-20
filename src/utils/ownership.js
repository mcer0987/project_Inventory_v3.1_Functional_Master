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
 *        Auth'un döndürdüğü ve personel kaydına bağlanan uid (personel.uid; authEmail personelin PRI adresi olmalı). Addan
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
     * @param {{accountEmail?: Function}} [opts]  accountEmail(personel) → beklenen hesap e-postası (J10 PRI: <pri>@…; tutarlılık denetimi)
     */
    function buildPersonIndex(personel, { accountEmail } = {}) {
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
        return { byId, byCode, byName, byUid, accountEmail: typeof accountEmail === 'function' ? accountEmail : null };
    }

    /** Personelin Auth uid'si (J7 bağı). Tutarsız bağ (paylaşılan uid, e-posta PRI adresi değil — ör. taşınmamış J7 hesabı) güvenilmez. */
    function accountOf(index, p) {
        if (!p || blank(p.uid)) return { status: 'no-account' };
        const uid = String(p.uid).trim();
        if ((index.byUid.get(uid) || []).length > 1) return { status: 'account-inconsistent', detail: 'aynı giriş hesabı birden fazla personele bağlı' };
        if (index.accountEmail) {
            const expected = index.accountEmail(p);
            if (!expected || blank(p.authEmail) || String(p.authEmail).trim().toLowerCase() !== expected.toLowerCase()) {
                return { status: 'account-inconsistent', detail: 'hesap e-postası personelin kurumsal kimliğiyle (PRI) uyuşmuyor' };
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
        if (acct.status !== 'ok') return { status: acct.status, person, via, detail: acct.detail || 'personelin giriş hesabı yok (önce VIP → PRI / Hesap Göç Aracı)' };
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
    const personFingerprint = p => JSON.stringify([String(p.id), norm(p.name || p.adSoyad), blank(p.code) ? '' : String(p.code).trim(), blank(p.uid) ? '' : String(p.uid), blank(p.authEmail) ? '' : String(p.authEmail).toLowerCase(), blank(p.pri) ? '' : String(p.pri).toLowerCase()]);
    function personelFingerprint(personel) {
        return (personel || []).filter(p => p && !blank(p.id)).map(personFingerprint).sort().join('\n');
    }

    /**
     * Önizleme (SAF — hiçbir yere yazmaz).
     * @param {{data: Object<string, object[]>, personel: object[], accountEmail?: Function}} input
     * @returns {{items:{col,id,patch,key,label}[], summary:Object, issues:{col,id,label,field,status,detail,candidates}[], personelFingerprint:string, totals}}
     */
    function planMigration({ data, personel, accountEmail }) {
        const index = buildPersonIndex(personel, { accountEmail });
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

    // planMigration().issues içindeki her satırı ikiye ayırır (J11 · P1, J11 · P0 ile aynı sınıflandırma — TEK yer):
    //   engelleyici (blocking)  sahiplik alanının (personelUid/createdByUid/creatorUid) kendisi çözülemedi ya da dolu uid
    //                           bugünkü hesaptan farklı ('mismatch') — kod temizliği ve P0 kilidi bunlarla açılmaz/ilerlemez.
    //   uyarı (warning)         onay adımı / atanan alanı (steps[].userUid, assigneeUid) çözülemedi ya da sistem/rol/havuz
    //                           değeri ('system') — bu alanlar yalnız yönetici tarafından elle çözülür, engel SAYILMAZ
    //                           (aksi hâlde "Admin" / "havuz" gibi hiç çözülemeyecek değerler aracı kalıcı olarak kilitlerdi).
    function classifyOwnershipIssues(issues) {
        const ownerFields = Object.values(OWNER_FIELDS);
        const blocking = [], warnings = [];
        (issues || []).forEach(i => {
            if (i.status === 'mismatch' || (ownerFields.includes(i.field) && i.status !== 'system')) blocking.push(i);
            else if (i.status !== 'system') warnings.push(i);
        });
        return { blocking, warnings };
    }

    // ─── Uygulama (transaction, parçalı) ──────────────────────────────────────────────────────────────
    /**
     * @param {object} o
     * @param {object} o.plan             planMigration sonucu (önizleme)
     * @param {object} o.store            { readAll(col) → [{id, data}], transaction(fn(tx)) → sonuç; tx: get(col,id) → data|null, update(col,id,patch) }
     * @param {Function} [o.accountEmail]
     * @param {Function} [o.onProgress]   (done, total)
     * @returns {Promise<{status:'done'|'stopped'|'aborted', written:{col,id}[], skipped:{col,id,reason}[], failed:{col,id,code,message}[],
     *                   notAttempted:number, error?:{code,message}}>}
     */
    async function applyMigration({ plan, store, accountEmail, onProgress, chunkSize = CHUNK_SIZE }) {
        const result = { status: 'done', written: [], skipped: [], failed: [], notAttempted: 0 };
        if (!plan || !Array.isArray(plan.items)) throw new Error('applyMigration: önizleme planı gerekli');
        // 1. Personel listesi önizlemeden sonra değiştiyse (yeni / silinen / yeniden adlandırılan / hesabı değişen personel) DUR.
        const freshPersonel = (await store.readAll('personel')).map(r => ({ id: r.id, ...r.data }));
        if (personelFingerprint(freshPersonel) !== plan.personelFingerprint) {
            return { ...result, status: 'aborted', notAttempted: plan.items.length, error: { code: 'personel-changed', message: 'Personel listesi önizlemeden sonra değişti; önizlemeyi yenileyin.' } };
        }
        const index = buildPersonIndex(freshPersonel, { accountEmail });
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
        return buildPersonIndex((window.data && window.data.personel) || [], { accountEmail: SP ? SP.accountEmailOf : null });
    }
    const uidForPersonName = name => uidForName(currentIndex(), name);
    // J11 · P1 #5/#7: oturum sahibinin GÖRÜNEN adı — firestore.rules staffName ile AYNI kaynak ve öncelik (personel kaydında
    // name → adSoyad → ad, kırpılmış). Talep sahibi / oluşturan / onaylayan alanları bununla yazılır; kurallar aynı değeri bekler.
    function selfName() {
        const me = typeof window.getActiveUser === 'function' ? window.getActiveUser() : null;
        if (!me) return '';
        // Kuralla birebir: boş olmayan İLK metin alanı seçilir, sonra kırpılır (yalnız boşluktan oluşan ad → '').
        const pick = [me.name, me.adSoyad].find(v => typeof v === 'string' && v !== '');
        const nm = pick !== undefined ? pick : me.ad;
        return typeof nm === 'string' ? nm.trim() : '';
    }

    // ─── Kod temizliği planı (Faz 4B · J10 → J11 · P1) ───────────────────────────────────────────────────
    // [WHY]: Giriş artık yalnız Firebase Auth ile; düz metin giriş kodları (personel.code ve eski kayıtlara kopyalanmış hâlleri:
    //        requests.personelKodu, purchaseOrders.createdBy) veritabanında kalmamalı.
    // [HOW]: Engeller (kod silinirse personel kilitlenir, sahiplik eşlemesi kaybolur ya da eski kimlik referansı KALICI OLARAK
    //        çözülemez hâle gelir — kodlar silindikten sonra hangi değerin kod olduğu bir daha bilinemez):
    //          - hesabı olmayan / tutarsız personel
    //          - Sahiplik Göç Aracı'nın yazmadığı kayıt (ownershipPendingItems)
    //          - sahiplik alanının KENDİSİ çözülemeyen / dolu uid'si bugünkü hesaptan farklı kayıt (ownershipIssues içinden
    //            classifyOwnershipIssues ile ayrılan ENGELLEYİCİ satırlar — onay adımı / atanan gibi UYARI'lar engel değil)
    //          - createdBy personel id'si / bilinen ad / sistem değeri değil ve TEKİL bir personelin koduna indirgenemiyor
    //            (J11.5: biçimine bakılmaz; hiç kimsenin kodu değil ya da birden fazla kişide ortak)
    //          - createdBy bir personelin GEÇERLİ kodu ve aynı zamanda BAŞKA bir kişinin id'si / adı ya da sistem değeri (J11.6
    //            kod / kimlik çakışması) — kod silinmeden önce durdurulur; kod silindikten sonra çakışma tespit edilemez: ESKİDEN burada otomatik 'unknown' yazılırdı — bu, bilgiyi geri dönüşsüz siliyordu ve personel.code
    //            daha önce silinmişse (yarım kalmış bir önceki koşudan) HER ZAMAN 'unknown'a düşüyordu (J11 denetim bulgusu).
    //            Artık böyle kayıtlar plan.blockers.purchaseOrderUnresolved'a düşer; yönetici KAYDI ELLE düzeltmeden plan
    //            hazır sayılmaz, hiçbir alan otomatik 'unknown' yapılmaz.
    //        createdBy bir personelin koduysa ve o kod TEKİL bir kişiye aitse personel id'siyle değiştirilir (plan.purchaseOrders).
    //        SIRA (uygulayan tarafın uyması gereken, ayrıntı applyCodeCleanse'de): purchaseOrders → requests → EN SON personel.
    //        Satırlar kodun KENDİSİNİ içermez (yalnız id/etiket); rapor güvenli.
    function planCodeCleanse({ personel, requests, purchaseOrders, accountEmail, ownershipPendingItems = 0, ownershipIssues = [] }) {
        const index = buildPersonIndex(personel, { accountEmail });
        const label = p => (p && (p.name || p.adSoyad)) || '-';
        const { blocking, warnings } = classifyOwnershipIssues(ownershipIssues);
        const issueLabel = i => `${i.col} · ${i.label} · ${i.field}: ${i.detail || i.status}`;
        const plan = {
            personel: [], requests: [], purchaseOrders: [],
            blockers: { noAccount: [], ownershipPending: ownershipPendingItems, ownershipUnresolved: blocking.map(issueLabel), purchaseOrderUnresolved: [] },
            warnings: { ownershipAdvisory: warnings.map(issueLabel) },
        };
        (personel || []).forEach(p => {
            if (!p || blank(p.id)) return;
            if (accountOf(index, p).status !== 'ok') plan.blockers.noAccount.push(label(p));
            if (!blank(p.code)) plan.personel.push({ id: String(p.id), label: label(p) });
        });
        (requests || []).forEach(r => { if (r && !blank(r.id) && !blank(r.personelKodu)) plan.requests.push({ id: String(r.id), label: `${r.ürün || r.urun || '-'} · ${r.personel || '-'}` }); });
        (purchaseOrders || []).forEach(po => {
            if (!po || blank(po.id) || blank(po.createdBy)) return;
            const by = String(po.createdBy).trim();
            const lbl = `${po.evrakNo || po.urun || '-'} · ${po.createdByName || po.talepEden || '-'}`;
            // J11.6 · P1 (bağımsız denetim): değerin TÜM anlamları birlikte değerlendirilir (byId, byName, sistem değeri, byCode).
            // Eskiden id / ad / sistem değeri eşleşmesi kod kontrolünden ÖNCE "güvenli" sayılıyordu: bir personelin geçerli kodu
            // başka birinin id'si, adı ya da "admin" gibi bir sistem değeriyle aynıysa dönüşüm atlanıyor, personel.code silinince
            // değerin kod olduğu bir daha bilinemiyor ve kapanış temiz görünüyordu. Artık geçerli bir kod, farklı bir kişiyi ya da
            // sistem değerini de gösteriyorsa ENGELDİR — kodlar silinmeden (plan hazır sayılmaz; applyCodeCleanse not-ready). Tüm
            // anlamlar AYNI kişiyi gösteriyorsa (kod = kendi id'si / adı) değer tek anlamlıdır; id / ad kalıcı olduğu için dokunulmaz.
            const sys = isSystemActor(by);
            const idHit = index.byId.get(by) || null;
            const nameHits = index.byName.get(norm(by)) || [];
            const hits = index.byCode.get(by) || [];
            const asIdentity = !!idHit || sys || nameHits.length > 0;
            if (hits.length && asIdentity) {
                const people = new Set([idHit, ...nameHits, ...hits].filter(Boolean).map(p => String(p.id)));
                if (!sys && people.size === 1) return;
                plan.blockers.purchaseOrderUnresolved.push({ id: String(po.id), label: lbl,
                    reason: 'kod / kimlik çakışması: değer birden fazla anlama çözülüyor (bir personelin geçerli kodu ve aynı zamanda başka bir personelin id\'si / adı ya da sistem değeri) — otomatik dönüşüm yapılmaz, kayıt elle düzeltilmeli' });
                return;
            }
            if (asIdentity) return;
            // J11.5 · P1 (bağımsız denetim): biçime bakılmaz (sıfır güven) — personel id'si, bilinen bir ad ya da sistem değeri olarak
            // çözülemeyen HER createdBy ya tekil bir personelin koduna indirgenir ya da ENGELDİR. Rapor değeri içermez (kod olabilir).
            if (hits.length === 1) { plan.purchaseOrders.push({ id: String(po.id), label: lbl, replaceWith: String(hits[0].id) }); return; }
            // Hiç kimsenin kodu değil (silinmiş personel / tanınmayan değer) ya da birden fazla kişide ortak — otomatik YAZILMAZ.
            plan.blockers.purchaseOrderUnresolved.push({ id: String(po.id), label: lbl, reason: hits.length ? 'bu kod birden fazla personelde ortak'
                : 'oluşturan değeri hiçbir personel id\'sine, ada, sistem değerine ya da bugünkü bir koda çözülemiyor — taşıyan personel bulunamadı (eski kod ya da silinmiş personel olabilir)' });
        });
        plan.ready = plan.blockers.noAccount.length === 0 && plan.blockers.ownershipPending === 0
            && plan.blockers.ownershipUnresolved.length === 0 && plan.blockers.purchaseOrderUnresolved.length === 0;
        plan.total = plan.personel.length + plan.requests.length + plan.purchaseOrders.length;
        // "Değişti mi" denetimi (changed-since-preview, applyCodeCleanse): PLANIN KENDİ (zaten kod içermeyen) çıktısından
        // kurulur — id'ler, etiketler (ad; gizli değil) ve çözüm hedefleri (personel id'si). Kodun KENDİSİ hiçbir zaman
        // fingerprint'e girmez; "plan çıktısı kod değerini içermez" kuralı fingerprint alanı için de geçerlidir.
        plan.fingerprint = [
            `p:${plan.personel.map(x => x.id).sort().join(',')}`,
            `r:${plan.requests.map(x => x.id).sort().join(',')}`,
            `po:${plan.purchaseOrders.map(x => `${x.id}=${x.replaceWith}`).sort().join(',')}`,
            `na:${[...plan.blockers.noAccount].sort().join(',')}`,
            `op:${plan.blockers.ownershipPending}`,
            `ou:${plan.blockers.ownershipUnresolved.length}`,
            `pu:${plan.blockers.purchaseOrderUnresolved.map(x => x.id).sort().join(',')}`,
        ].join('|');
        return plan;
    }

    /**
     * J11 · P1 #4: kod temizliğinin iki aşaması. plan: planCodeCleanse sonucu; rows: { requests, purchaseOrders } → [{ id, data }]
     * (sunucudan TAZE okunmuş). Saf: firebase-handler.applyCodeCleanse ve emülatör testi aynı kodu kullanır.
     *   reversible  AtomicWriter girdileri ({col, id, prev, next}; next = önceki belgenin tamamı, yalnız hedef alan değişmiş):
     *               purchaseOrders (eski kimlik dönüşümü — personel.code'a İHTİYAÇ DUYAR) → requests (bağımsız kod kopyası).
     *               Geri alınabilir: hata olursa AtomicWriter önceki hâli yazar (kurallar bu alanların geri yazımına izin verir).
     *   codeIds     personel.code silinecek personel id'leri — EN SON ve AYRI adım. Kurallar silinmiş kodun YENİDEN yazılmasını
     *               reddettiği için bu adım GERİ ALINAMAZ; AtomicWriter'ın günlüklü geri alması burada hiç tamamlanamaz (kilit ve
     *               günlük takılı kalırdı — emülatör testinde bulundu). Bu yüzden yalnız reversible aşama commit edildikten sonra,
     *               ileri yönlü ve idempotent çalışır (deleteCodesForward); yarıda kalırsa yeniden çalıştırma kalanları siler.
     */
    function codeCleanseSteps(plan, rows) {
        const byId = list => new Map((list || []).map(r => [String(r.id), r.data]));
        const rMap = byId(rows.requests), poMap = byId(rows.purchaseOrders);
        const reversible = [];
        plan.purchaseOrders.forEach(x => { const prev = poMap.get(x.id); if (prev) reversible.push({ col: 'purchaseOrders', id: x.id, prev, next: { ...prev, createdBy: x.replaceWith } }); });
        plan.requests.forEach(x => { const prev = rMap.get(x.id); if (prev) { const next = { ...prev }; delete next.personelKodu; reversible.push({ col: 'requests', id: x.id, prev, next }); } });
        return { reversible, codeIds: plan.personel.map(x => x.id) };
    }

    /**
     * J11 · P1 #4: personel.code silme — ileri yönlü, parçalı, idempotent. commit(ids) bir parçayı tek batch'te siler (enjekte
     * edilir). Hata olursa DURUR ve gerçek ilerlemeyi döner; yazılanlar kalıcıdır (kodun yeniden yazımı kurallarca yasak),
     * kalanlar yeniden çalıştırmada silinir. Başarı yalnız tüm parçalar commit edildiğinde bildirilir.
     * @returns {Promise<{deleted:number, remaining:number, error:null|{code,message}}>}
     */
    async function deleteCodesForward({ ids, commit, chunkSize = 400 }) {
        const res = { deleted: 0, remaining: ids.length, error: null };
        for (let i = 0; i < ids.length; i += chunkSize) {
            const part = ids.slice(i, i + chunkSize);
            try { await commit(part); } catch (e) {
                res.error = { code: (e && e.code) || 'write-failed', message: (e && e.message) || 'bilinmeyen hata' };
                return res;
            }
            res.deleted += part.length;
            res.remaining = ids.length - res.deleted;
        }
        return res;
    }

    // ─── Personel erişim kilidi: kapanış denetimi (Faz 4B · J11 · P0) ──────────────────────────────────────
    // [WHY]: Kurallar personel erişimini accessGate/items/staff kilidine bağlar (varsayılan kapalı). Kilit ancak göçün ÜÇ adımı da
    //        (PRI / Hesap Göçü, Sahiplik Göçü, Kod Temizliği) bittiğinde açılmalı; kurallar koleksiyon tarayamadığı için kanıtı
    //        istemci üretir, kural yalnız kanıtın şeklini (sekiz sayı, hepsi 0) doğrular.
    // [HOW]: SAF — çağıran tüm koleksiyonları SUNUCUDAN taze okuyup verir. Sayılar (rapor için ilk 50 etiket):
    //          personelCodes        personel.code dolu                         (Kod Temizliği)
    //          requestCodes         requests.personelKodu dolu                 (Kod Temizliği)
    //          purchaseOrderCodes   kodlu / çözülemeyen purchaseOrders.createdBy (Kod Temizliği; planCodeCleanse ile aynı tespit)
    //          accountsMissing      personelin giriş hesabı yok                (PRI / Hesap Göçü ya da "Hesap Aç")
    //          accountsInconsistent paylaşılan uid / hesap PRI adresinde değil (J7 adresi dahil)
    //          accountMapMismatch   bağlı personelin staffAccounts eşlemesi yok / başka personeli / başka PRI'yi gösteriyor
    //          ownershipPending     Sahiplik Göç Aracı'nın hâlâ yazacağı kayıt
    //          ownershipUnresolved  sahiplik alanı (personelUid / createdByUid / creatorUid) çözülemeyen kayıt (sistem / rol
    //                               değerleri hariç) + dolu uid'si bugünkü hesaptan farklı her alan
    //        Onay adımı / atanan uid'si çözülemeyen kayıtlar engel değil uyarıdır (warnings): o adımları yalnız yönetici onaylar.
    const CLOSURE_CHECKS = Object.freeze(['personelCodes', 'requestCodes', 'purchaseOrderCodes', 'accountsMissing', 'accountsInconsistent',
        'accountMapMismatch', 'ownershipPending', 'ownershipUnresolved']);
    function planStaffAccessClosure({ data = {}, personel = [], staffAccounts = [], accountEmail } = {}) {
        const index = buildPersonIndex(personel, { accountEmail });
        const checks = {}, details = {};
        CLOSURE_CHECKS.forEach(k => { checks[k] = 0; details[k] = []; });
        const add = (k, text) => { checks[k]++; if (details[k].length < 50) details[k].push(text); };
        const maps = new Map((staffAccounts || []).filter(m => m && !blank(m.id)).map(m => [String(m.id), m]));
        (personel || []).forEach(p => {
            if (!p || typeof p !== 'object' || blank(p.id)) return;
            if (!blank(p.code)) add('personelCodes', label(p));
            const acct = accountOf(index, p);
            if (acct.status === 'no-account') add('accountsMissing', label(p));
            else if (acct.status !== 'ok') add('accountsInconsistent', `${label(p)} — ${acct.detail}`);
            if (!blank(p.uid)) {
                const m = maps.get(String(p.uid));
                if (!m) add('accountMapMismatch', `${label(p)} — kimlik eşlemesi yok`);
                else if (String(m.personelId) !== String(p.id)) add('accountMapMismatch', `${label(p)} — eşleme başka bir personeli gösteriyor`);
                else if (String(m.pri || '') !== String(p.pri || '')) add('accountMapMismatch', `${label(p)} — eşlemedeki PRI personel kaydındakinden farklı`);
            }
        });
        // J11 · P1: planCodeCleanse artık kendi ownership girdisi beklemiyor (bu çağrıda verilmiyor) — yalnız personel.code /
        // requests.personelKodu / purchaseOrders.createdBy taramasını kullanıyoruz. Çözülemeyen createdBy (purchaseOrderUnresolved)
        // da kodlu sayılır: temizlik bitmeden kilit açılmamalı.
        const cleanse = planCodeCleanse({ personel, requests: data.requests || [], purchaseOrders: data.purchaseOrders || [], accountEmail });
        cleanse.requests.forEach(r => add('requestCodes', r.label));
        [...cleanse.purchaseOrders, ...cleanse.blockers.purchaseOrderUnresolved].forEach(r => add('purchaseOrderCodes', r.label));
        const own = planMigration({ data, personel, accountEmail });
        own.items.forEach(it => add('ownershipPending', `${it.col} · ${it.label}`));
        const { blocking, warnings } = classifyOwnershipIssues(own.issues);
        blocking.forEach(i => add('ownershipUnresolved', `${i.col} · ${i.label} · ${i.field}: ${i.detail || i.status}`));
        const warningLabels = warnings.map(i => `${i.col} · ${i.label} · ${i.field}: ${i.detail || i.status}`);
        const scanned = { personel: (personel || []).length, staffAccounts: (staffAccounts || []).length };
        MIGRATION_COLLECTIONS.forEach(c => { scanned[c] = (data[c] || []).length; });
        return { checks, details, warnings: warningLabels.slice(0, 50), warningCount: warningLabels.length, scanned,
            ready: CLOSURE_CHECKS.every(k => checks[k] === 0) };
    }

    const Ownership = {
        OWNER_FIELDS, MIGRATION_COLLECTIONS, CHUNK_SIZE, SYSTEM_ACTORS, CLOSURE_CHECKS,
        buildPersonIndex, accountOf, resolveOwner, uidForName, planDoc, planMigration, applyMigration, ownerGuard,
        personelFingerprint, isSystemActor, classifyOwnershipIssues, planCodeCleanse, codeCleanseSteps, deleteCodesForward, planStaffAccessClosure,
        selfUid, actorUid, uidForPersonName, selfName,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.Ownership = Ownership;
    window.Ownership = Ownership;
})();
