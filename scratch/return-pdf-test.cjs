// Faz 6 · İade tutanağı PDF (AssignmentService.generateReturnData + pdf-generator.js generateReturnPDF).
// Gerçek jsPDF + AutoTable (CDN) + gömülü Türkçe (Roboto) fontla, gerçek schema.js/assignment-service.js/pdf-generator.js
// dosyalarıyla çalışır. doc.save() stub'lanır (gerçek indirme tetiklenmez) — bkz. scratch/flow-tests.js k1ZimmetPdf.
// Usage: node scratch/return-pdf-test.cjs
const fs = require('node:fs'), puppeteer = require('puppeteer');

const SEED = {
    personel: [{ id: 's1', name: 'Ayşe Yılmaz', birim: 'Bilgi İşlem' }],
    b1: [], b2: [], requests: [],
    b3: [
        { id: 'z1', sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: 'p1', requestId: null, rafNo: 'R1', sutun: 'S1',
          urunTuru: 'Laptop', urunAciklama: 'Latitude 5440', marka: 'Dell', adet: 1, sn: 'SN-LAT-001', envanterNo: 'ENV-501',
          not: '-', alanKisi: 'Ayşe Yılmaz', personelId: 's1', tarih: '01.10.2026', ts: 1000, isDemirbas: true,
          talepTuru: 'Kalıcı Zimmet', oncelik: 'Orta', iadeTarihi: null, iadeEdildi: true, iadeEdildiTarihi: '06.11.2026 10:05',
          iadeDepo: 'b1', onaylayan: 'Admin' },
        { id: 'z2', sema: 2, tip: 'zimmet', kaynakDepo: 'b1', productId: null, requestId: null, rafNo: 'R2', sutun: 'S2',
          urunTuru: 'Monitör', urunAciklama: 'Monitör 24"', marka: 'LG', adet: 1, sn: '-', envanterNo: 'ENV-900',
          not: '-', alanKisi: 'Ayşe Yılmaz', personelId: 's1', tarih: '20.09.2026', ts: 900, isDemirbas: true,
          talepTuru: 'Kalıcı Zimmet', oncelik: 'Düşük', iadeTarihi: null, iadeEdildi: true, iadeEdildiTarihi: '05.11.2026 09:00',
          iadeDepo: null, onaylayan: 'Admin' },
    ],
    returnRequests: [
        { id: 'ret_z1', zimmetId: 'z1', personelId: 's1', personel: 'Ayşe Yılmaz', personelUid: 'uid-s1', urun: 'Latitude 5440',
          sn: 'SN-LAT-001', envanterNo: 'ENV-501', kaynakDepo: 'b1', productId: 'p1', gerekce: 'Arıza',
          aciklama: 'Ekran titriyor, menteşe gevşek.', bildirilenDurum: 'Arızalı', durum: 'approved', tarih: '06.11.2026 09:00',
          ts: 2000, teslimAlindi: true, iadeDepo: 'b1', stogaEklendi: false, adminCihazDurumu: 'Arızalı', adminNotu: '',
          kapanisAciklamasi: '', onaylayan: 'Sistem Yöneticisi', onayTarihi: '06.11.2026 10:05' },
        { id: 'ret_z2', zimmetId: 'z2', personelId: 's1', personel: 'Ayşe Yılmaz', personelUid: 'uid-s1', urun: 'Monitör 24"',
          sn: '-', envanterNo: 'ENV-900', kaynakDepo: 'b1', productId: null, gerekce: 'Ayrılış / görev değişikliği',
          aciklama: '-', bildirilenDurum: 'Eksik parça', durum: 'approved', tarih: '05.11.2026 08:00', ts: 1500,
          teslimAlindi: false, iadeDepo: null, stogaEklendi: false, adminCihazDurumu: 'Eksik parça',
          adminNotu: 'Kurye ile gönderilecek.', kapanisAciklamasi: 'Personel ayrıldı; cihaz teslim edilmedi, kayıp tutanağı açıldı.',
          onaylayan: 'Sistem Yöneticisi', onayTarihi: '05.11.2026 09:00' },
        { id: 'ret_bek', zimmetId: 'z3', personelId: 's1', personel: 'Ayşe Yılmaz', personelUid: 'uid-s1', urun: 'Klavye',
          sn: '-', envanterNo: '-', kaynakDepo: 'b1', productId: null, gerekce: 'İhtiyaç kalmadı', aciklama: '-',
          bildirilenDurum: 'Çalışır', durum: 'Beklemede', tarih: '06.11.2026 08:00', ts: 1800 },
    ],
};

