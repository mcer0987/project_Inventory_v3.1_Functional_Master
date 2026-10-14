// Faz 5 · K1 — gömülü Unicode TTF'lerin (pdf-fonts/Roboto-*.js) jsPDF'e doğru kaydolduğunu ve Türkçe harflerin
// (ş,Ş,ğ,Ğ,ı,İ,ö,Ö,ü,Ü,ç,Ç) font cmap tablosunda gerçekten var olduğunu doğrular. Birisi fontu değiştirirse ve yeni
// font Türkçe kapsamıyorsa, bu test kırılır (tarayıcıda sessizce tofu/boş kutu basılmasındansa burada patlasın).
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Minimal TrueType cmap okuyucu (format 4 ve 12) — yalnız "bu kod noktasının bir glifi var mı" sorusu için.
function readCmap(buf) {
    assert.ok(buf.length > 12, 'TTF çok kısa');
    const sig = buf.readUInt32BE(0);
    assert.ok(sig === 0x00010000 || buf.toString('ascii', 0, 4) === 'true' || buf.toString('ascii', 0, 4) === 'OTTO', 'geçerli bir TTF/OTF değil');
    const numTables = buf.readUInt16BE(4);
    let cmapOff = null;
    for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        if (buf.toString('ascii', rec, rec + 4) === 'cmap') cmapOff = buf.readUInt32BE(rec + 8);
    }
    assert.ok(cmapOff != null, 'cmap tablosu yok');
    const numSubtables = buf.readUInt16BE(cmapOff + 2);
    let best = null;
    for (let i = 0; i < numSubtables; i++) {
        const rec = cmapOff + 4 + i * 8;
        const platformID = buf.readUInt16BE(rec), encodingID = buf.readUInt16BE(rec + 2);
        if (platformID === 3 && (encodingID === 1 || encodingID === 10)) best = cmapOff + buf.readUInt32BE(rec + 4);
    }
    assert.ok(best != null, 'Windows Unicode cmap alt tablosu yok');
    const format = buf.readUInt16BE(best);
    const glyphFor = new Map();
    if (format === 4) {
        const segCountX2 = buf.readUInt16BE(best + 6), segCount = segCountX2 / 2;
        const endOff = best + 14, startOff = endOff + segCountX2 + 2, deltaOff = startOff + segCountX2, rangeOff = deltaOff + segCountX2;
        for (let s = 0; s < segCount; s++) {
            const end = buf.readUInt16BE(endOff + s * 2), start = buf.readUInt16BE(startOff + s * 2);
            const delta = buf.readInt16BE(deltaOff + s * 2), ro = buf.readUInt16BE(rangeOff + s * 2);
            for (let c = start; c <= end && c !== 0xFFFF; c++) {
                let gid;
                if (ro === 0) gid = (c + delta) & 0xFFFF;
                else { gid = buf.readUInt16BE(rangeOff + s * 2 + ro + (c - start) * 2); if (gid !== 0) gid = (gid + delta) & 0xFFFF; }
                if (gid !== 0) glyphFor.set(c, gid);
            }
        }
    } else if (format === 12) {
        const nGroups = buf.readUInt32BE(best + 12);
        for (let g = 0; g < nGroups; g++) {
            const rec = best + 16 + g * 12;
            const startChar = buf.readUInt32BE(rec), endChar = buf.readUInt32BE(rec + 4), startGlyph = buf.readUInt32BE(rec + 8);
            for (let c = startChar; c <= endChar; c++) glyphFor.set(c, startGlyph + (c - startChar));
        }
    } else assert.fail('desteklenmeyen cmap biçimi: ' + format);
    return glyphFor;
}

function loadEmbeddedFont(jsFile) {
    const src = fs.readFileSync(path.join(ROOT, 'pdf-fonts', jsFile), 'utf8');
    const vfsMatch = src.match(/addFileToVFS\('([^']+)'/);
    const fontMatch = src.match(/addFont\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/);
    const b64Match = src.match(/var font = '([^']+)';/);
    assert.ok(vfsMatch && fontMatch && b64Match, `${jsFile}: beklenen addFileToVFS/addFont deseni bulunamadı`);
    return {
        vfsName: vfsMatch[1], fontName: fontMatch[2], fontStyle: fontMatch[3],
        buf: Buffer.from(b64Match[1], 'base64'),
    };
}

const TURKISH = { 'ş': 0x15F, 'Ş': 0x15E, 'ğ': 0x11F, 'Ğ': 0x11E, 'ı': 0x131, 'İ': 0x130, 'ö': 0xF6, 'Ö': 0xD6, 'ü': 0xFC, 'Ü': 0xDC, 'ç': 0xE7, 'Ç': 0xC7 };
const ASCII_SAMPLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:/-';

for (const [file, style] of [['Roboto-Regular.js', 'normal'], ['Roboto-Bold.js', 'bold']]) {
    test(`${file}: jsPDF.API'ye 'Roboto' / '${style}' olarak kaydolur`, () => {
        const f = loadEmbeddedFont(file);
        assert.equal(f.fontName, 'Roboto');
        assert.equal(f.fontStyle, style);
        assert.match(f.vfsName, /\.ttf$/);
        assert.ok(f.buf.length > 10_000, 'gömülü font verisi şüpheli derecede küçük');
    });

    test(`${file}: Türkçe harfler (ş,ğ,ı,İ,ö,ü,ç ve büyükleri) cmap'te var`, () => {
        const f = loadEmbeddedFont(file);
        const glyphs = readCmap(f.buf);
        for (const [ch, cp] of Object.entries(TURKISH)) {
            assert.ok(glyphs.has(cp), `${file}: '${ch}' (U+${cp.toString(16).toUpperCase()}) için glif yok`);
        }
        for (const ch of ASCII_SAMPLE) {
            assert.ok(glyphs.has(ch.codePointAt(0)), `${file}: ASCII '${ch}' için glif yok`);
        }
    });
}

test('iki ağırlık da aynı VFS adını paylaşmaz (Regular/Bold karışmaz)', () => {
    const reg = loadEmbeddedFont('Roboto-Regular.js'), bold = loadEmbeddedFont('Roboto-Bold.js');
    assert.notEqual(reg.vfsName, bold.vfsName);
    assert.notEqual(reg.buf.toString('base64').slice(0, 200), bold.buf.toString('base64').slice(0, 200));
});
