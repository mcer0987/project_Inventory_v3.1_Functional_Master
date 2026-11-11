// Belge türü, ürün türünden ve dosya planı kodundan ayrı bir süreç tanımıdır.
// Genel destek, satın alma formunda seçilebilirlikten ayrıdır.
(function () {
    'use strict';
    const types = Object.freeze([
        Object.freeze({ code: 'PURCHASE_REQUEST', name: 'Satın Alma Talebi', direction: 'Kurum içi', route: 'Satın Alma ekranı', supported: true, purchaseSelectable: true }),
        Object.freeze({ code: 'INCOMING_DOCUMENT', name: 'Gelen Evrak', direction: 'Gelen', route: 'Evrak Kayıt Defteri → Gelen Evrak Defteri', supported: true }),
        Object.freeze({ code: 'OUTGOING_DOCUMENT', name: 'Giden Evrak', direction: 'Giden', route: 'Evrak Kayıt Defteri → Giden Evrak Defteri', supported: true }),
        Object.freeze({ code: 'INTERNAL_CORRESPONDENCE', name: 'İç Yazışma', direction: 'Kurum içi', route: 'Evrak Kayıt Defteri → İç Yazışmalar', supported: true }),
        Object.freeze({ code: 'APPROVAL_OLUR', name: 'Olur / Onay Belgesi', direction: 'Kurum içi', route: 'Olur, onay rotasında adım olarak kullanılabilir', supported: false }),
        Object.freeze({ code: 'COVER_LETTER', name: 'Üst Yazı', direction: 'Giden / kurum içi', route: 'Evrak düzenleyicisinde üst yazı / evrak gövdesi alanı', supported: false }),
    ]);
    const byCode = code => types.find(type => type.code === code) || null;
    window.AppModules = window.AppModules || {};
    window.AppModules.EBYSDocumentTypes = Object.freeze({ types, byCode, purchaseCode: 'PURCHASE_REQUEST' });
})();
