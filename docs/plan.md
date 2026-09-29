# Antrenman Takibi: çevrimdışı antrenman günlüğü

## 1. Bağlam
`workout-tracking` klasörü tamamen boş ve henüz bir git deposu değil. Git kurulu; adınız ve e-postanız ayarlı. Node.js kurulu değil, Python 3.12 kurulu. Yapıştırdığınız program 5 günden oluşuyor: Push, Pull, Legs, Upper ve Lower. Toplam 34 satır var ve her satırın bir set × tekrar hedefi var.

Amaç, salonda telefondan kullanacağınız bir antrenman günlüğü. Uygulama küçük aşamalarla kurulur. Her aşama doğrulanır, bir commit ile kaydedilir ve sonra durulur. Commit, kodun o anki hâlinin kaydıdır.

**Verdiğiniz kararlar**
- **Platform:** bu klasörde, düz HTML, CSS ve JavaScript ile yazılmış bir PWA. PWA, telefonda ana ekrana eklenip uygulama gibi açılan bir web sitesidir. Derleme adımı yok ve npm'den paket kurulmuyor.
- **Dil:** arayüz Türkçe. Hareket adları yazdığınız gibi kalır. Koddaki adlar İngilizcedir.
- **Kayıt anahtarı:** kayıtlar gün + hareket + makine bazında tutulur. Legs'teki Standing Calf Raise, bir önceki Legs antrenmanındaki Standing Calf Raise ile karşılaştırılır; Lower'daki kayıtlar buna karışmaz.
- **Makineler:** bir hareket birden çok makinede yapılabilir. O gün hangi makine boşsa onu seçersiniz ve her makinenin kaydı ayrı tutulur. Her makinenin kendi birimi vardır: kg, kademe ya da ağırlıksız. Örneğin Rope Pushdown bir makinede 50 kg, kg yazmayan diğer makinede 10k (10. kademe) olarak kaydedilir.
- **İlerleme:** her gün + hareket + makine için "son ilerlemeden beri N antrenman" sayacı tutulur. Grafikler de olur ama sayacın yerine geçmez.
- **Program düzenleyici** ilk sürümde var.
- **Dönüşümlü satırlar:** Wrist Curl / Reverse Curl ve Cable Chop / Reverse Cable Chop her antrenmanda sırayla değişir.
- **İlk sürümde yok:** dinlenme sayacı ve ağırlık önerisi.

**Bu kararların sonuçları**
- **Sunucu:** tarayıcı, modüllere ayrılmış JavaScript dosyalarını doğrudan diskten açınca yüklemez. Bu yüzden bilgisayarda klasör küçük bir yerel sunucuyla açılır: `python serve.py`. Telefonda ise GitHub Pages kullanılır. GitHub Pages, GitHub'ın ücretsiz ve https'li web yayın hizmetidir.
- **Veri:** kayıtlar yalnızca kullanılan cihazda, tarayıcının içindeki veritabanında (IndexedDB) durur. Giriş ve cihazlar arası eşitleme yok. Bu yüzden JSON yedekleme var. JSON, verinin eksiksiz ve programların okuyabildiği metin biçimidir.

## 2. Veri yapısı ve temel kurallar
```js
// IndexedDB veritabanı "antrenman-takibi"
// meta deposu: { key: "program", ... } ve { key: "settings", lastBackupAt }
program = {
  exercises: {                                           // katalog: kimlik → ad ve makineler
    "rope-pushdown": { name: "Rope Pushdown", equipment: [
      { id: "eq-1", name: "Kablo",   unit: "kg" },
      { id: "eq-9", name: "Kablo 2", unit: "level", archived: false },  // kademeli makine
    ]},
    "ab-wheel-roll-out": { name: "Ab Wheel Roll-Out", equipment: [
      { id: "eq-5", name: "Vücut ağırlığı", unit: "none" },            // yalnızca tekrar
    ]},
    …
  },
  days: [{ id: "push", name: "Push", items: [
    { id, options: ["machine-chest-press"], sets: 3, repMin: 10, repMax: 12 },
    { id, options: ["wrist-curl", "reverse-curl"], sets: 2, repMin: 15, repMax: 15 }, // dönüşümlü satır
  ]}, …]                                                  // "4×15" → repMin = repMax = 15
}
// sessions deposu: anahtar id, startedAt üzerinde dizin
session = { id, dayId, dayName, startedAt, finishedAt /* devam ederken null */,
  entries: [{ exerciseId, equipmentId, name, equipmentName, unit, options,
              target: { sets, repMin, repMax },
              sets: [{ weight: 10, reps: 12 }] }] }       // weight, makinenin biriminde
```
- **Geçmişin anahtarı gün + hareket + makinedir.** "Geçen sefer", sayaç ve grafikler yalnızca bu üçü aynı olan kayıtlardan hesaplanır.
  - Legs ile Lower'daki Standing Calf Raise birbirine karışmaz.
  - Push ile Upper'daki Overhead Rope Extension da karışmaz.
  - Aynı gün ve harekette iki makinenin kayıtları ayrı durur.
