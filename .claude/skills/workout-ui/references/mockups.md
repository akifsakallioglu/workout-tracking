# Tasarım görselleri

Kullanıcı 2026-09-30'da iki tasarım görseli verdi. Görseller tasarım dilinin kaynağıdır, piksel şartnamesi değildir: renk, yoğunluk, yerleşim ve bileşen biçimi buradan alınır; metin, örnek veri ve görsel üretiminden kalan hatalar alınmaz.

## Dosyalar
Bu klasörde (kullanıcı ekledi, 2026-09-30):
- `mockup-main-tabs.png`: Görsel 1 (Ana Sayfa, Geçmiş, İlerleme, Ayarlar)
- `mockup-program-editor.png`: Görsel 2 (Program, Gün düzenleme, Hareket düzenleme)
- `push.png`, `pull.png`, `legs.png`, `upper.png`, `lower.png`: gün görsellerinin kaynakları ([components.md → Gün görselleri](components.md#gün-görselleri))

Karşılaştırırken tasarım görsellerini açıp bak; ama kuralların kaynağı bu metin ve diğer referanslardır.

## Görsel 1: sekmeli ana ekranlar
Dört telefon ekranı yan yana. Her birinin üstünde "Antrenman Takibi", altında sekmeler var: Ana Sayfa · Geçmiş · İlerleme · Ayarlar. Açık ekranın sekmesi turuncu yazılıdır ve altında turuncu çizgi vardır; diğerleri gridir.
- **Ana Sayfa:** "Sıradaki" kartı: küçük gri "Sıradaki", büyük gün adı "Pull", "8 hareket · son: 22 Eyl", turuncu dolgulu ve koyu yazılı "Başla", sağda turuncu çizgili bir dambıl. Altında "Günler" başlığı ve sağında turuncu "Programı düzenle". Gün öğelerinde ad, "6 hareket · son: 29 Eyl" ve sağda ›.
- **Geçmiş:** h1 "Geçmiş", ay başlığı "Eylül 2026". Öğelerde solda tarih rozeti (üstte "29", altta "Sal"), gün adı, "6 hareket · 18 set · 2 dk" ve sağda ›.
- **İlerleme:** h1 "İlerleme"; gün adıyla gruplar (Push, Pull); öğede hareket adı, "9 antrenman · son: 29 Eyl" ve ›.
- **Ayarlar:** h1 "Ayarlar"; başlıklarında turuncu simge olan üç kart: "Yedekleme" (bulut), "Yedeği geri yükle" (geri dönen ok), "Kalıcı depolama" (veritabanı). "Son yedek: 29 Eyl 23:22"; turuncu "Yedeği indir" ve çerçeveli "Paylaş…"; "Yedek dosyası" altında çerçeveli "Dosya seç" ve "seçili dosya yok"; "Kalıcı depolama: Açık."

## Görsel 2: program ekranları
Üç ekran. Sekme çubuğu yok; sol üstte turuncu geri bağlantısı var: "← Ana Sayfa", "← Program", "← Push".
- **Program:** h1, açıklama, gün öğeleri ("Push", "6 hareket", sağda kare ↑ ↓; ilk öğenin ↑'ı ve son öğenin ↓'ı soluk); tam genişlik, turuncu çerçeveli "+ Gün ekle"; altta "Programı sıfırla" kartı ve kırmızı çerçeveli tam genişlik düğme.
- **Gün düzenleme:** h1 "Push"; "Gün adı" kutusu ve yanında turuncu dolgulu "Kaydet"; "Hareketler" başlığı; öğeler ("Machine Chest Press", "Hedef 3 × 12", ↑ ↓); turuncu çerçeveli "+ Hareket ekle"; kırmızı, tam genişlik "Günü sil".
- **Hareket düzenleme:** h1 "Hareketi düzenle". Kartta "Hareket" seçim kutusu (sağında aşağı ok), "Makineler: Makine 1 · kg, Makine 2 · kg", turuncu "Adı düzelt", "İkinci hareket (isteğe bağlı)" = Yok, açıklama, "Hedef": Set 3 / En çok tekrar 12; eşit genişlikte turuncu "Kaydet" ve çerçeveli "Vazgeç". Kartın dışında kırmızı "Hareketi sil".

## Alınanlar
- Antrasit zemin, biraz açık kartlar, ince kenarlar, beyaz metin, gri yardımcı metin, turuncu vurgu, koyu yazılı turuncu düğme.
- Üstte uygulama adı ve sekme çubuğu; etkin sekmede turuncu yazı ve alt çizgi.
- Alt ekranlarda sekme yerine turuncu geri bağlantısı.
- Başka ekrana götüren liste öğelerinde sağda ›.
- "Sıradaki" kartında sağda turuncu çizim; uygulamada tek dambıl yerine her günün kendi görseli.
- Geçmiş listesinde ay başlığı ve tarih rozeti.
- Ayarlar kartlarında başlık simgesi (bulut hariç).
- Büyük sayfa başlıkları; beyaz ve kalın bölüm başlıkları.
- Tam genişlik ekleme ve silme düğmeleri; formun sonunda eşit genişlikte "Kaydet / Vazgeç".
- Kırmızı çerçeveli silme ve sıfırlama düğmeleri, sayfanın sonunda ve ana eylemden ayrı.
- Kare simge düğmeleri (↑ ↓); uçtaki düğme kapalı ve soluk.

## Alınmayanlar
- **Örnek veri:** tarihler, sayılar, süreler, "Makine 1 · kg", "Eylül 2026". Ekranda gösterilen her şey programdan ve kayıtlardan üretilir.
- **"Hareket" diliyle yazılmış program etiketleri.** Bugünkü adlar kalır: "Satırlar" ("Hareketler" değil), "+ Satır ekle" ("+ Hareket ekle" değil), "Satırı düzenle" ya da "Yeni satır" ("Hareketi düzenle" değil), "Satırı sil" ("Hareketi sil" değil). Bir satır dönüşümlü iki hareket içerebilir. Ayrıca "+ Hareket ekle" uygulamada başka bir işin adıdır (hareketi yalnızca o antrenmana ekler); aynı ad iki işe verilirse karışır.
- **Diğer metin farkları:** "Ekipmanlar" yerine "Makineler", "Yedekleme" yerine "Yedek", "Kalıcı depolama: Açık." yerine bugünkü "açık"; Program ve Ayarlar'daki kısaltılmış açıklamalar yerine bugünkü metinler.
- **Bulut simgesi:** uygulamada eşitleme yoktur, yedek cihaza inen bir dosyadır. Yerine indirme simgesi kullanılır.
- **Görsel üretiminden kalan hatalar:**
  - Gün düzenlemede ilk öğenin ↑'ı ve son öğenin ↓'ı etkin çizilmiş. Doğrusu Program ekranındaki gibi kapalı ve soluktur.
  - Çerçeveli düğmelerin kenar rengi tutarsız: "Paylaş…" turuncu, "Vazgeç" ve "Dosya seç" gri. Kural: ikincil düğme gri, turuncu çerçeve yalnızca ekleme düğmesinde.
  - "+ Gün ekle" tam genişlikte, "+ Hareket ekle" değil. Kural: sayfanın sonundaki ekleme düğmesi tam genişliktedir.

## Görsellerde olmayanlar
Antrenman ekranı, geçmiş ayrıntısı ve düzenlemesi, ilerleme grafiği, başka günün antrenmanı devam ederken çıkan ekran, devam eden antrenman kartı, yedek hatırlatması, başarı bandı, kayıt durumu ve yeni sürüm bandı görsellerde yok. Bunlar aynı dilde, [components.md](components.md) ve [screens.md](screens.md) kurallarıyla çizilir; yeni bir biçim uydurulmaz.

## Verilen kararlar
Kullanıcı 2026-09-30'da karar verdi; kurallar ilgili referanslara işlendi.

1. **Tema:** yalnızca koyu → [tokens.md](tokens.md#renkler)
2. **Renk ve simge:** simge aynı kalır; tarayıcı ve açılış rengi `#17191c`; turuncu `#f06b29` → [tokens.md](tokens.md#tema-ve-tarayıcı-rengi)
3. **Sekme çubuğu:** yalnızca dört ana ekranda; diğer ekranlar geri bağlantılı → [navigation.md](navigation.md#ekranlar-ve-üst-kısımları)
4. **"← Günler":** antrenman, çakışma ve Program ekranlarında "← Ana Sayfa"; sekmeli ekranlarda kalkar → [navigation.md](navigation.md#ekranlar-ve-üst-kısımları)
5. **Geçmiş listesi:** ay başlığı ve tarih rozeti gelir → [screens.md](screens.md#geçmiş-jsviewshistoryjs)
6. **Grafik çizgisi:** turuncu; koyu zeminde `dataviz` doğrulayıcısından geçen ton `#e8641f` → [tokens.md](tokens.md#renkler)
7. **Sıradaki kartı:** dambıl süsü yerine her günün kendi görseli (kullanıcının verdiği PNG'ler) → [components.md](components.md#gün-görselleri)
8. **Gün adının "Kaydet"i:** çerçeveli (ikincil) kalır → [screens.md](screens.md#program-jsviewsprogramjs)

## Karar bekleyenler
Şu an yok. Uygularken görsellerle uygulama arasında yeni bir fark çıkarsa buraya yazılır ve kullanıcıya sorulur.
