# Bileşenler

Her bileşen [tokens.md](tokens.md)'deki değişkenlerle çizilir. Sınıf adları bugünkü CSS'ten gelir; "yeni" yazanlar önerilen eklerdir.

İçindekiler: Turuncu nerede · Düğmeler · Kartlar · Liste öğeleri · Form alanları · Çipler · Başlıklar ve metin · Mesajlar ve bantlar · İkonlar · Gün görselleri · Tablo

## Turuncu nerede kullanılır
Turuncu az olduğu için anlam taşır. Bir ekranda aynı anda en fazla bir turuncu dolgulu düğme görünür.
- **Dolgu:** yalnızca ana eylem düğmesi: Başla, Devam et, Bitir, Kaydet, Ekle, Yedeği indir, Güncelle.
- **Yazı ya da çizgi:** etkin sekme; bağlantılar (geri bağlantısı, "Programı düzenle", "Adı düzelt"); ekleme düğmeleri ("+ Gün ekle", "+ Satır ekle", "+ Hareket ekle", "+ Makine"); seçili çipin kenarı; odak halkası; anlık ilerleme metni; devam eden antrenman kartının kenarı; Ayarlar kartlarının başlık simgesi; "Sıradaki" kartındaki gün görseli; grafik çizgisi.
- **Başka hiçbir yerde:** ikincil düğmeler, çipler, liste öğeleri, liste okları ve ayraçlar nötrdür.

## Düğmeler
| Tür | Sınıf | Görünüş | Örnekler |
|---|---|---|---|
| Ana | `.button.primary` | `--accent` zemin, `--accent-text` yazı, 600 | Başla, Devam et, Bitir, Kaydet, Ekle, Yedeği indir |
| İkincil | `.button.secondary` | Saydam zemin, `--border-strong` kenar, `--text` yazı | Vazgeç, Paylaş…, Tekrar dene, Kalıcı depolama iste, Bitir ve … başla |
| Ekleme | `.button.add` | Saydam zemin, `--accent` kenar ve yazı | + Gün ekle, + Satır ekle, + Hareket ekle |
| Tehlikeli | `.button.danger` | Saydam zemin, `--danger` kenar ve yazı | Sil, Günü sil, Satırı sil, Programı sıfırla, Antrenmanı iptal et, Geri yükle |
| Küçük | `.button.small` | İkincil gibi; yatay boşluğu dar, 500 | + Set, − Set, Değiştir, Kaldır, Geri al, Bitti, Adı kaydet |
| Küçük tehlikeli | `.button.small.danger` | Küçük; `--danger` kenar ve yazı | Makine listesindeki Sil |
| Simge | `.button.small.icon` | `--tap` × `--tap` kare, ok karakteri ortada | ↑ ↓ |

- `.secondary` nötrdür; turuncu çerçeve yalnızca ekleme düğmelerindedir (`.add`).
- Hepsi en az `--tap` (44 px) yüksek; köşe `--radius-md`; yazı `--font-size-md`. Küçük düğme de en az 44 × 44 px'tir; "Sil" gibi kısa yazıda genişlik düşmesin diye `min-width` da vardır. Kompaktlık yüksekliği azaltarak değil, yatay boşluğu daraltarak sağlanır.
- **Genişlik:** sayfanın sonunda tek başına duran ekleme ve silme düğmeleri tam genişliktir (`.button.block`). Formun sonundaki "Kaydet / Vazgeç" gibi çiftler yan yana ve eşit genişliktedir, ana eylem solda. Kart içindeki diğer düğmeler içerik genişliğindedir.
- **Silme ve sıfırlama ana eylemin yanında durmaz:** sayfanın sonunda, üstünde `--space-6` boşlukla ya da kendi kartındadır. İki istisna var: makine listesindeki küçük "Sil" öğenin en sağında durur; geri yükleme özetindeki "Geri yükle" zaten ayrı bir onay kutusunda olduğundan "Vazgeç" ile yan yana durabilir.
- **Kapalı düğme** (`disabled`): `opacity: 0.45`, imleç normal. Yazma sürerken (`busy`) kapanan düğmelerin mantığı JS'tedir; CSS yalnızca görünüşü verir.
- **Basılı durum:** `:active` hafif koyulaşma. Üzerine gelme (hover) biçimi yalnızca `@media (hover: hover)` içinde.
- Bağlantı görünümlü düğme (`.link-button`, "Adı düzelt") turuncu yazıdır ve yine en az 44 px yükseklikte dokunulur.

