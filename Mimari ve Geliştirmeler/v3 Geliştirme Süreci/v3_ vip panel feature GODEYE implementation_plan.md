# VIP Sistem Kontrol Merkezi — God-Eye İnteraktif Geliştirme Planı

Bu plan, God-Eye (Canlı Radar) modülünü salt bir animasyon olmaktan çıkarıp, yöneticinin aktif kullanıcıları ve sistem yoğunluğunu anlık olarak izleyip müdahale edebileceği gerçek bir yönetim aracına dönüştürmeyi amaçlamaktadır. 

*Abartılı isimlendirmelerden kaçınılarak, profesyonel bir ITSM terminolojisi kullanılmıştır.*

## User Review Required

> [!IMPORTANT]
> - **Oturum Yönetimi:** "Oturumu Sonlandır" özelliğinin çalışması için Firebase Auth token'larının iptal edilmesi veya localStorage üzerinden aktif bir oturum kontrol mekanizmasının (örn. `force_logout_user_id` bayrağı) kurulması gerekecektir. Sisteminizin mevcut yetkilendirme (auth) mimarisine göre en uygun yöntem seçilecektir.
> - **Gerçek Zamanlı Veri (Real-time Data):** Bu özelliklerin tam kapasite çalışması için Firebase Firestore'un `onSnapshot` (gerçek zamanlı dinleme) yeteneklerinden faydalanılacaktır.

---

## Proposed Changes & Feature Details

### 1. Aktif Kullanıcı Müdahale Paneli (User Intervention)
Radar üzerindeki kırmızı noktalar (aktif kullanıcılar) artık tıklanabilir interaktif nesneler olacaktır.
- **Hedef Seçimi:** Radardaki bir kullanıcıya tıklandığında, radarın hemen sağında "Kullanıcı Aktivite Paneli" açılır.
- **Canlı Analiz:** Açılan panelde kullanıcının:
  - Adı, Soyadı ve Rolü
  - O an bulunduğu ekran/sekme
  - Sistemde yaptığı son 5 işlem (Log geçmişinden filtrelenerek) listelenir.
- **Yönetici Aksiyonları:**
  - **Sistem Mesajı Gönder:** Sadece o kullanıcının ekranında belirecek anlık bir "Sistem Uyarısı" (Toast Message) gönderilir. (Örn: "Lütfen işlemi onaylamadan önce ekleri kontrol edin.")
  - **Oturumu Sonlandır (Force Logout):** Seçili kullanıcının sistem bağlantısı anında kesilir ve login sayfasına yönlendirilir.

### 2. Sistem Yoğunluk Haritası (Module Heatmap)
Yöneticinin, sistemin hangi bölümünde anlık bir yığılma veya aşırı kullanım (export/import vb.) olduğunu görmesini sağlar.
- **Görünüm Değiştirme:** God-Eye kartının üstüne ufak bir geçiş (Toggle) butonu eklenir: *[ Kullanıcı Takibi ] / [ Modül Yoğunluğu ]*
- **Sektörel Dağılım:** Modül yoğunluğu seçildiğinde radar, sistemin ana parçalarına (Örn: B1 Depo, Satın Alma, Personel) göre dilimlere ayrılır.
- **Isı Haritası (Heatmap):** Sistemin neresinde daha çok veri okunuyor/yazılıyorsa o dilimin rengi yeşilden sarıya, yoğunluk aşırıysa turuncu/kırmızı tonlarına (Pulse efektiyle) döner.
- **Faydası:** Sistemde yaşanabilecek ani yavaşlamaların veya olağan dışı veri giriş/çıkışlarının hangi modülden kaynaklandığı tek bakışta tespit edilir.

---

## Verification Plan

### Automated Tests
*Arayüz fonksiyonları ve veri dinleyicileri manuel test edileceği için otomatize test planlanmamıştır.*

### Manual Verification
1. Radar üzerinde sahte/gerçek bir noktaya tıklandığında sağ tarafta **Kullanıcı Aktivite Paneli**nin sorunsuz açıldığı görülecek.
2. "Sistem Mesajı Gönder" butonuna basıldığında, simülasyon ortamında veya farklı bir sekmede mesajın iletildiği test edilecek.
3. Radarın görünüm düğmesine basıldığında "Modül Yoğunluk Haritası"na geçiş yapıldığı ve son loglara göre aktif modül dilimlerinin (Örn: Satın Alma) sarı/kırmızı parladığı teyit edilecek.
