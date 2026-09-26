
const crypto = require('crypto');

const ADMIN_HASH = "1bb60d59a9391c265f2969565fbda90f81ef1f13bb3d6f376585ad1ce62f7a85";
const SALT = "Qwerty!489797*";

function hash(string) {
    const _secret = string + SALT;
    return crypto.createHash('sha256').update(_secret).digest('hex');
}

const candidates = ["admin", "123456", "password", "1234", "medipol", "123", "489797", "Qwerty"];

candidates.forEach(pass => {
    if (hash(pass) === ADMIN_HASH) {
        console.log(`FOUND! Password is: ${pass}`);
    }
});