- **Birimler dönüştürülmez.**
  - Her makinenin tek birimi vardır: kg, kademe ya da ağırlıksız.
  - Değerler ondalık olabilir (22,5).
  - Kaydı olan bir makinenin birimi değiştirilemez; farklı birim gerekiyorsa yeni makine eklenir.
- **Makineler harekete aittir.** Bir hareketin makine listesi, geçtiği bütün günlerde aynıdır; kayıtları ise gün bazında ayrıdır.
- **Bağlantılar adla değil kimlik numarasıyla (id) kurulur.**
  - Gün, hareket ya da makine adını değiştirmek geçmişi bölmez.
  - Kaydı olan makine silinmez, arşivlenir. Arşivlenen makine seçim listesinden kalkar, geçmişte görünmeye devam eder.
- **Hedef kopyalanır.** Antrenman başlarken hareket adı, makine adı, birim ve hedef kaydın içine kopyalanır. Program sonradan değişse de eski kayıt kendi hedefini gösterir.
- **Set tanımı:**
  - Ağırlık hareket başına bir kez girilir ve tekrarı girilen her sete uygulanır: 35 kg girildiyse bütün setler 35 kg'dır. Kayıtta her set bu ağırlığı taşır. Ağırlıksız makinede yalnızca tekrar girilir.
  - Tekrar girilip ağırlık girilmezse uyarı çıkar; boş tekrar kutusu kaydedilmez. Yalnızca ağırlık girilip tekrar girilmezse de uyarı çıkar; yazılan değer sessizce kaybolmaz.
  - Önceki değerler yalnızca soluk ipucudur; siz yazmadıkça hiçbir kutu dolmaz.
- **"Yapıldı" ve "atlandı":** bitmiş bir antrenmanda en az bir seti girilen hareket "yapıldı" sayılır. Hiç seti girilmeyen hareket "atlandı" sayılır ve kayda yazılmaz. Atlanan hareket "geçen sefer", sayaç ve dönüşüm sırasında hesaba katılmaz. Bitmemiş antrenmanlar da bu hesaplara katılmaz.
- **Makineleri siz eklersiniz:** hareketler makinesiz başlar; varsayılan makine yoktur. Her hareketin makinelerini (ikincisi dahil) "+ Makine" ile eklersiniz: adı yazar, birimi (kg, kademe ya da ağırlıksız) kendiniz seçersiniz; birim önceden seçili gelmez. Eklenen makine hemen kaydedilir. Aynı salondaki iki kablo makinesinin ikisi de kg olabilir. Makinesi olmayan harekette ağırlık ve tekrar kutuları görünmez.
- **Türetilmiş bilgi:** "geçen sefer", sayaç, dönüşüm önerisi ve grafikler veritabanına yazılmaz. Her gösterimde kayıtlardan yeniden hesaplanır. Böylece geçmiş bir kaydı düzeltince hepsi kendiliğinden güncellenir. Sonradan eklenen bir özellik de eski kayıtlarla çalışır.

## 3. Kaydetme ve kayıt durumu
**Durumlar** (antrenman ekranının üstünde görünür):
- **Kaydediliyor…:** bekleyen ya da yazılmakta olan bir değişiklik var.
- **Kaydedildi ✓:** tarayıcı, son değişikliğin bu cihazdaki veritabanına yazıldığını bildirdi.
- **Kaydedilemedi:** son yazma başarısız oldu, örneğin depolama doldu ya da tarayıcı engelledi.
  - Kısa bir açıklama ve "Tekrar dene" düğmesi çıkar.
  - Veriler ekranda kalır ve sonraki her değişiklikte yeniden denenir.
  - Hata sürerken uygulamayı kapatmamanız söylenir.

**Nasıl yazılır**
- **Tek sıra:** tüm yazmalar tek bir sıradan geçer. Aynı anda tek yazma olur ve her yazma antrenmanın son hâlini kaydeder.
- **Zamanlama:** yazarken kısa bir beklemeden (yaklaşık 0,5 sn) sonra yazılır. Kutudan çıkınca, set ya da makine değişince ve uygulama arka plana geçince bekleyen yazma hemen başlatılır.

**Bekleyen kayıtları bekleyen işlemler**
- **Bitir:** önce bekleyen yazmaların bitmesini bekler. Hata olursa antrenman bitirilmez, ekranda kalır ve hata gösterilir.
- **Güncelle** (yeni sürüm): önce bekleyen yazmaları bekler. Hata varsa sayfayı yenilemez.
- **Sayfadan çıkma:** bekleyen ya da hatalı kayıt varken sayfadan çıkılmaya çalışılırsa tarayıcı uyarı gösterir. Bunu her tarayıcı desteklemez.

