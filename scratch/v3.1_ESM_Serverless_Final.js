/**
 * self_proof_phase5.js — Phase 5 Self-Proof Script
 * =====================================================
 * [WHY]: Proves that ui-components.js loaded correctly, all functions are
 *        accessible via window.AppModules.UI, and all legacy bridges are intact.
 * [HOW]: Puppeteer navigates to the app, evaluates the runtime state of
 *        window.AppModules.UI and all window.XYZ legacy bridges, then reports
 *        a detailed pass/fail checklist.
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

const EXPECTED_FUNCTIONS = [
    'selectProduct',
    'handleTypeChange',
    'openProductModal',
    'openTransferModal',
    'handleTransferTargetChange',
    'confirmTransfer',
    'closeTransferModal',
    'openExitModal',
    'closeExitModal',
    'openRequestModal',
    'closeRequestModal',
    'openModal',
    'closeModal',
    'setupRowSelection',
    'updateFloatingBar',
    'showMobileBottomSheet',
    'closeMobileBottomSheet',
    'clearRowSelection',
    '_bulkDeleteSelected',
];

(async () => {
    let executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    if (!fs.existsSync(executablePath)) {
        executablePath = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    }

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    const consoleLogs = [];
    const pageErrors = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLogs.push(`[${msg.type().toUpperCase()}] ${text}`);
    });
    page.on('pageerror', err => pageErrors.push(err.message));

    console.log('Navigating to http://localhost:5500/index.html ...');
    await page.goto('http://localhost:5500/index.html', { waitUntil: 'networkidle2', timeout: 20000 });

    // Wait a bit for all ESM modules to initialize
    await new Promise(r => setTimeout(r, 3000));

    const result = await page.evaluate((expectedFns) => {
        const report = {
            appModulesUIExists: typeof window.AppModules !== 'undefined' && typeof window.AppModules.UI !== 'undefined',
            selectedRowsInitialized: window._selectedRows instanceof Set,
            namespaceFunctions: {},
            legacyBridges: {},
        };

        expectedFns.forEach(fn => {
            report.namespaceFunctions[fn] = typeof window.AppModules?.UI?.[fn] === 'function';
            report.legacyBridges[fn] = typeof window[fn] === 'function';
        });

        return report;
    }, EXPECTED_FUNCTIONS);

    console.log('\n========================================');
    console.log('  PHASE 5 SELF-PROOF REPORT');
    console.log('========================================\n');

    console.log(`window.AppModules.UI exists:      ${result.appModulesUIExists ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`window._selectedRows (Set):        ${result.selectedRowsInitialized ? '✅ PASS' : '❌ FAIL'}`);

    console.log('\n--- Namespace Functions (window.AppModules.UI.X) ---');
    let nsFails = 0;
    for (const [fn, ok] of Object.entries(result.namespaceFunctions)) {
        console.log(`  ${ok ? '✅' : '❌'} AppModules.UI.${fn}`);
        if (!ok) nsFails++;
    }

    console.log('\n--- Legacy Bridges (window.X) ---');
    let bridgeFails = 0;
    for (const [fn, ok] of Object.entries(result.legacyBridges)) {
        console.log(`  ${ok ? '✅' : '❌'} window.${fn}`);
        if (!ok) bridgeFails++;
    }

    if (pageErrors.length) {
        console.log('\n--- Page Errors ---');
        pageErrors.forEach(e => console.error('  ❌ PAGE ERROR:', e));
    }

    const relevantLogs = consoleLogs.filter(l => l.includes('ui-components') || l.includes('UIComponents') || l.includes('AppModules'));
    if (relevantLogs.length) {
        console.log('\n--- Relevant Console Logs ---');
        relevantLogs.forEach(l => console.log(' ', l));
    }

    const totalChecks = EXPECTED_FUNCTIONS.length * 2 + 2;
    const totalFails = nsFails + bridgeFails + (result.appModulesUIExists ? 0 : 1) + (result.selectedRowsInitialized ? 0 : 1) + pageErrors.length;

    console.log('\n========================================');
    if (totalFails === 0) {
        console.log('  RESULT: ✅ ALL CHECKS PASSED — Phase 5 is LIVE and VERIFIED');
    } else {
        console.log(`  RESULT: ❌ ${totalFails} CHECK(S) FAILED — Review above`);
    }
    console.log('========================================\n');

    await browser.close();
})();
