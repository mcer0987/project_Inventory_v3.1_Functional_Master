#!/usr/bin/env bash
# Geçici ölçüm aracı (J11): verilen kural dosyasında 10 adımlı BAŞLATMA (A), 10. adım ONAYI (B) ve 10. adım REDDİ (C) isteklerinin 1000 ifade
# sınırına payını ayrı ayrı ölçer. Kullanım: bash scratch/_budget.sh <kural-dosyası> "<n listesi>"
RULES="$1"; NS="$2"
node -e "
const fs=require('fs');let s=fs.readFileSync('tests/rules/rules.test.mjs','utf8');
const a=\"        let po = running({ workflow: { ...running().workflow, steps: ten,\";
s=s.replace(a, \"    });\n    test('HEAVYB', async () => {\n        const ten = Array.from({ length: 10 }, (_, i) => step(i % 2 ? 'uid-s3' : 'uid-s2'));\n\"+a);
s=s.replace(\"test('en ağır durum:\",\"test('HEAVYA en ağır durum:\");
s=s.replace(\"test('en ağır red:\",\"test('HEAVYC en ağır red:\");
fs.writeFileSync('tests/rules/_tmp_heavy.mjs',s);"
for n in $NS; do
  pad=$(for i in $(seq 1 $n); do printf '\\&\\& request.time != null '; done)
  sed "s|function isStaff(root) { return staffAccessOpen(root) \&\& staffIdentity(root); }|function isStaff(root) { return staffAccessOpen(root) $pad\&\& staffIdentity(root); }|" "$RULES" > scratch/_pad.rules
  out=$(RULES_FILE=scratch/_pad.rules timeout 300 npx firebase emulators:exec --config tests/rules/firebase.rules-test.json --only firestore --project demo-rules-test "node --test --test-name-pattern=HEAVY tests/rules/_tmp_heavy.mjs" 2>&1)
  A=$(echo "$out" | grep -qE "^  ✔ HEAVYA" && echo ok || echo FAIL)
  B=$(echo "$out" | grep -qE "^  ✔ HEAVYB" && echo ok || echo FAIL)
  C=$(echo "$out" | grep -qE "^  ✔ HEAVYC" && echo ok || echo FAIL)
  echo "n=$n  start10=$A  approve10=$B  reject10=$C"
done
rm -f scratch/_pad.rules tests/rules/_tmp_heavy.mjs