**Sınır:** kayıpsızlık garantisi verilmez. Bekleme süresi içinde telefon ya da tarayıcı uygulamayı zorla kapatırsa son değişiklik kaybolabilir. Uygulama bu süreyi kısa tutar ve durumu görünür kılar. En güvenlisi, "Kaydedildi ✓" görünmeden uygulamayı kapatmamaktır.

## 4. İlerleme sayacı
- **Karşılaştırma:** bugünkü giriş, aynı anahtardaki bir önceki "yapıldı" girişiyle set set karşılaştırılır: 1. set 1. setle, 2. set 2. setle. Yalnızca iki kayıtta da bulunan setlere bakılır.
- **Artmış set:** bir set şu durumlarda "artmış" sayılır:
  - Ağırlığı (ya da kademesi) daha yüksektir; tekrar ne olursa olsun.
  - Ağırlığı aynıdır ve tekrarı daha yüksektir.
  - Ağırlıksız makinede tekrarı daha yüksektir.
- **İlerleme:** en az bir set arttıysa o antrenman "ilerleme" sayılır.
- **Sayaç:** aynı anahtarda son ilerlemeden sonra gelen "yapıldı" girişlerinin sayısıdır.
  - Hiç ilerleme yoksa ilk kayıt başlangıç noktasıdır ve "İlk kayıttan beri N antrenman" yazar.
  - Başka bir makine ya da gün bu sayacı değiştirmez.
- **Gösterim:**
  - Antrenman kartında "Geçen sefer" satırının altında "Son ilerlemeden beri N antrenman" yazar.
  - Set girerken bir önceki kayda göre artış varsa "Bu antrenmanda ilerledin" görünür.
  - İlerleme ekranında sayaç grafiğin üstünde ayrıca durur.

Örnekler (her biri otomatik teste dönüşür):

| Önceki | Bugün | Sonuç |
|---|---|---|
| 40×12, 40×11, 40×10 | 40×12, 40×12, 40×10 | İlerleme var: aynı ağırlıkta 2. set 1 tekrar arttı |
| 40×12, 40×12, 40×12 | 45×9, 45×8, 45×8 | İlerleme var: ağırlık arttı |
| 40×12, 40×11, 40×10 | 40×12, 40×11, 40×10 | İlerleme yok; sayaç 1 artar |
| 40×12, 40×11 | 40×11, 40×12 | İlerleme var: karışık durum, en az bir set arttı |
| 40×12, 40×11, 40×10 | 35×12, 35×12, 35×12 | İlerleme yok: ağırlık düştü |
| 10k×12 | 11k×8 | İlerleme var: kademe arttı |
| 15, 14 (ağırlıksız) | 15, 15 | İlerleme var: 2. sette tekrar arttı |
| (kayıt yok) | 40×12, 40×11, 40×10 | İlk kayıt: başlangıç noktası |

## 5. Dönüşümlü hareketler
- **Sıra:** satırın hareketleri sıralıdır, örneğin Wrist Curl → Reverse Curl.
- **Öneri:** aynı günün bitmiş antrenmanlarında bu satırdan en son "yapılan" hareketin bir sonrakidir. Liste bitince başa döner. Hiç kayıt yoksa ilk hareket önerilir.
- **Kartta:** "Son yapılan: Wrist Curl · 21 Eyl · Sıradaki: Reverse Curl" yazar. Öneri ⇄ ile değiştirilebilir.
- **Atlama:** atlanan hareket "yapıldı" sayılmaz, bu yüzden sıra değişmez.
- **Elle değiştirme:** öneri değiştirilirse gerçekte yapılan hareket esas alınır.

## 6. Ekranlar (uygulamanın son hâli)
- **Antrenman (ana ekran):**
  - bitmemiş antrenman varsa "Devam et" kartı
  - "Sıradaki" günü: son bitirilen günden sonraki gün, program sırasına göre (Push → Pull → Legs → Upper → Lower → Push)
  - tüm günler, en son yapıldıkları tarihle
  - son yedek 30 günden eskiyse hatırlatma
