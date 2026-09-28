/**
 * utils/schema.js — Veri şeması yardımcıları (klasik script, iki sayfada <head>'de html.js'ten hemen sonra)
 * Faz 3.3: makeId. Faz 3.6'da normalizeB3 / normalizeStock / normalizeRequest / isDemirbas buraya eklenecek.
 */
// [WHY]: Kayıt id'leri Date.now(), Date.now()+Math.random() (ondalıklı id) ve 'temp_…' ile üretiliyordu; aynı milisaniyede
//        oluşan iki kayıt aynı dokümana düşüp merge ile birleşebiliyordu (DATA-12).
// [HOW]: makeId() sayısal ve zaman sıralı bir id döner: Date.now()·1000 + 0–999 arası rastgele sayı; aynı sekmede her
//        çağrı bir öncekinden büyüktür (tekrar yok). 2^53 sınırının altında kalır (~2255 yılına kadar).
//        Bilinçli olarak UUID değil: kodda Number(x.id) === Number(id) karşılaştırmaları ve b.id - a.id sıralamaları var;
//        UUID bunları sessizce bozardı (NaN). Id karşılaştırmaları String'e çevrildiğinde (Faz 3 H2) UUID'ye geçilebilir.
(function () {
    let last = 0;

    function makeId() {
        let id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        if (id <= last) id = last + 1;
        last = id;
        return id;
    }

    window.AppModules = window.AppModules || {};
    window.AppModules.Schema = Object.assign(window.AppModules.Schema || {}, { makeId });
    window.makeId = makeId;
})();
