// v3.4 EBYS H7 · D1 — Yazışma ve takip saf şeması (gönderim kanalları, mükerrer anahtarı, İlgi satırı ve cevap bağı).
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const window = {};
const context = vm.createContext({ window, crypto: webcrypto, TextEncoder });
for (const f of ['src/utils/ebys-document-schema.js', 'src/utils/ebys-correspondence-schema.js']) {
    vm.runInContext(readFileSync(f, 'utf8'), context);
}
const S = window.AppModules.EBYSCorrespondenceSchema;
const D = window.AppModules.EBYSDocumentSchema;
const plain = v => JSON.parse(JSON.stringify(v));

test('H7 D1 · gönderim kanalları ve gönderim kaydı doğrulaması: gelecek tarih, HTML ve eksik düzeltme notu reddedilir', () => {
    assert.deepEqual(plain(S.CHANNEL_KEYS), ['hand', 'post', 'courier', 'kep', 'email', 'other']);
    assert.equal(S.CHANNELS.kep, 'KEP — Manuel beyan');

    const docId = webcrypto.randomUUID();
    const verId = webcrypto.randomUUID();
    const ok = S.normalizeDispatch({
        documentId: docId,
        versionId: verId,
        channel: 'kep',
        sentDate: '2026-11-17',
        externalRef: ' KEP-2026-001 ',
        note: '',
        entryKind: 'initial'
    }, '2026-11-17');
    assert.deepEqual(plain(ok), {
        documentId: docId,
        versionId: verId,
        channel: 'kep',
        sentDate: '2026-11-17',
        externalRef: 'KEP-2026-001',
        note: '',
        entryKind: 'initial'
    });

    const correction = S.normalizeDispatch({
        documentId: docId,
        versionId: verId,
        channel: 'post',
        sentDate: '2026-11-16',
        externalRef: 'PTT-9988',
        note: 'Takip numarası düzeltildi',
        entryKind: 'correction'
    }, '2026-11-17');
    assert.equal(correction.entryKind, 'correction');

    for (const bad of [
        { channel: 'fax' },
        { sentDate: '2026-11-18' }, // gelecek tarih
        { sentDate: '2026-02-30' }, // geçersiz takvim günü
        { externalRef: '' },
        { externalRef: 'x'.repeat(121) },
        { externalRef: '<script>x</script>' },
        { note: 'x'.repeat(501) },
        { note: '<b>etiket</b>' },
        { entryKind: 'correction', note: '   ' }, // düzeltmede not zorunlu
        { entryKind: 'unknown' },
        { documentId: 'bad-id' },
        { versionId: 'bad-id' }
    ]) {
        assert.throws(() => S.normalizeDispatch({
            documentId: docId,
            versionId: verId,
            channel: 'hand',
            sentDate: '2026-11-17',
            externalRef: 'REF-1',
            note: 'Not',
            entryKind: 'initial',
            ...bad
        }, '2026-11-17'), undefined, JSON.stringify(bad));
    }
});

test('H7 D1 · gelen evrak mükerrer anahtarı: tr-TR küçük harf ve noktalama sadeleştirmesi; eksik alanda null', async () => {
    assert.equal(await S.incomingDuplicateKey({ correspondent: 'Kurum', externalRegistrationNo: '', date: '2026-11-17' }), null);
    assert.equal(await S.incomingDuplicateKey({ correspondent: '', externalRegistrationNo: '123', date: '2026-11-17' }), null);
    assert.equal(await S.incomingDuplicateKey({ correspondent: 'Kurum', externalRegistrationNo: '123', date: '' }), null);
    assert.equal(await S.incomingDuplicateKey({ correspondent: '...', externalRegistrationNo: '123', date: '2026-11-17' }), null);

    const k1 = await S.incomingDuplicateKey({
        correspondent: '  İSTANBUL   İL SAĞLIK MÜDÜRLÜĞÜ ',
        externalRegistrationNo: 'E-123 / 456 - 78',
        date: '2026-11-17'
    });
    const k2 = await S.incomingDuplicateKey({
        correspondent: 'istanbul il sağlık müdürlüğü.',
        externalRegistrationNo: 'e 123 456 78',
        date: '2026-11-17'
    });
    const k3 = await S.incomingDuplicateKey({
        correspondent: 'istanbul il sağlık müdürlüğü',
        externalRegistrationNo: 'e 123 456 79',
        date: '2026-11-17'
    });
    assert.match(k1, /^[a-f0-9]{64}$/);
    assert.equal(k1, k2, 'büyük/küçük Türkçe harf ve noktalama farkı aynı anahtarı üretir');
    assert.notEqual(k1, k3, 'farklı dış sayı farklı anahtar üretir');
});

test('H7 D1 · cevap bağı ve İlgi satırı biçimlendirici', () => {
    const regNo = D.registrationNo('MED', new Date('2026-11-17T10:00:00Z'));
    assert.equal(S.isRegistrationNo(regNo), true);
    assert.equal(S.isRegistrationNo('TASLAK-1'), false);

    const summary = S.normalizeReplySummary({
        registrationNo: regNo,
        externalRegistrationNo: 'B.10.0.1234',
        date: '2026-11-15',
        correspondent: 'Sağlık Bakanlığı',
        subject: 'Cihaz Bildirimi'
    });
    assert.equal(
        S.formatInterestLine(summary),
        'İlgi: 2026-11-15 tarihli ve B.10.0.1234 sayılı yazınız (Sağlık Bakanlığı).'
    );
    const fallbackSummary = S.normalizeReplySummary({ ...summary, externalRegistrationNo: '' });
    assert.equal(
        S.formatInterestLine(fallbackSummary),
        `İlgi: 2026-11-15 tarihli ve ${regNo} sayılı yazınız (Sağlık Bakanlığı).`
    );

    const replyId = webcrypto.randomUUID();
    const targetId = webcrypto.randomUUID();
    const targetVerId = webcrypto.randomUUID();
    const link = S.normalizeReplyLink({
        replyDocumentId: replyId,
        replyToDocumentId: targetId,
        replyToVersionId: targetVerId,
        replyOwnerUid: 'u1',
        replyToOwnerUid: 'u2',
        replyToSummary: summary
    });
    assert.equal(link.id, replyId);
    assert.throws(() => S.normalizeReplyLink({
        replyDocumentId: replyId,
        replyToDocumentId: replyId,
        replyToVersionId: targetVerId,
        replyOwnerUid: 'u1',
        replyToOwnerUid: 'u2',
        replyToSummary: summary
    }), /kendisine/);
});

