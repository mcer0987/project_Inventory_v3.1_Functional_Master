import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { fireDb } from './firebase-handler.js';
import { isVerificationToken, newVerificationToken, subjectSummaries } from '../utils/ebys-verification-schema.js';

const ref = (name, id) => doc(fireDb, window.AppEnv.COLLECTION_ROOT, name, 'items', id);
const uid = () => {
    const actor = window.userAuth?.uid;
    if (!actor) throw new Error('Oturum gerekli.');
    return actor;
};
function admin() {
    if (!window.isDbAdmin?.()) throw new Error('Bu işlem için yönetici yetkisi gerekli.');
    return uid();
}

export async function issueVerification(documentId) {
    const actor = uid(), root = window.AppEnv.COLLECTION_ROOT;
    const sameSession = () => window.userAuth?.uid === actor && window.AppEnv.COLLECTION_ROOT === root;
    const headRef = ref('ebysDocuments', documentId);
    for (let attempt = 0; attempt < 5; attempt++) {
        const token = newVerificationToken();
        try {
            const result = await runTransaction(fireDb, async tx => {
                const head = (await tx.get(headRef)).data();
                if (!head || head.ownerUid !== actor) throw new Error('Doğrulama QR’ını evrakın yazarı oluşturabilir.');
                if (!['closed', 'archived'].includes(head.state) || !head.registrationNo) {
                    throw new Error('QR için evrak kapanmış ve kesin kayıt numarası alınmış olmalıdır.');
                }
                if (head.verificationToken) return head.verificationToken;
                const publicRef = ref('ebysVerifications', token);
                const [existing, version, registration] = await Promise.all([
                    tx.get(publicRef), tx.get(ref('ebysVersions', head.currentVersionId)),
                    tx.get(ref('ebysRegistrationIds', head.registrationNo))
                ]);
                if (existing.exists()) return null;
                if (!version.exists() || !registration.exists()) throw new Error('Kesin kayıt veya sabit evrak sürümü bulunamadı.');
                tx.update(headRef, { verificationToken: token, revision: head.revision + 1, updatedAt: serverTimestamp() });
                tx.set(ref('ebysVerificationTokens', token), {
                    documentId, versionId: head.currentVersionId, createdAt: serverTimestamp(), revokedAt: null, revokedBy: ''
                });
                tx.set(publicRef, {
                    registrationNo: head.registrationNo, registeredAt: registration.data().createdAt,
                    subjectSummary: subjectSummaries[head.kind], status: head.state === 'archived' ? 'archived' : 'valid',
                    contentDigest: version.data().contentDigest
                });
                return token;
            });
            if (result) return result;
        } catch (error) {
            // Eşzamanlı istek aynı evrak için anahtarı ayırmış olabilir.
            let saved;
            try {
                if (sameSession()) saved = (await getDocFromServer(headRef)).data();
            } catch { /* İlk hata korunur. */ }
            if (sameSession() && saved?.ownerUid === actor && isVerificationToken(saved.verificationToken)) {
                return saved.verificationToken;
            }
            throw error;
        }
    }
    throw new Error('Doğrulama anahtarı ayrılamadı. Yeniden deneyin.');
}

export async function revokeVerification(documentId) {
    const actor = admin();
    return runTransaction(fireDb, async tx => {
        const head = (await tx.get(ref('ebysDocuments', documentId))).data();
        if (!head?.verificationToken) throw new Error('Evrakın doğrulama kaydı yok.');
        const publicRef = ref('ebysVerifications', head.verificationToken);
        const published = (await tx.get(publicRef)).data();
        if (!published) throw new Error('Doğrulama kaydı bulunamadı.');
        if (published.status === 'revoked') return;
        tx.update(publicRef, { status: 'revoked' });
        tx.update(ref('ebysVerificationTokens', head.verificationToken), { revokedAt: serverTimestamp(), revokedBy: actor });
    });
}

export async function archiveExecutionDocument(id) {
    const actor = admin();
    return runTransaction(fireDb, async tx => {
        const job = (await tx.get(ref('ebysExecutionJobs', id))).data();
        if (job?.state !== 'completed') throw new Error('İcra tamamlanmadan arşivlenemez.');
        const path = ref('ebysDocuments', job.documentId);
        const head = (await tx.get(path)).data();
        if (head?.currentVersionId !== id) throw new Error('Evrak arşivlemeye uygun değil.');
        if (head.state === 'archived') return;
        if (head.state !== 'closed') throw new Error('Evrak arşivlemeye uygun değil.');
        const publicRef = head.verificationToken ? ref('ebysVerifications', head.verificationToken) : null;
        const published = publicRef ? (await tx.get(publicRef)).data() : null;
        if (publicRef && !published) throw new Error('Evrakın doğrulama kaydı bulunamadı.');

        const eventId = id + '__archive';
        tx.update(path, { state: 'archived', revision: head.revision + 1, updatedAt: serverTimestamp() });
        tx.set(ref('ebysExecutionEvents', eventId), {
            id: eventId, processId: id, ownerUid: job.ownerUid, revision: job.revision + 1,
            documentRevision: head.revision + 1, from: 'closed', to: 'archived',
            action: 'archive', actorUid: actor, createdAt: serverTimestamp()
        });
        if (published?.status === 'valid') tx.update(publicRef, { status: 'archived' });
    });
}

export const readVerificationStatus = token => getDocFromServer(ref('ebysVerifications', token)).then(s => s.data()?.status);

window.AppModules = window.AppModules || {};
window.AppModules.EBYSVerification = { issueVerification, revokeVerification, archiveExecutionDocument, readVerificationStatus };
