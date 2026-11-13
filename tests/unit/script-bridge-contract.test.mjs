// v3.7 · İP-0 — script.js SoC ayrıştırmasının güvenlik ağı (köprü sözleşmesi).
// [WHY]: script.js'teki bloklar (Sepet, B3, Personel, Talepler, İçe/Dışa aktarma) ayrı klasik dosyalara taşınırken
//        inline onclick="...", JS ile üretilen onclick metinleri, diğer modüller ve testler aynı global adlara güvenir.
//        Bir ad kaybolursa hata yalnız o düğmeye basıldığında görülür; smoke testi bunu yakalamaz.
// [HOW]: Gerçek Chrome'da script.js ve ardından yüklenen klasik zincir sırayla yüklenir. Taşıma öncesi (v3.6 HEAD)
//        script.js'in window'a eklediği her ad aynı tiple hâlâ vardır; paylaşılan üst düzey let/const'lar global
//        kapsamdadır; her yeni AppModules ad alanı köprüyle AYNI fonksiyonu taşır; index.html ve admin.html zinciri
//        script.js'ten hemen sonra aynı sırayla yükler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

// Taşıma öncesi script.js'in window'a eklediği adlar (v3.6 HEAD 0a40263'ten Chrome'da çıkarıldı).
const WINDOW_CONTRACT = {
    function: ['_applyB3ViewState', '_b3ActionButtons', '_b3DayLabel', '_b3DayParts', '_b3SearchText', '_bindPriSuggestion',
        '_bulkDeleteSelected', '_exportB3PDF', '_fillUnitSelect', '_getB3Rows', '_isDraftRequest', '_renderB3Cards', '_renderB3Table',
        '_stopIfLinkedMovement', '_toggleCardGroup', 'addExit', 'addPersonel', 'addToCart', 'bulkDelete', 'bulkDeleteB3', 'changePage',
        'checkAdminAndGo', 'checkIsAdmin', 'checkIsDemirbas', 'clearRowSelection', 'closeExitModal', 'closeMobileBottomSheet', 'closeModal',
        'closePersonelModal', 'closeProductModal', 'closeRequestModal', 'closeTransferModal', 'composeRejectReason', 'confirmRequest',
        'confirmTransfer', 'deleteB3Row', 'deleteItem', 'deleteRequest', 'deleteSelectedRequests', 'editPersonel',
        'editPersonnelInventoryRequest', 'exportPDF', 'exportTableToExcel', 'exportToExcel', 'getActiveProductTypes', 'getProcessedData',
        'getRandomCode', 'getTurkiyeSaati', 'getTurkiyeTarihi', 'handleLogin', 'handleTransferTargetChange', 'handleTypeChange',
        'hideRowTooltip', 'importExcel', 'isDraftRequest', 'moveRowTooltip', 'normalizeB3Row', 'onReqTypeChange', 'openCartModal',
        'openExitModal', 'openModal', 'openPersonelAccount', 'openPersonelModal', 'openProductModal', 'openRequestModal', 'openTab',
        'openTemplateModal', 'openTransferModal', 'patchDOMForCollection', 'receiveProduct', 'rejectRequest', 'removeFromCart',
        'renderCardSearchResults', 'renderCartItems', 'renderExitTable', 'renderMobileCards', 'renderMyRequestsTable',
        'renderPersonnelInventoryTable', 'renderRequestsTable', 'renderSearchResults', 'renderTable', 'requestOutcome', 'saveCartExit',
        'saveExit', 'saveProduct', 'searchForCart', 'searchForExit', 'searchForRequest', 'searchTable', 'selectProduct', 'sendArchiveEmail',
        'sendDraftInventoryRequest', 'setupRowSelection', 'setupUI', 'showImportFormatHelp', 'showMobileBottomSheet', 'showMobileTooltip',
        'showRequestApprovalModal', 'showRequestRejectModal', 'showRowTooltip', 'showStaffCodeOnce', 'showUndoNotice', 'sortTable',
        'startWorkflow', 'switchTab', 'toggleAllRequests', 'toggleB3CardView', 'toggleB3Help', 'toggleCardView', 'toggleSelectAll',
        'toggleWatch', 'tsToTurkiye', 'updateCartQty', 'updateFloatingBar', 'updateNavbarUI', 'updateStock', 'validateAdminAction',
        'viewWorkflow', 'withdrawInventoryRequest', 'onclick'],
    object: ['AppModules', 'REQUEST_REJECT_REASONS', '_cardViewActive', '_dx', 'currentUser', 'data'],
    boolean: ['isAdminPanel', 'isFirebaseLoaded']
};

