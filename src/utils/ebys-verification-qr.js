// QR Model 2, sürüm 5-L, byte modu. En çok 106 UTF-8 bayt ve tek Reed–Solomon bloku.
const size = 37, dataLength = 108, eccLength = 26;
function multiply(a, b) {
    let value = 0;
    while (b) {
        if (b & 1) value ^= a;
        a = (a << 1) ^ ((a & 128) ? 0x11d : 0);
        b >>>= 1;
    }
    return value;
}
function codewords(bytes) {
    const bits = [];
    const add = (value, width) => {
        for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    add(4, 4);
    add(bytes.length, 8);
    for (const byte of bytes) add(byte, 8);
    add(0, 4);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
        data.push(bits.slice(i, i + 8).reduce((n, bit) => (n << 1) | bit, 0));
    }
    for (let pad = 0; data.length < dataLength; pad++) data.push(pad % 2 ? 0x11 : 0xec);

    let generator = [1], alpha = 1;
    for (let i = 0; i < eccLength; i++) {
        const next = Array(generator.length + 1).fill(0);
        generator.forEach((coefficient, j) => {
            next[j] ^= coefficient;
            next[j + 1] ^= multiply(coefficient, alpha);
        });
        generator = next;
        alpha = multiply(alpha, 2);
    }
    const remainder = [...data, ...Array(eccLength).fill(0)];
    for (let i = 0; i < data.length; i++) {
        const factor = remainder[i];
        generator.forEach((coefficient, j) => { remainder[i + j] ^= multiply(coefficient, factor); });
    }
    return data.concat(remainder.slice(dataLength));
}

export function qrMatrix(text) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > 106) throw new Error('Doğrulama adresi QR için fazla uzun.');
    const data = codewords(bytes);
    const matrix = Array.from({ length: size }, () => Array(size).fill(null));
    const set = (x, y, dark) => { if (x >= 0 && x < size && y >= 0 && y < size) matrix[y][x] = dark; };
    for (let i = 0; i < size; i++) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    for (const [x, y] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const ring = Math.max(Math.abs(dx), Math.abs(dy));
            set(x + dx, y + dy, ring !== 2 && ring !== 4);
        }
    }
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        set(30 + dx, 30 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // Düzey L ve maske 0 için BCH kodlanmış biçim bilgisi.
    const format = i => ((0x77c4 >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, format(i));
    set(8, 7, format(6));
    set(8, 8, format(7));
    set(7, 8, format(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, format(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, format(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, format(i));
    set(8, size - 8, true);

    let index = 0, up = true;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right--;
        for (let i = 0; i < size; i++) {
            const y = up ? size - 1 - i : i;
            for (const x of [right, right - 1]) {
                if (matrix[y][x] !== null) continue;
                const bit = (data[index >>> 3] >>> (7 - (index & 7))) & 1;
                matrix[y][x] = Boolean(bit ^ ((x + y) % 2 === 0));
                index++;
            }
        }
        up = !up;
    }
    return matrix;
}

export function verificationQr(url) {
    const matrix = qrMatrix(url);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 45 45');
    svg.setAttribute('width', '132');
    svg.setAttribute('height', '132');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Evrak doğrulama QR kodu');
    svg.setAttribute('shape-rendering', 'crispEdges');
    const background = document.createElementNS(ns, 'rect');
    background.setAttribute('width', '45');
    background.setAttribute('height', '45');
    background.setAttribute('fill', 'white');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', 'black');
    path.setAttribute('d', matrix.flatMap((row, y) => row.map((dark, x) => dark ? 'M' + (x + 4) + ',' + (y + 4) + 'h1v1h-1z' : '')).join(''));
    svg.append(background, path);
    return svg;
}
