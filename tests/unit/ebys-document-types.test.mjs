import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('belge türü ürün türünden ayrıdır; satın alma yalnız kendi şablonunu listeler', () => {
    const window = { data: {
        purchaseOrders: [{ id: 'p1', documentTypeCode: 'PURCHASE_REQUEST' }],
        workflowTemplates: [
            { id: 'purchase', name: 'Satın Alma Onayı', documentTypeCode: 'PURCHASE_REQUEST' },
            { id: 'incoming', name: 'Gelen Evrak Havalesi', documentTypeCode: 'INCOMING_DOCUMENT' },
            { id: 'legacy', name: 'Eski Satın Alma Şablonu' },
        ],
    }, AppModules: {}, addManualStep: () => {} };
    const elements = { startWorkflowModal: { style: {} }, startWorkflowReqId: { value: '' }, tplSelectDropdown: { innerHTML: '', value: '' } };
    const context = vm.createContext({ window, document: { getElementById: id => elements[id] },
        WorkflowState: {}, checkTemplateAuth: () => true, escapeHtml: value => value });
    vm.runInContext(readFileSync('src/utils/ebys-document-types.js', 'utf8'), context);
    const source = readFileSync('src/modules/edm-workflow.js', 'utf8');
    const start = source.indexOf('window.startWorkflow = function (id)');
    const end = source.indexOf('window.closeStartWorkflowModal =', start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(source.slice(start, end), context);
    window.startWorkflow('p1');
    assert.equal(window.AppModules.EBYSDocumentTypes.byCode('PURCHASE_REQUEST').name, 'Satın Alma Talebi');
    assert.match(elements.tplSelectDropdown.innerHTML, /purchase/);
    assert.match(elements.tplSelectDropdown.innerHTML, /legacy/);
    assert.doesNotMatch(elements.tplSelectDropdown.innerHTML, /incoming/);
});
