// Tanımlar ekranındaki pilot belge türü ve süreç eşlemesi.
(function () {
    'use strict';
    window.renderEBYSDocumentTypes = function () {
        const body = document.getElementById('ebysDocumentTypesBody');
        if (!body) return;
        body.replaceChildren();
        for (const type of window.AppModules.EBYSDocumentTypes.types) {
            const row = document.createElement('tr');
            for (const value of [type.code, type.name, type.direction, type.route, type.available ? 'Pilot kullanımda' : 'Sonraki aşama']) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.append(cell);
            }
            body.append(row);
        }
    };
})();