(async () => {
    const browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const report = [];
    const ok = (name, detail = '') => { const line = `✔ ${name}${detail ? ` — ${detail}` : ''}`; report.push(line); if (process.env.E2E_VERBOSE) console.log(line); };
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setRequestInterception(true);
        page.on('request', r => {
            const u = new URL(r.url());
            if (u.hostname === 'cdnjs.cloudflare.com') return r.continue();   // jsPDF + AutoTable: gerçek ağ
            if (u.pathname === '/page') return r.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>' });
            const f = decodeURIComponent(u.pathname.slice(1));
            if (fs.existsSync(f) && /\.js$/.test(f)) return r.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) });
            return r.respond({ status: 200, contentType: 'text/plain', body: '' });
        });
        await page.goto('http://127.0.0.1/page');
        for (const src of [
            'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
            'http://127.0.0.1/src/utils/schema.js',
            'http://127.0.0.1/src/services/assignment-service.js',
            'http://127.0.0.1/pdf-generator.js',
        ]) await page.addScriptTag({ url: src });
        await page.waitForFunction(() => window.jspdf && window.AssignmentService && typeof window.generateReturnPDF === 'function');

        const result = await page.evaluate(async seed => {
            window.data = JSON.parse(JSON.stringify(seed));
            const alerts = []; window.showAppAlert = (msg, type) => alerts.push({ msg, type });
            const JsPDFCtor = window.jspdf.jsPDF;
            const saves = [];
            // jsPDF her 'new jsPDF()' çağrısında API yöntemlerini örneğe kopyalar; kaynak jsPDF.API.save'dir.
            JsPDFCtor.API.save = function (filename) {
                saves.push({ filename, pages: this.internal.getNumberOfPages(), fonts: Object.keys(this.getFontList()), dataUri: this.output('datauristring') });
                return this;
            };
            await window.generateReturnPDF('ret_z1');   // teslim alındı, stoğa eklenmedi
            await window.generateReturnPDF('ret_z2');   // teslim alınmadı (kapanış açıklaması)
            await window.generateReturnPDF('ret_bek');  // bekleyen → null veri, uyarı, save yok
            await window.generateReturnPDF('yok');      // bulunamadı → uyarı, save yok
            return { saves, alerts };
        }, SEED);

        if (errors.length) throw new Error('Sayfa hatası: ' + errors.join(' | '));
        const [z1, z2] = result.saves;
        if (result.saves.length !== 2) throw new Error('Beklenen 2 kayıtlı PDF (ret_z1, ret_z2), gelen: ' + result.saves.length);
        if (!/^Iade_Tutanagi_Ayşe Yılmaz_IT-/.test(z1.filename)) throw new Error('Dosya adı beklenmiyor: ' + z1.filename);
        if (z1.pages !== 1) throw new Error('ret_z1 tek sayfa olmalıydı: ' + z1.pages);
        if (!z1.fonts.includes('Roboto')) throw new Error('Roboto fontu gömülü değil: ' + z1.fonts.join(','));
        ok('İade tutanağı (teslim alındı, arızalı, stoğa eklenmedi): 1 sayfa, Roboto gömülü, dosya adı "Iade_Tutanagi_Ayşe Yılmaz_IT-…"');
        if (z2.pages !== 1) throw new Error('ret_z2 tek sayfa olmalıydı: ' + z2.pages);
        ok('İade tutanağı (teslim alınmadı — kapanış açıklamalı): tek imza (Onaylayan) bloğuyla da 1 sayfada üretiliyor');
        if (result.alerts.length !== 2 || !result.alerts.every(a => a.type === 'error')) throw new Error('Beklenen 2 hata uyarısı: ' + JSON.stringify(result.alerts));
        if (!/onaylanmış olmalı/.test(result.alerts[0].msg)) throw new Error('Bekleyen talep için beklenen uyarı metni yok: ' + result.alerts[0].msg);
        ok('Bekleyen talepte ve bulunamayan kayıtta tutanak üretilmez; kullanıcıya hata olarak bildirilir, save() çağrılmaz');
        if (process.argv[2]) {
            for (const [name, s] of [['iade-tutanak-teslim-alindi', z1], ['iade-tutanak-teslim-alinmadi', z2]]) {
                fs.writeFileSync(`${process.argv[2]}/${name}.pdf`, Buffer.from(s.dataUri.split(',')[1], 'base64'));
            }
        }
    } finally { await browser.close(); }
    console.log(report.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
