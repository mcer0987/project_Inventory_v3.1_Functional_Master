const fs = require('fs');
const path = require('path');

const adminPath = path.join(__dirname, '..', 'admin.html');
let adminContent = fs.readFileSync(adminPath, 'utf8');

adminContent = adminContent.replace(/(?:src\/services\/)?firebase-handler\.js(\?v=[0-9.]+)?/g, 'src/services/firebase-handler.js?v=' + Date.now());
adminContent = adminContent.replace(/(?:src\/modules\/admin\/)?admin-system-control\.js(\?v=[0-9.]+)?/g, 'src/modules/admin/admin-system-control.js?v=' + Date.now());

fs.writeFileSync(adminPath, adminContent, 'utf8');

const indexPath = path.join(__dirname, '..', 'index.html');
let indexContent = fs.readFileSync(indexPath, 'utf8');

indexContent = indexContent.replace(/(?:src\/services\/)?firebase-handler\.js(\?v=[0-9.]+)?/g, 'src/services/firebase-handler.js?v=' + Date.now());

fs.writeFileSync(indexPath, indexContent, 'utf8');

console.log("Cache busters updated.");
