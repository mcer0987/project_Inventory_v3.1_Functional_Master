(function () {
    'use strict';
    const kinds = ['paraf', 'approval', 'consent'];
    function route(input) {
        if (!Array.isArray(input) || !input.length || input.length > 6) throw new Error('Rota 1–6 adım içermeli.');
        return input.map((step, index) => {
            if (step.kind === 'e_sign') throw new Error('Gerçek e-imza sağlayıcısı henüz bağlı değil.');
            if (!kinds.includes(step.kind) || !/^[^/]{1,128}$/.test(String(step.personnelId || ''))) throw new Error(`${index + 1}. adım geçersiz.`);
            const dueHours = Number(step.dueHours || 72);
            if (!Number.isInteger(dueHours) || dueHours < 1 || dueHours > 720) throw new Error('Görev süresi 1–720 saat olmalı.');
            return { stepId: `step-${index}`, personnelId: String(step.personnelId), kind: step.kind, dueHours };
        });
    }
    function reason(result, value) {
        if (!['approved', 'rejected', 'returned'].includes(result)) throw new Error('Karar geçersiz.');
        const text = String(value || '').trim();
        if ((result !== 'approved' && !text) || text.length > 1000 || /<[a-zA-Z/!?]/.test(text)) throw new Error('Geçerli bir gerekçe girin (en fazla 1000 karakter).');
        return text;
    }
    window.AppModules = window.AppModules || {};
    window.AppModules.EBYSProcessSchema = Object.freeze({ route, reason, kinds });
})();
