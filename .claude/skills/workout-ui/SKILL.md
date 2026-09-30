---
name: workout-ui
description: "Antrenman Takibi uygulamasının arayüz tasarım dili ve denetim listesi: koyu antrasit tema ve sınırlı turuncu vurgu, css/app.css başındaki merkezi tasarım değişkenleri (renk, yazı boyutu, boşluk, köşe), Ana Sayfa · Geçmiş · İlerleme · Ayarlar sekmeleri ve geri bağlantıları, antrenman kartları, düğmeler, form alanları, listeler, ikonlar, erişilebilirlik (kontrast, klavye odağı, taşma, dokunma alanı). Bu projede arayüz, gezinme, kart, form ya da mobil görünüm üzerinde çalışırken kullan: bir ekranın görünüşü, yerleşimi, rengi ya da CSS'i değişecekse, yeni bir ekran veya arayüz öğesi eklenecekse, tasarım görselleriyle karşılaştırma yapılacaksa ya da görünüşle ilgili bir hata düzeltilecekse. Kullanıcı tasarım ya da skill sözcüğünü hiç kullanmasa bile geçerlidir. Veri, kaydetme, hesaplama ve yedek mantığı işleri için değil."
---

# Antrenman Takibi arayüzü

Uygulama salonda, telefonda, çoğu zaman tek elle ve kısa bakışlarla kullanılır. Tasarım bu yüzden sakin ve okunaklıdır: koyu antrasit zemin, biraz açık kartlar, ince kenarlıklar, beyaz ana metin, okunaklı gri yardımcı metin. Turuncu az kullanılır; az olduğu için "buraya bas" ve "buradasın" anlamı taşır.

Bu çalışma görsel yenilemedir: ekranlar aynı işi aynı veriyle yapar, yalnızca görünüş değişir.

## Başlarken
- CLAUDE.md teknik kısıtları (derleme yok, npm yok, harici kütüphane yok), rotaları, veri ve kaydetme kurallarını anlatır. Bu skill onları tekrarlamaz, yalnızca arayüze etkilerini söyler.
- Ekranın bugünkü hâline bak: `tests/artifacts/*.png` (uçtan uca testin telefon boyutundaki ekran görüntüleri; yoksa test çalışınca oluşur) ya da sunucuyu açıp 390 px genişlikte.
- Yalnızca işine yarayan referansı oku:

| Dosya | Ne zaman |
|---|---|
| [tokens.md](references/tokens.md) | Renk, yazı boyutu, boşluk, köşe, kontrast; `:root` değişkeni eklerken ya da değiştirirken |
| [components.md](references/components.md) | Düğme, kart, liste öğesi, form alanı, çip, ikon, mesaj ve bant |
| [navigation.md](references/navigation.md) | Sekme çubuğu, geri bağlantıları, yeni ekran ya da rota |
| [screens.md](references/screens.md) | Belirli bir ekranda çalışırken: ana sayfa, antrenman, geçmiş, ilerleme, program, ayarlar |
| [mockups.md](references/mockups.md) | Tasarım görselleriyle karşılaştırırken; görselden ne alınır, ne alınmaz; verilen ve bekleyen kararlar |
| [checklist.md](references/checklist.md) | İşi bitirmeden önce: kontrast, odak, taşma, dokunma alanı, testler |

Görseller de `references/` içinde: iki tasarım görseli (`mockup-main-tabs.png`, `mockup-program-editor.png`) ve beş gün görselinin kaynağı (`push.png`, `pull.png`, `legs.png`, `upper.png`, `lower.png`).

## Çalışma sırası
1. **Açık karara dokunuyorsan önce sor.** [mockups.md → Karar bekleyenler](references/mockups.md#karar-bekleyenler) listesindeki bir konuda kullanıcının vermediği kararı varsayma. Verilen kararı ilgili referansa, proje genelini ilgilendiriyorsa CLAUDE.md'ye yaz ve listeden çıkar.
2. **Önce değişken, sonra kural.** Yeni bir renk ya da ölçü gerekiyorsa `css/app.css` başındaki `:root`'a anlamlı bir adla ekle; bileşen kuralına ham renk ya da tek seferlik ölçü yazma. Böylece tema tek yerden değişir ve kontrast bir kez denetlenir.
3. **Yapıyı ve adları koru.** JS'te yalnızca şablon HTML'i ve sınıflar değişir. `data-action`, `data-field`, `data-card`, `data-form`, `id`'ler, form alanı adları, olay akışı ve düğme ya da bağlantı metinleri yerinde kalır, çünkü kod ve `tests/e2e.py` bunlara bağlıdır. Bir sınıfı ya da metni değiştirmeden önce testte ara; bilerek değişiyorsa testi aynı adımda güncelle.
4. **Gerçek veriyle kur.** Görsellerdeki tarih, sayı, kayıt ve adlar örnektir. Ekranda gösterilen her şey programdan ve kayıtlardan gelir.
5. **Bitirmeden [checklist.md](references/checklist.md)'yi uygula:** kontrast, klavye odağı, 320 ve 390 px'te taşma, 44 px dokunma alanı, testler ve ekran görüntüleri.

## Değişmeyenler
- **Davranış:** otomatik kaydetme ve kayıt durumu, devam eden antrenman ve taslağı, makine ekleme ve düzenleme, dönüşümlü satırlar, geçmiş ve düzeltme, ilerleme ve grafikler, yedekleme, çevrimdışı çalışma, ekrandan çıkarken sorulan onaylar (`beforeLeave`).
- **Veri şeması ve depolama anahtarları.** Görsel bir iş için veritabanına alan eklenmez; ekrandaki her yeni bilgi mevcut kayıtlardan hesaplanır.
- **Ağırlık ve tekrar girişi:** hareket başına tek ağırlık kutusu, set başına tekrar kutusu, "+ Set" / "− Set", sayısal klavye, kutularda en az 16 px yazı. Yerleşim aynı kalır; yalnızca renk, köşe ve boşluk değişir.
- **Kavramlar ve metinler:** "Satır" (programdaki bir sıra; dönüşümlü satırda iki hareket olabilir), "Hareket", "Makine" ve bugünkü etiketler kalır. Görsellerdeki farklı metinler kullanılmaz; metin ancak kullanıcı isterse değişir.
- **Yeni ürün özelliği eklenmez.** Görselde olup uygulamada olmayan bir şey özellik gibi duruyorsa önce sor.

## Kapsam dışı
- Grafiğin çizimi (eksen, çizgi, nokta, etkileşim): `dataviz` skill'i ve `js/chart.js`. Bu skill yalnızca grafiğin renk değişkenlerini verir.
- Veri, kaydetme, hesaplama, yedek biçimi: CLAUDE.md, `js/logic.js`, `js/store.js`.
