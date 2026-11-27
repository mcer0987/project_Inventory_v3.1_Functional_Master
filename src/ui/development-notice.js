(function () {
    // [WHY]: v3.8 · VP-3 ile passwordResetRequest, temporaryPinLogin ve staffAccountRoadmap hayata geçirildi.
    //        Yalnız Firebase Storage (Blaze planı) gerektiren purchaseFileUpload yer tutucu olarak kalır.
    const notices = Object.freeze({
        purchaseFileUpload: {
            title: 'Dosya yükleme şu anda kullanılamıyor',
            status: 'Bu dağıtımda kullanılamıyor',
            description: 'Satın alma talebine dosya eklemek için Firebase Storage gerekir. Mevcut Spark yapılandırmasında Storage etkin değil; ücretli plana geçiş yapılmadı. Talebi dosya eklemeden kaydedebilirsiniz.'
        }
    });

    let dialog;
    let title;
    let status;
    let description;

    function createDialog() {
        dialog = document.createElement('dialog');
        dialog.id = 'developmentNoticeDialog';
        dialog.setAttribute('aria-labelledby', 'developmentNoticeTitle');
        dialog.setAttribute('aria-describedby', 'developmentNoticeStatus developmentNoticeDescription');
        dialog.style.cssText = 'max-width:min(32rem, calc(100vw - 2rem)); width:calc(100% - 2rem); padding:1.5rem; border:0; border-radius:1rem; box-shadow:0 1rem 3rem rgba(0,0,0,.25); color:#172033;';

        title = document.createElement('h2');
        title.id = 'developmentNoticeTitle';
        title.style.cssText = 'margin:0 0 .75rem; font-size:1.25rem;';

        status = document.createElement('p');
        status.id = 'developmentNoticeStatus';
        status.style.cssText = 'margin:0 0 .5rem; font-weight:700; color:#92400e;';

        description = document.createElement('p');
        description.id = 'developmentNoticeDescription';
        description.style.cssText = 'margin:0 0 1.25rem; white-space:pre-line; line-height:1.5;';

        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Kapat';
        close.style.cssText = 'min-height:2.75rem; padding:.5rem 1rem; border:0; border-radius:.5rem; background:#1d4ed8; color:white; font:inherit; cursor:pointer;';
        close.addEventListener('click', () => dialog.close());

        dialog.append(title, status, description, close);
        dialog.addEventListener('click', event => {
            if (event.target === dialog) dialog.close();
        });
        document.body.appendChild(dialog);
    }

    window.showDevelopmentNotice = function (feature) {
        const notice = notices[feature];
        if (!notice) throw new Error(`Bilinmeyen geliştirme bildirimi: ${feature}`);
        if (!dialog || !dialog.isConnected) createDialog();
        title.textContent = notice.title;
        status.textContent = notice.status;
        description.textContent = notice.description;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else throw new Error('Geliştirme bildirimi penceresi bu tarayıcıda desteklenmiyor.');
    };

    window.AppModules = window.AppModules || {};
    window.AppModules.DevelopmentNotices = Object.freeze({ features: Object.keys(notices) });
})();
