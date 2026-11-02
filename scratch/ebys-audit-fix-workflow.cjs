const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

const source = fs.readFileSync('src/modules/edm-workflow.js', 'utf8');
const start = source.indexOf('function _resolveWorkflowSteps(steps)');
const end = source.indexOf('window.confirmStartWorkflow =', start);
assert.ok(start >= 0 && end > start);
const window = { data: {
    personel: [
        { id: 'passive', name: 'Ali', active: false },
        { id: 'active', name: 'Ayşe', active: true },
    ],
    staff: [{ name: 'Ali' }],
} };
const context = vm.createContext({ window });
vm.runInContext(source.slice(start, end) + '\nwindow.resolveSteps = _resolveWorkflowSteps;', context);
assert.match(window.resolveSteps([{ user: 'Ali' }]).error, /personel listesinde yok/);
assert.equal(window.resolveSteps([{ user: 'Ayşe' }]).steps[0].user, 'Ayşe');
window.data.personel[0].active = true;
assert.equal(window.resolveSteps([{ user: 'Ali' }]).steps[0].user, 'Ali');
console.log('Yeni akışta pasif kişi reddedildi; aktif kişi ve yeniden etkinleştirme geçti.');
