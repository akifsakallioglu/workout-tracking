# Ekranlar

Her ekranın yukarıdan aşağı düzeni. Görünüş kuralları [components.md](components.md)'de, gezinme [navigation.md](navigation.md)'dedir; burada yalnızca ekrana özgü olanlar var. Görsellerde olmayan ekranlar (antrenman, ayrıntılar, çakışma) aynı kurallarla çizilir.

Sınıflar ve kimlikler `tests/e2e.py`'de seçici olarak kullanılır. Birini değiştirmeden önce testte ara.

İçindekiler: Ortak düzen · Ana Sayfa · Antrenman · Geçmiş · İlerleme · Program · Ayarlar · Genel öğeler

## Ortak düzen
- Sayfa: `main` en çok 480 px, ortalı, yanlarda `--space-4`.
- Ana ekranlar: uygulama adı ve sekmeler → sayfa başlığı (Ana Sayfa'da yok) → başarı bandı → içerik.
- Alt ekranlar: geri bağlantısı → h1 → varsa kısa açıklama (`.muted`) → başarı bandı → içerik → en sonda silme ya da sıfırlama.
- Başarı bandı (`#flash`) başlığın hemen altındadır; `flash` akışı değişmez.

## Ana Sayfa (`js/views/home.js`)
1. Uygulama adı (h1 "Antrenman Takibi") ve sekmeler.
2. Başarı bandı; yedek hatırlatması (`#backup-reminder`, uyarı kutusu; "Yedek al" bağlantısı `--text` ve alt çizgili).
3. Devam eden antrenman kartı (`.resume`, varsa): `--highlight` kenar; "Devam eden antrenman", gün adı, "Başlangıç: …", ana düğme "Devam et". Görselsiz.
4. "Sıradaki" kartı (`.next`; devam eden antrenman aynı günse gösterilmez): solda küçük üst başlık "Sıradaki", gün adı (`--font-size-2xl`, 700) ve "8 hareket · son: 22 Eyl" (`summary()`); sağda günün görseli ([components.md → Gün görselleri](components.md#gün-görselleri)); altında "Başla". Devam eden antrenman varsa "Başla" ikincil olur; bu bugünkü mantıktır ve ekranda tek ana düğme bırakır. "Başla" içerik genişliğindedir, en az 10rem.
5. "Günler" bölüm başlığı ve sağında "Programı düzenle" bağlantısı.
6. Gün listesi: ad; "6 hareket · son: 29 Eyl", "· devam ediyor" ya da "· henüz yapılmadı"; sağda ›. "N hareket" bugünkü etikettir, kalır.

## Antrenman (`js/views/workout.js`, kart `js/views/exercise-card.js`)
- Üst çubuk: [navigation.md → Antrenman üst çubuğu](navigation.md#antrenman-üst-çubuğu). Altında hata mesajı (`#workout-message`).
- **Kartın sırası:** başlık ve "Hedef 3 × 12" → eklenen kartta "Yalnızca bu antrenmana eklendi" ve "Kaldır" → dönüşümlü satırda "Bugün" çipleri ve öneri metni ("Son yapılan: … · Sıradaki: …") → "Makine" çipleri, "+ Makine", "Düzenle" → makine formu ya da düzenleme modunda makine listesi → "Geçen sefer" kutusu → sayaç (`.counter`, `--muted`) → anlık ilerleme (`.progress-live`, `--highlight`, 600) → ağırlık kutusu → tekrar kutuları → "+ Set" / "− Set" → kartın mesajı.
- **Ağırlık ve tekrar düzeni değişmez:** etiketi birime göre değişen ("Ağırlık (kg)" ya da "Kademe") tek ağırlık kutusu, en çok 160 px; altında "Tekrarlar" ve `repeat(auto-fill, minmax(76px, 1fr))` ızgarasında "1. set", "2. set"… kutuları; ağırlıksız makinede ağırlık kutusu yok. Değişen yalnızca renk, köşe ve boşluk.
- "Geçen sefer" kutusu `--subtle`, sayılar `tabular-nums`; kayıt yoksa "Bu makinede önceki kayıt yok" (`--muted`).
- Makinesi olmayan hareket: "Bu hareket için henüz makine yok…" (`--muted`) ve "+ Makine".
- **Makine listesi** ("Düzenle"): her öğede ad ve birim, sağda "Değiştir" (küçük) ve "Sil" (küçük tehlikeli); "Silinmiş makineler" altında kesik çizgili öğeler ve "Geri al"; en altta "Bitti".
- **Kartların altı:** "+ Hareket ekle" (`.button.add`, tam genişlik) ya da açıkken ekleme formu (kart); en sonda `--space-6` boşlukla "Antrenmanı iptal et" (tehlikeli, tam genişlik). Düzenleme modunda iptal düğmesi yoktur.
- Sekme çubuğu gösterilmez.
- **Düzenleme modu** (`#/gecmis/<kimlik>/duzenle`): aynı kartlar; üst çubukta "← Vazgeç", "Push · 29 Eyl Sal", "Kaydet".
- **Çakışma ekranı** (başka günün antrenmanı devam ederken): geri bağlantısı; kartta küçük üst başlık, h1 "… antrenmanı bitmedi" ve açıklama; düğmeler alt alta ve tam genişlikte: "Devam et" (ana), "Bitir ve … başla" (ikincil), `--space-6` boşluk, en sonda "Sil ve … başla" (tehlikeli).

## Geçmiş (`js/views/history.js`)
- **Liste:** uygulama adı ve sekmeler → h1 "Geçmiş" → başarı bandı → ay grupları, en yeni üstte. Her grubun başında ay başlığı (h2, "Eylül 2026"; Türkçe ay adı ve yıl, `--font-size-md`, 500, `--muted`), altında o ayın antrenmanları. Öğe: solda tarih rozeti ([components.md → Liste öğeleri](components.md#liste-öğeleri)), ortada gün adı (`.day-name`, "Push") ve bilgi ("6 hareket · 18 set · 1 sa 6 dk"; `sessionSummary`, `formatDuration`), sağda ›. Ay ve gün, antrenmanın başladığı yerel tarihe göredir. Liste boşsa "Henüz bitmiş antrenman yok."
- Bugün öğe başlığı "Push · 22 Eyl Sal"dır; tarih rozete ve ay başlığına taşınır. Bu metne bakan test seçicileri aynı adımda güncellenir. Veri değişmez; gruplar kayıtlardan hesaplanır.
- **Ayrıntı:** "← Geçmiş" → h1 "Push · 29 Eyl Sal" → "Başlangıç 18:05 · 1 sa 6 dk · 6 hareket · 18 set" (`--muted`) → her hareket bir kart: h2 "Rope Pushdown · Kablo 2", setler (`--font-size-lg`, `tabular-nums`), "Hedef 3 × 12" (`--muted`) → "Düzenle" (ana) → sayfanın sonunda `--space-6` boşlukla "Sil" (tehlikeli, tam genişlik). Bugün "Sil", "Düzenle"nin yanındadır; silme kuralı gereği ayrılır.

## İlerleme (`js/views/progress.js`)
- **Liste:** uygulama adı ve sekmeler → h1 "İlerleme" → gün grupları: bölüm başlığı (gün adı) ve öğeler ("Machine Chest Press", "9 antrenman · son: 29 Eyl", ›) → "Programda olmayan" grubu (bilgi satırı gün adıyla başlar). Boşsa bugünkü metin.
- **Grafik ekranı:** "← İlerleme" → h1 hareket adı → gün adı (`--muted`) → kart: "Makine" çipleri, sayaç (`#progress-counter`, 600, `--text`), "Ölçü" çipleri, seçili noktanın değeri (`--font-size-xl`, 700) ve tarihi, setleri, grafik → "Kayıtlar" tablosu kartı.
- Grafik renkleri değişkenlerden gelir: çizgi ve nokta `--chart-line` (turuncu), ızgara `--border`, eksen yazısı `--muted`, nokta halkası `--surface`. Çizimdeki her değişiklik `dataviz` skill'iyle yapılır.

## Program (`js/views/program.js`)
- **Program:** geri bağlantısı → h1 "Program" → açıklama (bugünkü metin) → başarı bandı → gün öğeleri (ad, "6 hareket", sağda ↑ ↓; ilk öğenin ↑'ı ve son öğenin ↓'ı kapalı) → "+ Gün ekle" (`.button.add`, tam genişlik) ya da açıkken yeni gün formu (kart: "Yeni günün adı", Ekle / Vazgeç) → mesaj → en sonda "Programı sıfırla" kartı: h2, açıklama, tam genişlik tehlikeli düğme.
- **Gün:** "← Program" → h1 gün adı → başarı bandı → varsa devam eden antrenman uyarısı → "Gün adı" kutusu ve yanında "Kaydet" (ikincil düğme; görseldeki turuncu dolgu alınmadı) → bölüm başlığı **"Satırlar"** → satır öğeleri (başlık `itemTitle`, dönüşümlü satırda "Wrist Curl / Reverse Curl"; "Hedef 3 × 12"; ↑ ↓) → boşsa "Bu günde henüz satır yok." → **"+ Satır ekle"** (`.button.add`, tam genişlik) → en sonda "Günü sil" (tehlikeli, tam genişlik).
- **Satır:** "← gün adı" → h1 **"Satırı düzenle"** ya da **"Yeni satır"** → form kartı: "Hareket" seçimi, makine özeti (`--muted`), "Adı düzelt" (turuncu) ve açılınca `--subtle` ad kutusu; "İkinci hareket (isteğe bağlı)" seçimi; açıklama (bugünkü metin, "Makineler" sözcüğüyle); "Hedef": "Set" ve "En çok tekrar" iki sütunda; mesajlar; eşit genişlikte "Kaydet" (ana) ve "Vazgeç" (ikincil) → kartın dışında, en sonda **"Satırı sil"** (tehlikeli, tam genişlik; yalnızca var olan satırda).
- Görseldeki "Hareketler", "+ Hareket ekle", "Hareketi düzenle" ve "Hareketi sil" kullanılmaz ([mockups.md → Alınmayanlar](mockups.md#alınmayanlar)).

## Ayarlar (`js/views/settings.js`)
- Uygulama adı ve sekmeler → h1 "Ayarlar" → üç kart. Kart başlıklarında simge (`--accent`, süs) ve h2 var; metinler bugünkü hâliyle kalır.
- **Yedek** (indirme simgesi, bulut değil): "Son yedek: …" (`--text`), açıklama (`--muted`), yan yana "Yedeği indir" (ana) ve tarayıcı destekliyorsa "Paylaş…" (ikincil), durum mesajı.
- **Yedeği geri yükle** (yükleme ya da geri dönen ok simgesi): açıklama; "Yedek dosyası" etiketi ve dosya seçici; dosya seçilince uyarı kutusunda özet: tarih, antrenman sayısı, "Geri yükle" (tehlikeli) ve "Vazgeç" (ikincil); mesaj.
- **Kalıcı depolama** (veritabanı simgesi): durum metni; kapalıysa "Kalıcı depolama iste" (ikincil); mesaj.
- Hiçbir metin ya da simge eşitleme ya da bulut izlenimi vermez; veri yalnızca bu cihazdadır.

## Genel öğeler
- Yeni sürüm bandı: [components.md → Mesajlar ve bantlar](components.md#mesajlar-ve-bantlar). Bant görünürken sayfanın sonu bandın altında kalmaz (bugünkü `body:has(...)` kuralı).
- "Yükleniyor…" ve "Uygulama açılamadı…" (`.loading`, `.fatal`): sayfa kenar boşluğuyla düz metin; `.fatal` `--danger`.