- **Antrenman ekranı:** üstte kayıt durumu ve her hareket için bir kart. Soluk yazılar ipucudur:
  ```
  Rope Pushdown                                    Hedef 3 × 12–15
  Makine:  [ Kablo · kg ]  [● Kablo 2 · kademe ]  [+ Makine]
  Geçen sefer (21 Eyl · Kablo 2):  10k × 15 · 13 · 12
  Son ilerlemeden beri 2 antrenman

  Kademe      [ (10) ]
  Tekrarlar   1. set    2. set    3. set
              [ (15) ]  [ (13) ]  [ (12) ]
  + Set
  ```
  - **Makine:** o gün bu harekette en son kullanılan makine seçili gelir. Makine değişince "Geçen sefer", sayaç ve birim etiketi o makineye göre değişir.
  - **"+ Makine":** ad ve birim girilerek makine eklenir; birim önceden seçili gelmez. Ad kutusu, başka hareketlerde kullandığınız adları önerir.
  - **Kutular:** hareket başına tek ağırlık kutusu ve her set için bir tekrar kutusu vardır. Ağırlıksız makinede ağırlık kutusu yoktur.
  - **Ekleme:** "+ Set" bir satır ekler, sil düğmesi son satırı kaldırır. "+ Hareket ekle" yalnızca bu antrenmana hareket ekler.
  - **Bitirme:** "Bitir" bekleyen kayıtları bekler ve yarım setler için uyarır. "İptal", onay aldıktan sonra antrenmanı siler.
- **Geçmiş:**
  - Antrenmanlar en yeniden eskiye listelenir.
  - Ayrıntıda her hareket makinesiyle birlikte görünür, örneğin "Rope Pushdown · Kablo 2: 10k × 15 · 13".
  - Düzenle ve Sil buradadır. Düzenleme aynı kart ekranıyla yapılır; orada "geçen sefer", o antrenmandan önceki kayıttır.
- **İlerleme:**
  - Liste günlere, günlerin altında hareketlere göre gruplanır. Programdan çıkarılmış ama kaydı olan hareketler "Programda olmayan" grubundadır.
  - Her makine için bir sekme vardır ve sekmede önce sayaç, sonra grafik görünür. Seçilebilen ölçüler birime göre değişir:
    - kg: Tahmini 1TM (en iyi setten, Epley formülü), En ağır, Hacim (kg × tekrar toplamı)
    - kademe: En yüksek kademe, Toplam tekrar
    - ağırlıksız: Toplam tekrar, En çok tekrar
  - Grafikte bir noktaya dokununca o günün setleri görünür.
- **Program:**
  - Günler ve satırlar eklenir, düzenlenir, sıralanır ve silinir. Günlerin sırası "Sıradaki" sırasıdır.
  - Satır düzenleme penceresinde şunlar vardır:
    - **Hareket:** katalogdan seçilir ya da yeni oluşturulur. "Adı düzelt", adı her yerde değiştirir.
    - **İkinci hareket (isteğe bağlı):** dönüşümlü satırlar için.
    - **Hedef:** set sayısı ile en az ve en çok tekrar.
    - **Makineler:** ekleme, yeniden adlandırma, arşivleme ve arşivden geri alma.
  - "Programı sıfırla", yapıştırdığınız programı geri getirir. Geçmiş ve makineler korunur.
- **Ayarlar:**
  - JSON yedeği indirme. Tarayıcı dosya paylaşmayı destekliyorsa ek olarak paylaş düğmesi.
  - Yedeği geri yükleme: dosya denetlenir, onayınız alınır, sonra veri tek adımda değiştirilir.
  - Kalıcı depolama durumu (`navigator.storage.persist()`) ve son yedeğin tarihi.

Biçim ve kullanım ayrıntıları:
- **Biçim:** sayılar ve tarihler Türkçe biçimdedir ("22,5 kg", "28 Eyl Pzt"). Setler kısa yazılır:
  - kg: "50 kg × 12 · 12 · 11"
  - kademe: "10k × 12 · 12 · 10"
  - ağırlıksız: "15 · 14"
- **Ondalık:** ağırlık kutusu hem virgülü hem noktayı kabul eder.
- **Yazı boyutu:** iPhone'un kutuya dokununca ekranı yakınlaştırmaması için kutulardaki yazı en az 16px'tir.
- **Görünüm:** dokunma alanları büyüktür. Açık ya da koyu tema telefonun ayarına uyar.
- **Metin güvenliği:** kullanıcının yazdığı metinler sayfaya kod olarak değil, düz metin olarak basılır.

Hedef dosya yapısı:
```
index.html, manifest.webmanifest, sw.js, css/app.css
js/main.js        açılış ve yönlendirme (#/, #/antrenman/:id, #/gecmis, #/ilerleme, #/program, #/ayarlar)
js/db.js          IndexedDB yardımcıları
js/store.js       veri erişim katmanı + kaydetme sırası ve kayıt durumu
js/seed.js        başlangıç programı ve makineler
js/logic.js       saf fonksiyonlar (aynı girdiye hep aynı sonuç; ekrana ve veritabanına dokunmaz)
js/chart.js       kütüphanesiz SVG grafik
js/views/*.js     ekranlar
icons/            simgeler
tests/index.html, tests/logic.test.js   tarayıcıda çalışan birim testleri
tests/e2e.py      uçtan uca test (Playwright + kurulu Chrome)
CLAUDE.md, README.md, .gitignore
```