## Kartlar
- `.card`: `--surface` zemin, 1 px `--border`, `--radius-md`, iç boşluk `--space-4`. Gölge yok.
- Kart içindeki bloklar arası ve kartlar arası `--space-3`.
- **Kart başlığı:** solda başlık (h2, `--font-size-lg`, 600), sağda kısa bilgi ("Hedef 3 × 12", `--muted`, satır kırılmaz). Başlık uzunsa alt satıra geçer (`min-width: 0; overflow-wrap: anywhere`); sağdaki bilgi ilk satırla hizalı kalır ve küçülmez.
- **Kart içi kutu** ("Geçen sefer", makine formu, ad düzeltme): `--subtle` zemin, `--radius-sm`, iç boşluk `--space-3`. İçinde turuncu yazı yok.
- **Vurgulu kart** (devam eden antrenman): kenar `--highlight`.
- **Ayarlar kartı:** başlık satırında solda simge (`--icon-lg`, `--accent`, süs), yanında h2.

## Liste öğeleri
Başka ekrana götüren öğeler: ana sayfadaki günler, geçmiş, ilerleme listesi, program günleri ve satırları.
- Öğenin tamamı tek bağlantıdır: `<li><a class="day" href="…">…</a></li>`. `js/ui.js`'teki `linkItem(href, başlık, bilgi)` bu yapıyı üretir: başlık ve bilgi `.day-text` içinde, sağda ok. Bağlantının içine düğme konmaz; ↑ ↓ gibi düğmeler bağlantının kardeşidir (`.program-row` içinde `.program-link` ve `.move-buttons`).
- Görünüş: `--surface` zemin, 1 px `--border`, `--radius-md`, en az 56 px yükseklik, iç boşluk dikeyde `--space-3` yatayda `--space-4`; öğeler arası `--space-2`.
- İçerik: başlık (`.day-name`, 600, `--text`) ve altında bilgi (`.muted`). Metin sütunu `flex: 1; min-width: 0`; uzun ad alt satıra geçer.
- Sağda liste oku (›): SVG, `--icon-md`, `--muted`, `aria-hidden="true"`, küçülmez (`flex: none`). Program listelerinde ok yok; sağda ↑ ↓ var.
- Tarih rozeti (Geçmiş listesi): solda 48 × 48 `--subtle` kutu, `--radius-sm`; üstte gün sayısı (`--font-size-lg`, 600, `tabular-nums`), altta kısa gün adı (`--font-size-xs`, `--muted`). Rozet gerçek metindir, gizlenmez; ekran okuyucu "29 Sal Push …" diye okur, ay ve yıl üstteki ay başlığındadır.

## Form alanları
- **Etiket** kutunun üstündedir: `--font-size-sm`, `--muted`; `label for` ile `id` bağlı. Radyo grupları `fieldset` ve `legend` ile (bugünkü yapı).
- **Metin kutusu:** tam genişlik (ağırlık kutusu en çok 160 px), en az `--tap` yükseklik, `--input-bg` zemin, 1 px `--border-strong`, `--radius-sm`, `--font-size-lg`. Sayı kutularında (`inputmode` decimal ya da numeric) girilen değer `--text` ve 600, ad kutularında 400; ipucu (`::placeholder`) `--placeholder` ve 400. Böylece önceki değerin yalnızca ipucu olduğu, kutuyu doldurmadığı ilk bakışta anlaşılır.
- **Odak:** `outline: 2px solid var(--accent); outline-offset: 2px`.
- **Hata:** `aria-invalid="true"` → `--danger` kenar ve `--danger-soft` zemin. Açıklama kartın ya da formun altındaki mesajdadır (`.message`, `role="alert"`); renk tek işaret değildir.
- **Seçim kutusu** (`select`): metin kutusuyla aynı ölçü ve renkler. Tarayıcının kendi oku kalabilir (`color-scheme: dark` onu koyu çizer). Görseldeki gibi özel ok istenirse `appearance: none` ve kutuyu saran bir öğedeki `aria-hidden` SVG ile yapılır (`pointer-events: none`); seçim kutusunun kendisi olduğu gibi kalır.
- **Yan yana form** (gün adı ve Kaydet): kutu `flex: 1`, düğme yanında; ikisi de 44 px ve alt kenardan hizalı.
- **Hedef kutuları** (Set / En çok tekrar): iki eşit sütun (bugünkü ızgara).
- **İpucu metni** (`.field-hint`, `.machine-summary`): `--font-size-sm`, `--muted`.
- **Dosya seçici** (geri yükleme): tarayıcının `<input type="file">`'ı kalır (`#restore-file`, `accept`, `change` olayı). Yalnızca düğmesi `::file-selector-button` ile ikincil düğme gibi biçimlenir; seçilen dosyanın adı `--muted`. Görseldeki dosya simgesi için gizli girdi ile etiket-düğme gerekir ve dosya adını JS yazar; bu yapı değişikliği olduğundan önce sorulur.