// table-engine.js, ui-components.js, inventory-logic.js, main.js ve shelf-matrix.js bunları global kapsamdan okur.
const SHARED_LEXICALS = { TZ: 'string', currentSortColumn: 'string', isAscending: 'boolean', currentPage: 'number',
    currentExitRepo: 'string', currentExitIndex: 'string', pageSize: 'number', INV_CONFIG: 'object' };

// script.js'ten hemen sonra, iki sayfada da bu sırayla yüklenen klasik dosyalar.
const CLASSIC_CHAIN = ['script.js', 'src/ui/stock-exit-cart.js'];

// Yeni ad alanı → köprü adları. Her anahtar window'daki köprüyle aynı fonksiyon referansıdır (tek kaynak).
const NAMESPACES = {
    ExitCart: ['openCartModal', 'searchForCart', 'addToCart', 'removeFromCart', 'renderCartItems', 'updateCartQty', 'saveCartExit',
        'searchForExit'],
};

function localClassicScripts(file) {
    const html = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    return [...html.matchAll(/<script\b([^>]*)>/g)]
        .map(m => m[1])
        .filter(attrs => !/type\s*=\s*["']module["']/.test(attrs))
        .map(attrs => (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/) || [])[1])
        .filter(src => src && !/^(https?:)?\/\//.test(src))
        .map(src => src.split('?')[0]);
}

for (const page of ['index.html', 'admin.html']) {
    test(`${page}: klasik zincir script.js'ten hemen sonra ve aynı sırayla yüklenir`, () => {
        const scripts = localClassicScripts(page);
        const at = scripts.indexOf('script.js');
        assert.ok(at >= 0, 'script.js bulunamadı');
        assert.deepEqual(scripts.slice(at, at + CLASSIC_CHAIN.length), CLASSIC_CHAIN);
        CLASSIC_CHAIN.forEach(src => assert.equal(scripts.filter(s => s === src).length, 1, `${src} tek kez yüklenmeli`));
    });
}

test('script.js + klasik zincir: taşıma öncesi global sözleşme, paylaşılan let/const ve ad alanları korunur', async () => {
    const executablePath = process.env.CHROME_EXECUTABLE_PATH || process.env.CHROME_PATH || [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        '/usr/bin/google-chrome', '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ].find(existsSync);
    const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        // Gerçek bir origin gerekir: script.js yüklenirken localStorage'a erişir.
        await page.setRequestInterception(true);
        page.on('request', r => r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><body></body>' }));
        await page.goto('http://contract.test/');
        await page.evaluate(() => { window.getActiveUser = () => null; });
        for (const src of CLASSIC_CHAIN) await page.addScriptTag({ content: readFileSync(src, 'utf8') });
        assert.deepEqual(errors, []);

        const result = await page.evaluate((contract, lexicals, namespaces) => {
            const wrongType = [];
            for (const [type, names] of Object.entries(contract)) {
                names.forEach(n => { if (typeof window[n] !== type) wrongType.push(`${n}: ${typeof window[n]} (beklenen ${type})`); });
            }
            const lexical = Object.entries(lexicals)
                .filter(([n, type]) => (0, eval)(`typeof ${n}`) !== type)
                .map(([n, type]) => `${n}: ${(0, eval)(`typeof ${n}`)} (beklenen ${type})`);
            const ns = [];
            for (const [name, keys] of Object.entries(namespaces)) {
                const api = window.AppModules[name];
                if (!api || !Object.isFrozen(api)) { ns.push(`AppModules.${name} yok ya da dondurulmamış`); continue; }
                keys.forEach(k => { if (typeof api[k] !== 'function' || api[k] !== window[k]) ns.push(`AppModules.${name}.${k} ≠ window.${k}`); });
            }
            return { wrongType, lexical, ns };
        }, WINDOW_CONTRACT, SHARED_LEXICALS, NAMESPACES);
        assert.deepEqual(result, { wrongType: [], lexical: [], ns: [] });
    } finally {
        await browser.close();
    }
});