## 7. Kapsam dışı (bu sürümde yok)
- Giriş ve cihazlar arası eşitleme. Veri başka bir cihaza yedekle taşınır.
- Dinlenme sayacı.
- Ağırlık önerisi ve "hedef tamamlandı" bildirimi.
- CSV dışa aktarma. Yedek yalnızca JSON'dur.

## 8. Geliştirme aşamaları
Her aşamanın sonunda uygulama çalışır durumdadır. Aşama doğrulanır, commit ile kaydedilir ve durulur. Bir sonraki aşamaya siz "devam" deyince geçilir. Aşama 1–4'te bilgisayarda girilen veriler deneme verisidir. Gerçek kullanım telefonda Aşama 5'ten sonra başlar.

**Aşama 0: Kurulum** (uygulama kodu yazılmaz)
- `git init` ile depo oluşturulur. Commit'ler `main` dalına atılır.
- `.gitignore` eklenir: `.venv/`, `__pycache__/`, `tests/artifacts/`, `Thumbs.db`, `.DS_Store`.
- Kısa bir `CLAUDE.md` yazılır. Claude Code bu dosyayı her oturumda okur. İçinde şunlar olur:
  - amaç ve teknik kısıtlar (derleme yok, npm yok, IndexedDB)
  - veri kuralları (gün + hareket + makine anahtarı, birimler, hedef kopyası)
  - kaydetme kuralları
  - çalıştırma ve test komutları
  - çalışma şekli (küçük aşama → doğrula → commit → dur)
- Boş sayfa iskeleti (`index.html`) ve bir örnek testle birim test sayfası (`tests/index.html`) oluşturulur.
- Proje içine `.venv` sanal ortamı ve Playwright kurulur. Genel Python'a dokunulmaz, tarayıcı indirilmez; kurulu Chrome kullanılır. `tests/e2e.py` iskeleti yazılır.
- *Bitti sayılır:* `python serve.py` ile sayfa açılıyor, test sayfası 1/1 geçiyor, `tests/e2e.py` geçiyor ve `git log` ilk commit'i gösteriyor.

**Aşama 1: İlk dilim.** Bir gün, bir hareket, iki makine, önceki performans ve bugünkü setlerin kaydı. Ayrıntılar 9. bölümde. Doğrulandıktan sonra durulur.