## Çipler
Radyo seçimleri: makine, dönüşümlü satırda "Bugün" hareketi, birim, grafik ölçüsü.
- Yapı aynı kalır: `<label class="chip"><input type="radio" …> Ad</label>`. Radyo görünür kalır (`accent-color: var(--accent)`); böylece seçim yalnızca renge bağlı olmaz.
- Görünüş: `--radius-pill`, en az `--tap` yükseklik, yatayda 14 px iç boşluk, 1 px `--border`, `--text`.
- Seçili: `.chip:has(input:checked)` → `--accent` kenar, `--accent-soft` zemin.
- Odak: `.chip:has(input:focus-visible)` → odak halkası çipin çevresinde.
- Uzun ad çipin içinde alt satıra geçer (`overflow-wrap: anywhere`); çipler `flex-wrap` ile dizilir, yatay taşma olmaz.
- "+ Makine" (`.chip.add`): kesik çizgili `--border-strong` kenar, `--accent` yazı. "Düzenle" (`.chip.edit`): kenarsız, `--muted`.

## Başlıklar ve metin
- **Sayfa başlığı** (h1): `--font-size-2xl`, 700. Her ekranda tek h1 vardır; testler buna bakar.
- **Uygulama adı satırı** ("Antrenman Takibi"): `--font-size-xl`, 700. Ayrıntısı [navigation.md](navigation.md)'de.
- **Bölüm başlığı** (`.section-title`: Günler, gün grupları, Satırlar): `--font-size-lg`, 600, `--text`. Sağında bağlantı olabilir ("Programı düzenle"); ikisi aynı satırdadır, sığmazsa bağlantı alt satıra geçer.
- **Küçük üst başlık** (`.eyebrow`: Sıradaki, Devam eden antrenman): `--font-size-sm`, `--muted`.
- **Yardımcı metin** (`.muted`): `--muted`. Önemli bilgi (sayaç, "Son yedek: …") `--text`.

## Mesajlar ve bantlar
| Öğe | Görünüş |
|---|---|
| Başarı bandı (`.flash`, `role="status"`) | `--ok-soft` zemin, `--ok` yazı, `--radius-sm` |
| Uyarı kutusu (`.reminder`, `.restore-summary`) | `--warn-bg` zemin, 1 px `--warn-border`, `--text` yazı; içindeki bağlantı `--text` ve alt çizgili |
| Hata metni (`.message`, `role="alert"`) | `--danger` yazı; boşken gizli |
| Durum metni (`.status-message`) | `--ok` yazı |
| Kayıt durumu (`#save-status`) | Kaydediliyor… `--muted`; Kaydedildi ✓ `--ok`; Kaydedilemedi `--danger` ve ikincil "Tekrar dene" |
| Yeni sürüm bandı (`#update-banner`) | Alta sabit; `--surface`, 1 px `--accent` kenar, `--radius-md`, `--shadow-overlay`; alt boşluğa `env(safe-area-inset-bottom)` eklenir |

Mesaj metinleri ve `role` öznitelikleri değişmez; ekran okuyucu bunları bugün nasıl okuyorsa öyle okur.

