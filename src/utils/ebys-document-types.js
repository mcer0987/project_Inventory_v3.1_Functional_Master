// Belge türü, ürün türünden ve dosya planı kodundan ayrı bir süreç tanımıdır.
// Pilot dışında kalan türler tanım kataloğunda görünür; henüz başlatılabilir sayılmaz.
(function () {
    'use strict';
    const types = Object.freeze([
        Object.freeze({ code: 'PURCHASE_REQUEST', name: 'Satın Alma Talebi', direction: 'Kurum içi', route: 'Satın alma onay akışı', available: true }),
        Object.freeze({ code: 'INCOMING_DOCUMENT', name: 'Gelen Evrak', direction: 'Gelen', route: 'Kayıt → havale → işlem', available: false }),
        Object.freeze({ code: 'OUTGOING_DOCUMENT', name: 'Giden Evrak', direction: 'Giden', route: 'Taslak → imza → gönderim', available: false }),
        Object.freeze({ code: 'INTERNAL_CORRESPONDENCE', name: 'İç Yazışma', direction: 'Kurum içi', route: 'Taslak → paraf/imza → dağıtım', available: false }),
        Object.freeze({ code: 'APPROVAL_OLUR', name: 'Olur / Onay Belgesi', direction: 'Kurum içi', route: 'Hazırlık → uygun görüş → olur', available: false }),
        Object.freeze({ code: 'COVER_LETTER', name: 'Üst Yazı', direction: 'Giden / kurum içi', route: 'İlgili evrak sürecine bağlı', available: false }),
    ]);
    const byCode = code => types.find(type => type.code === code) || null;
    window.AppModules = window.AppModules || {};
    window.AppModules.EBYSDocumentTypes = Object.freeze({ types, byCode, purchaseCode: 'PURCHASE_REQUEST' });
})();