**Aşama 2: Tüm program ve makine ekleme**
- `seed.js` genişletilir: 5 gün, 34 satır. Hareketler makinesiz başlar; makineleri kullanıcı ekler.
- Ana ekrandan gün seçilir ve "Sıradaki" önerisi görünür.
- Antrenman ekranında günün tüm hareketleri Aşama 1 kartıyla girilir. Hedefler kayda kopyalanır. Kaydetme şimdilik "Bitir" ile tek seferde yapılır.
- Makine seçimi ve "+ Makine" (Aşama 1'de geldi) tüm hareketlerde çalışır. O gün en son kullanılan makine seçili gelir.
- Dönüşümlü satırlarda iki hareketten biri şimdilik elle seçilir.
- "+ Set" ve son seti silme eklenir.
- Kayıtlı program başlangıç programının eski bir sürümündense (`SEED_VERSION`) açılışta yükseltilir; kullanıcının eklediği makineler ve kayıtlar korunur.
- Otomatik kaydetme Aşama 3'te geldiği için, kaydedilmemiş değerler varken ekrandan çıkarken ya da sayfayı kapatırken onay sorulur.
- *Bitti sayılır:*
  - Satır sayıları doğru: Push 6, Pull 8, Legs 8, Upper 6, Lower 6. Sıra ve hedefler programla aynı.
  - Overhead Rope Extension, Push'ta 2 × 15, Upper'da 3 × 12–15 hedefiyle açılıyor.
  - Legs'teki Standing Calf Raise kaydı Lower'da görünmüyor, tersi de geçerli. Bu hem ekranda hem testte doğrulanıyor.
  - Bir harekete eklenen makine, o hareketin geçtiği diğer günde de listede görünüyor (makineler harekete aittir).
  - Seed'de bir hedef değişince yeni antrenman yeni hedefi alıyor, eski kayıt eski hedefi gösteriyor.

**Aşama 3: Otomatik kaydetme, kayıt durumu ve devam eden antrenman**
- 3. bölümdeki kaydetme sırası ve durumlar uygulanır.
- "Devam et" kartı eklenir. Aynı anda tek devam eden antrenman olur. Yarım antrenman varken yeni gün başlatılırsa "devam et / bitir / sil" diye sorulur.
- "Bitir" bekleyen kayıtları bekler ve yarım setler için uyarır. "İptal" onay alır.
- *Bitti sayılır:*
  - "Kaydedildi ✓" göründükten sonra sekme kapatılıp açılınca değerler yerinde duruyor.
  - Yazma hatası taklit edilince "Kaydedilemedi" çıkıyor ve veri ekranda kalıyor. Hata kalkınca "Tekrar dene" ile "Kaydedildi ✓" oluyor.
  - Hata varken "Bitir" antrenmanı bitirmiyor.
  - Bitmemiş antrenman "geçen sefer" hesabına katılmıyor.

**Aşama 4: Yedekleme**
- JSON dışa aktarma (indirme ve paylaşma) eklenir.
- İçe aktarma eklenir: dosya denetlenir, onay alınır ve veri tek adımda değiştirilir.
- Son yedek tarihi, 30 günlük hatırlatma ve kalıcı depolama isteği eklenir.
- *Bitti sayılır:* dışa aktarılıp içe aktarılan veri aynen geri geliyor. Bozuk dosya reddediliyor ve hiçbir şey değişmiyor.

**Aşama 5: PWA ve yayına alma**
- Manifest, service worker ve simgeler eklenir. Service worker, uygulama dosyalarını telefonda saklayıp internetsiz açılmasını sağlayan bir arka plan betiğidir.
  - Önbellek sürümlüdür.
  - "Yeni sürüm var: Güncelle" bandı çıkar ve bekleyen kayıtları bekler.
  - Bilgisayarda (localhost) service worker kapalıdır. Adrese `?sw=1` eklenirse açılır.
- Türkçe `README.md` yazılır: çalıştırma, yayına alma, telefona kurulum, yedekleme.
- **Yayına alma yalnızca onayınızla yapılır:**
  - GitHub'da boş bir depo açarsınız; ücretsiz hesapta depo herkese açık olmalıdır.
  - Ben gönderirim (push). Siz Settings → Pages bölümünden `main` dalını ve kök klasörü seçersiniz.
- **Telefonda kurulum:** adresi açıp uygulamayı ana ekrana eklersiniz ve sonra yalnızca onu kullanırsınız. iPhone'da ana ekran uygulaması ile Safari ayrı depolama kullanır.
- *Bitti sayılır:*
  - `?sw=1` ile uygulama internetsiz açılıyor (uçtan uca test).
  - Telefonda ana ekrana eklenen uygulamada uçak modunda set girilebiliyor (sizin denemeniz).
  - Bekleyen kayıt varken "Güncelle" önce kaydı bitiriyor.
- ➜ **Salonda gerçek kullanıma buradan itibaren başlayabilirsiniz.** Sayaç, dönüşüm önerisi ve grafikler kayıtlardan hesaplandığı için sonradan eklense de bu noktadan itibaren girilen kayıtlarla çalışır.

**Aşama 6: İlerleme sayacı**
- 4. bölümdeki kurallar saf fonksiyon olarak yazılır ve kartta gösterilir.
- *Bitti sayılır:*
  - Tablodaki her örnek testte doğru sonucu veriyor.
  - Makine B kullanılınca makine A'nın sayacı değişmiyor.
  - Legs ve Lower sayaçları birbirinden bağımsız.
  - Atlanan hareket sayacı değiştirmiyor.
  - Aşama 5'ten beri girilen gerçek kayıtlarda da sayaç görünüyor.

**Aşama 7: Dönüşümlü hareket önerisi**
- 5. bölümdeki kurallar saf fonksiyon olarak yazılır. *Bitti sayılır:* şu testler geçiyor:
  - Hiç kayıt yokken Wrist Curl önerilir.
  - Son Pull'da Wrist Curl yapıldıysa Reverse Curl önerilir.
  - **Atlama:** öneri Reverse Curl'ken hareket atlanıp antrenman bitirilirse, sonraki Pull'da öneri yine Reverse Curl olur.
  - **Elle değiştirme:** öneri Reverse Curl'ken elle Wrist Curl seçilip yapılırsa, sonraki öneri Reverse Curl olur.
  - Bitmemiş antrenmandaki seçim öneriyi değiştirmez.
  - Legs'teki Cable Chop grubu Pull'daki gruptan bağımsızdır.

**Aşama 8: Geçmiş ve düzeltme**
- Antrenman listesi, ayrıntı ekranı, düzenleme ve onaylı silme eklenir.
- *Bitti sayılır:*
  - Geçmiş bir set düzeltilince "geçen sefer" ve sayaç buna göre değişiyor.
  - Silmeden önce onay soruluyor.

**Aşama 9: İlerleme grafikleri**
- Her gün + hareket + makine için grafik çizilir. Ölçüler birime göre değişir ve sayaç grafiğin üstünde ayrıca durur. Grafik kodundan önce dataviz skill'i yüklenir.
- *Bitti sayılır:*
  - Her makinenin grafiği kendi biriminde çiziliyor.
  - Ölçü seçenekleri birime göre değişiyor.
  - Noktaya dokununca o günün setleri görünüyor.

**Aşama 10: Program düzenleyici ve makine yönetimi**
- Günler ve satırlar eklenir, düzenlenir, sıralanır ve silinir. Hareket adı düzeltilebilir ve "+ Hareket ekle" gelir.
- Makineler yeniden adlandırılabilir, arşivlenebilir ve arşivden geri alınabilir. Kaydı olan makinenin birimi kilitlidir.
- "Programı sıfırla" eklenir. Gerekirse bu aşama ikiye bölünür.
- *Bitti sayılır:*
  - Hedef değişince yeni antrenman yeni hedefle başlıyor, eski kayıtlar eski hedefi gösteriyor.
  - Adı değişen hareketin ya da makinenin geçmişi kopmuyor.
  - Arşivlenen makine seçim listesinden kalkıyor ama geçmişte görünmeye devam ediyor.

## 9. İlk geliştirme görevi: Aşama 1
Aşama 0 bittikten sonra başlar. Doğrulandıktan sonra durulur ve sonuç size bildirilir.

**Kapsam**
- **Ekran:** tek bir ekran olur: **Push · Rope Pushdown · Hedef 3 × 12–15**. Gün, hareket ve hedef başlangıç verisinden (`js/seed.js`) gelir; program ilk açılışta veritabanına yazılır.
- **Makineler:** Rope Pushdown yalnızca "Kablo" (kg) ile başlar. "+ Makine" ile başka makine eklenir:
  - Adı ve birimi (kg, kademe ya da ağırlıksız) siz seçersiniz; birim önceden seçili gelmez.
  - Boş ad, aynı ad ve seçilmemiş birim reddedilir.
  - Eklenen makine kalıcıdır.
- **Geçen sefer:** makine seçilince, Push'taki Rope Pushdown'ın o makinedeki en son kaydı görünür: tarih ve setler, örneğin "50 kg × 12 · 12 · 11". Kayıt yoksa "Bu makinede önceki kayıt yok" yazar.
- **Kutular:**
  - Tek bir ağırlık kutusu vardır; etiketi makinenin birimidir ("Ağırlık (kg)" ya da "Kademe"). Ağırlık tüm setlere uygulanır.
  - Hedefteki set sayısı (3) kadar tekrar kutusu vardır.
  - Kutular boş başlar; önceki değerler yalnızca soluk ipucudur.
  - Telefonda sayısal klavye açılır. "22,5" ve "22.5" kabul edilir.
- **Kaydet:**
  - En az bir setin tekrarı gerekir. Tekrar girilip ağırlık girilmezse uyarı çıkar; boş tekrar kutuları kaydedilmez.
  - Kayıt durumu görünür: Kaydediliyor… → Kaydedildi ✓ ya da Kaydedilemedi (Tekrar dene). Makine eklerken de aynı durumlar görünür ("Makine eklendi ✓").
  - Kayıt IndexedDB'ye bitmiş bir antrenman olarak yazılır: tarih, gün, hareket, makine, birim, hedefin kopyası ve setler.
  - Başarılı kayıttan sonra kutular temizlenir ve "Geçen sefer" alanında yeni kayıt görünür.
- **Bu aşamada olmayanlar:** diğer gün ve hareketler, otomatik kaydetme, devam eden antrenman, sayaç, dönüşüm, geçmiş, grafik, makineyi yeniden adlandırma ya da arşivleme, yedek, PWA ve görsel tasarım.

**Ekran taslağı**
```
Push · Rope Pushdown                          Hedef: 3 × 12–15
Makine:  (●) Kablo · kg    ( ) Kablo 2 · kademe    [+ Makine]

Geçen sefer — 21 Eyl:   50 kg × 12 · 12 · 11

Ağırlık (kg)   [ 50 ]                          ← tüm setlere uygulanır
Tekrarlar      1. set    2. set    3. set
               [ 12 ]    [ (12) ]  [ (11) ]    ← soluk ipucu: değer değil, boş sayılır
[ Kaydet ]   Kaydedildi ✓
```

**Dosyalar**
| Dosya | Görevi |
|---|---|
| `index.html`, `css/app.css` | sayfa iskeleti ve telefona uygun temel görünüm |
| `js/main.js` | açılış: veritabanını aç, ekranı çiz |
| `js/db.js` | IndexedDB yardımcıları: açma, okuma, yazma |
| `js/store.js` | veri erişim katmanı: `loadProgram()`, `saveProgram()`, `loadSessions()`, `saveSession()`; tek yazma sırası ve kayıt durumu |
| `js/seed.js` | başlangıç verisi: Push, Rope Pushdown, 3 × 12–15, tek makine (Kablo · kg) |
| `js/logic.js` | `parseWeight()`, `collectSets()`, `validationMessage()`, `lastPerformance()`, `equipmentError()`, `withEquipment()` ve biçimlendirme |
| `js/views/exercise-logger.js` | ekran: makine seçimi ve ekleme, geçen sefer, ağırlık ve tekrar kutuları, Kaydet, kayıt durumu |
| `tests/logic.test.js`, `tests/e2e.py` | birim testleri ve uçtan uca senaryo |

**Birim testleri** (`tests/index.html`)
1. Aynı gün, hareket ve makinede birkaç kayıt varsa en yenisini buluyor.
2. Diğer makinenin kaydını getirmiyor.
3. Aynı hareketin aynı makinede başka bir günde yapılan kaydını getirmiyor.
4. Kayıt yoksa "yok" sonucunu döndürüyor; bitmemiş antrenman sayılmıyor.
5. Ağırlık bir kez girilip tekrarı girilen her sete uygulanıyor; boş kutulardan set oluşmuyor.
6. Tekrar girilip ağırlık girilmezse uyarı veriyor; ağırlıksızda tekrar yeter.
7. "22,5" ve "22.5" 22.5 sayısına çevriliyor; geçersiz ağırlık ve tekrar reddediliyor.
8. Setler birime göre yazılıyor: "50 kg × 12 · 12 · 11", "10k × 12 · 12 · 10".
9. Makinenin adı ve birimi denetleniyor: boş ad, aynı ad (büyük/küçük harf fark etmez) ve seçilmemiş birim reddediliyor; ikinci kablo da kg olabiliyor.
10. Yeni makine programın kopyasına ekleniyor; kayıt hedefin kopyasını taşıyor.

**Uçtan uca senaryo** (`tests/e2e.py`, telefon boyutunda Chrome)
1. Başlangıçta yalnızca "Kablo · kg" var; tek ağırlık kutusu ve 3 tekrar kutusu görünüyor.
2. 50 kg ile 12, 12, 11 kaydediliyor; kutular temizleniyor ve "Geçen sefer" güncelleniyor.
3. Sayfa yenilenince kayıt duruyor; kutular boş, yalnızca ipucu var.
4. Boş Kaydet: kayıt yapılmıyor ve uyarı çıkıyor.
5. Tekrar girilip ağırlık girilmezse "Ağırlığı girin" uyarısı çıkıyor; ağırlık yazılınca uyarı kalkıyor.
6. Makine formu boş adı, aynı adı ve seçilmemiş birimi reddediyor; "Vazgeç" formu kapatıyor.
7. "Kablo 2 · kademe" elle ekleniyor; kayıt "10k × 12 · 12 · 10" biçiminde görünüyor.
8. İkinci kablo da kg olabiliyor: "Kablo 3 · kg".
9. Makineler sayfa yenilense de duruyor; kayıtları birbirine karışmıyor.
10. "52,5" kg kaydediliyor ve "Geçen sefer" en yeni kaydı gösteriyor.
11. Set kaydında yazma hatası: "Kaydedilemedi" çıkıyor, değerler kalıyor; "Tekrar dene" kaydediyor.
12. Makine eklerken yazma hatası: form açık kalıyor; "Tekrar dene" makineyi ekliyor.
13. Ekranın açık ve koyu temada ekran görüntüsü alınıp gözle kontrol ediliyor.

**Elle deneme (sizin için)**
- **Bilgisayarda:** `python serve.py` çalıştırıp tarayıcıda http://127.0.0.1:8000 adresini açın.
- **Telefonda (isteğe bağlı):** `python serve.py --lan` çalıştırın ve aynı Wi-Fi'deki telefonda sunucunun yazdığı adresi açın, örneğin http://192.168.1.20:8000.
  - Windows güvenlik duvarı izin isteyebilir.
  - Telefondaki veri bilgisayardakinden ayrıdır; bu beklenen bir durum.

**Tamamlanma:** birim testleri ve uçtan uca senaryo geçer ve değişiklikler "Aşama 1: …" commit'iyle kaydedilir. Sonra durulur.

## 10. Çalışma şekli (her aşamada)
1. Aşamanın kapsamını kısaca konuşuruz. Büyük aşamalarda yine plan modunu kullanabiliriz.
2. Kodu ben yazarım ve her değişikliği kısaca açıklarım. Anlamadığınız her satırı sorabilirsiniz.
3. Birim testlerini ve uçtan uca senaryoyu ben çalıştırırım. Siz de ekranı tarayıcıda ya da telefonda denersiniz.
4. "Bitti sayılır" maddeleri sağlanınca commit atarım ve dururum. Bir şey bozulursa son commit'e dönebiliriz.
5. Yeni kararları `CLAUDE.md` dosyasına işlerim. Böylece yeni bir Claude Code oturumunda bağlam kaybolmaz.
6. GitHub'a gönderme (push) yalnızca sizin onayınızla yapılır.