## İkonlar
- Satır içi SVG kullanılır. İkon yazı tipi, ikon kütüphanesi ya da CDN kullanılmaz: CLAUDE.md harici kütüphaneyi yasaklar ve uygulama internetsiz açılmalıdır.
- **Tek yer:** `js/ui.js`'teki `icon(name)` SVG metni döndürür; yeni simge `ICONS` nesnesine yol (path) olarak eklenir. Biçim: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, yuvarlak uçlar, `class="icon"`, `aria-hidden="true"`, `focusable="false"`. Ayrı bir JS dosyası açılırsa `sw.js` `FILES` listesine eklenir (CLAUDE.md).
- Renk yazıdan gelir (`currentColor`): liste oku `--muted`, Ayarlar simgesi `--accent`. Boyut `--icon-md` ya da `--icon-lg`.
- Yazının yanındaki simge süstür (`aria-hidden`), adı yazı verir. Yalnız simgesi olan düğmenin `aria-label`'ı olur (↑ ↓ düğmelerinde bugün var).
- Metindeki işaretler karakter olarak kalır: ←, ↑, ↓, +, −, ✓, ·. Erişilebilir adlar ve testler bunlara bağlıdır.
- Gereken SVG'ler yalnızca şunlar: liste oku (sağa bakan açılı ok); Yedek için indirme (aşağı ok ve tepsi); Yedeği geri yükle için yükleme ya da geri dönen ok; Kalıcı depolama için veritabanı. Seçim kutusu oku isteğe bağlıdır (Form alanları). "Sıradaki" kartındaki gün görselleri SVG değil PNG'dir; aşağıdaki "Gün görselleri" bölümü.
- **Bulut simgesi kullanılmaz:** uygulamada eşitleme yoktur, yedek cihaza inen bir dosyadır.
- Simgeler basit yollarla (path) elle çizilir. Hazır bir setten alınırsa lisansı kontrol edilir ve kaynağı not edilir.

## Gün görselleri
Her günün kendi turuncu çizim görseli vardır (kullanıcı kararı, görseldeki dambılın yerine).
- **Kaynak:** `references/push.png`, `pull.png`, `legs.png`, `upper.png`, `lower.png`. Kullanıcının seçtiği dosyalardır: 1254 × 1254, zemini saydam, çizgisi turuncu. Adları başlangıç programındaki gün kimlikleriyle aynıdır.
- **Nerede:** yalnızca Ana Sayfa'daki "Sıradaki" kartında. Gün listesi, devam eden antrenman kartı ve diğer ekranlar görselsizdir (görseldeki gibi).
- **Eşleşme gün kimliğiyle:** gün adı değişse de görsel kalır. Sonradan eklenen günlerde (`day-…`) görsel yoktur; kart görselsiz de düzgün durur. Eşleme `js/ui.js`'teki `dayImage(dayId)`'dedir ve veritabanına yazılmaz.
- **Uygulamaya kaynak dosya konmaz:** her biri 150–540 KB, toplam 1,5 MB; telefona önbelleğe gereksiz yük olur. Görüntülenen boyutun 3 katında küçültülmüş kopyalar `icons/day-<gün>.png` olarak üretilir. Üretim `tools/render_day_images.py` ile kurulu Chrome'da yapılır (Pillow kurulu değil); çıktılar 264 px ve her biri 11–40 KB. Kopyalar `sw.js` `FILES` listesine eklenir; uçtan uca test `icons/` altındaki her dosyanın listede olduğunu denetler.
- **İşaretleme:** `<img class="day-art" src="icons/day-push.png" alt="" width="88" height="88">`. Görsel süstür, `alt=""` ile ekran okuyucu atlar; gün adı zaten başlıkta yazar.
- **Yer ve boyut:** kartın sağında, metin sütununun yanında, dikeyde ortalı; 88 × 88 CSS px, `object-fit: contain`, `flex: none`. 360 px'ten dar ekranda 64 px. Metin sütunu `min-width: 0`'dır; uzun gün adı görselin altına kaymaz, alt satıra geçer. "Başla" metnin altındadır.
- **Renk:** PNG olduğu için değişkenle boyanmaz. Çizgiler `--accent`'e çok yakın turuncudur (#e9792f–#f27924). Turuncu değişirse görseller yeniden hazırlanır. Kartta görsel ve "Başla" dışında turuncu yoktur.
- **Denetlendi (2026-09-30):** koyu kartta beşi de temiz görünüyor; zeminler saydam. `upper.png`'nin saydam piksellerinde renk kalıntısı var ama alfa 0 olduğu için görünmez. Küçültürken saydamlık korunmalı.

## Tablo ("Kayıtlar")
- Başlık hücreleri `--font-size-sm`, 500, `--muted`; satırlar `--border` ile ayrılır; sayılar `tabular-nums`.
- Tarih sütunu kırılmaz, "Setler" sütunu alt satıra geçebilir; tablo kartın dışına taşmaz.
