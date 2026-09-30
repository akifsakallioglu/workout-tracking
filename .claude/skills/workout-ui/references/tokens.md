# Tasarım değişkenleri

Ortak değerlerin hepsi `css/app.css` dosyasının başındaki `:root` bloğunda CSS değişkeni olarak durur (`--ad: değer`); kurallar bunları `var(--ad)` ile kullanır. Projede derleme adımı olmadığından (Sass, Tailwind yok) merkezi değerler için doğru araç budur. Tema tek yerden değişir, kontrast bir kez hesaplanır, ekranlar aynı ölçülerle birbirine benzer kalır.

İçindekiler: Kurallar · Renkler · Kontrast · Yazı · Boşluk · Köşe, dokunma alanı, ikon, gölge · Tema ve tarayıcı rengi

## Kurallar
- Renk (`#…`, `rgb()`), yazı boyutu, boşluk ve köşe değerleri yalnızca `:root`'ta yazılır. Kurallarda `1px` kenarlık, `2px` odak çizgisi, `0` ve `100%` gibi yapısal değerler serbesttir.
- Bileşene özgü yerleşim ölçüleri kendi kuralında kalabilir: tekrar ızgarasındaki 76 px sütun, 160 px ağırlık kutusu, 480 px sayfa genişliği gibi. Aynı ölçü ikinci bir yerde gerekirse değişkene taşınır.
- Var olan adlar korunur, değerleri değişir: `--bg`, `--surface`, `--subtle`, `--text`, `--muted`, `--border`, `--input-bg`, `--accent`, `--accent-soft`, `--accent-text`, `--highlight`, `--chart-line`, `--ok`, `--danger`, `--danger-soft`, `--warn-bg`, `--warn-border`. Böylece CSS'in çoğu dokunulmadan yeni renge geçer.
- Yeni değişken anlamına göre adlandırılır (`--danger`), görünüşüne göre değil (`--red`). Eklenen değişken bu dosyadaki tabloya da yazılır.
- JS'e renk yazılmaz. `js/chart.js` SVG'si renkleri CSS sınıflarından alır (`.chart .line { stroke: var(--chart-line) }`).

## Renkler
Yalnızca koyu tema (kullanıcı kararı, 2026-09-30). Açık tema değerleri ve `@media (prefers-color-scheme: …)` blokları kaldırılır; telefon açık temada olsa da uygulama koyu görünür.

| Değişken | Değer | Kullanım |
|---|---|---|
| `--bg` | `#17191c` | Sayfa zemini (antrasit), antrenman üst çubuğu |
| `--surface` | `#212428` | Kart ve liste öğesi |
| `--subtle` | `#2a2e33` | Kart içi kutu: "Geçen sefer", makine formu, ad düzeltme kutusu, tarih rozeti |
| `--border` | `#353a40` | İnce kart ve liste öğesi kenarı, çip kenarı, ayraç, tablo çizgisi, grafik ızgarası |
| `--border-strong` | `#727a84` | Metin kutusu, seçim kutusu ve ikincil düğme kenarı (yeni) |
| `--input-bg` | `#17191c` | Metin kutusu ve seçim kutusu zemini |
| `--text` | `#f2f3f5` | Ana metin |
| `--muted` | `#a4acb5` | Yardımcı metin, etiket, pasif sekme, liste oku (›) |
| `--placeholder` | `#80878f` | Yalnızca kutudaki ipucu, yani önceki değer (yeni) |
| `--accent` | `#f06b29` | Turuncu (simgedeki ton): ana düğme zemini, etkin sekme, bağlantı, odak halkası |
| `--accent-text` | `#17191c` | Turuncu dolgunun üstündeki yazı |
| `--accent-soft` | `rgba(240, 107, 41, 0.16)` | Seçili çipin zemini |
| `--highlight` | `var(--accent)` | Sınırlı vurgu: "Bu antrenmanda ilerledin ✓" yazısı, devam eden antrenman kartının kenarı |
| `--ok` | `#5fcf8f` | "Kaydedildi ✓", başarı mesajı |
| `--ok-soft` | `rgba(95, 207, 143, 0.14)` | Başarı bandının zemini (yeni) |
| `--danger` | `#ff7166` | Silme ve sıfırlama düğmesi, hata metni, hatalı kutunun kenarı |
| `--danger-soft` | `rgba(255, 113, 102, 0.14)` | Hatalı kutunun zemini |
| `--warn-bg` | `rgba(217, 164, 65, 0.14)` | Uyarı kutusu zemini: yedek hatırlatması, geri yükleme özeti |
| `--warn-border` | `#d9a441` | Uyarı kutusu kenarı |
| `--chart-line` | `#e8641f` | Grafik çizgisi ve noktası: turuncunun koyu zemin bandına indirilmiş tonu. `dataviz` doğrulayıcısı koyu zeminde OKLCH açıklığı 0,48–0,67 ister; `#f06b29` 0,681'de kalır |

## Kontrast
Metin en az 4,5:1 (CLAUDE.md kuralı). Bir denetimi tanıtan kenar, odak halkası, sekme çizgisi ve grafik çizgisi en az 3:1 (WCAG 1.4.11). Yarı saydam zeminler altlarındaki zeminle karıştırılarak hesaplandı.

| Ön plan / zemin | Oran | Not |
|---|---|---|
| text / bg · surface · subtle | 15,86 · 14,03 · 12,31 | |
| muted / bg · surface · subtle | 7,67 · 6,79 · 5,95 | |
| placeholder / input-bg | 4,85 | Girilen değerden (15,86) belirgin soluk |
| accent / bg · surface | 5,74 · 5,08 | |
| accent / subtle | 4,45 | **Yazı için geçmez**; kenar ve odak için yeter (≥ 3) |
| accent / warn-bg | 4,51 | Sınırda |
| danger · border-strong / warn-bg (kart içinde) | 4,46 · 2,76 | **Geçmez**; uyarı kutusundaki düğmeler `--surface` zeminli (5,79 · 3,59) |
| accent-text / accent | 5,74 | Beyaz yazı turuncuda 3,07: geçmez |
| ok / bg · surface · ok-soft | 9,07 · 8,02 · 6,94 | |
| danger / bg · surface · subtle | 6,55 · 5,79 · 5,08 | |
| text / danger-soft · warn-bg | 13,00 · 12,46 | |
| border-strong / subtle · surface · bg | 3,14 · 3,59 · 4,05 | |
| chart-line / surface | 4,66 | |
| border / surface | 1,36 | Yalnızca süs ve ayraç |

Sonuçlar:
- Turuncu yazı yalnızca `--bg` ve `--surface` üstünde kullanılır. `--subtle` kutuların ve uyarı kutularının içindeki bağlantı `--text` rengi ve alt çizgiyle yazılır.
- Turuncu dolgulu düğmenin yazısı her zaman `--accent-text` (koyu).
- `--border` bir denetimi tek başına tanıtmaz: metin kutusu, seçim kutusu ve ikincil düğme `--border-strong` kullanır. Kart ve liste öğesi zemin farkıyla ve içeriğiyle tanınır; çip içindeki radyo düğmesiyle tanınır. Bunlarda `--border` yeter.

Bir değer değişirse oranı yeniden hesapla. Yarı saydam renkte önce karıştır: `kanal = ön × alfa + zemin × (1 − alfa)`.

```python
def lum(hex_color):  # "#rrggbb"
    c = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

def ratio(a, b):
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)
```

## Yazı
Sistem yazı tipi kalır: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Web yazı tipi indirilmez; uygulama internetsiz açılır ve dış kaynak kullanmaz.

| Değişken | Değer | Kullanım |
|---|---|---|
| `--font-size-xs` | `0.8125rem` (13 px) | "1. set" etiketi, tarih rozetindeki gün adı, grafik ekseni |
| `--font-size-sm` | `0.875rem` (14 px) | Form etiketi, legend, küçük üst başlık ("Sıradaki"), ipucu metni |
| `--font-size-md` | `1rem` (16 px) | Gövde, liste öğesinin alt metni, sekme, düğme |
| `--font-size-lg` | `1.125rem` (18 px) | Kart ve bölüm başlığı (h2), metin kutusu yazısı |
| `--font-size-xl` | `1.375rem` (22 px) | Uygulama adı satırı, antrenman üst çubuğundaki gün adı, grafikte seçili değer |
| `--font-size-2xl` | `1.75rem` (28 px) | Sayfa başlığı (h1), "Sıradaki" kartındaki gün adı |

- Kalınlık: gövde 400; etiket, sekme ve küçük düğme 500; kart başlığı, liste öğesi başlığı ve düğme 600; sayfa başlığı ve uygulama adı 700.
- Satır yüksekliği: gövde 1.5, başlıklar 1.25.
- Bugünkü ara boyutlar (15 ve 17 px) en yakın basamağa taşınır; okunurluk telefonda kontrol edilir.
- Set, ağırlık, tarih ve tablo sayıları `font-variant-numeric: tabular-nums` ile hizalı durur.
- Metin kutularında yazı en az 16 px'tir; iPhone daha küçük yazıda kutuya odaklanınca ekranı yakınlaştırır.

## Boşluk
4 px tabanlı ölçek. Kartları kompakt yapan, iç boşlukların küçüklüğüdür; dokunma alanları küçülmez.

| Değişken | Değer | Kullanım |
|---|---|---|
| `--space-1` | `4px` | Başlık ile alt metni arası |
| `--space-2` | `8px` | Liste öğeleri, çipler ve yan yana düğmeler arası; etiket ile kutu arası |
| `--space-3` | `12px` | Kartlar arası, kart içindeki bloklar arası, sekmeler arası en az |
| `--space-4` | `16px` | Sayfa kenar boşluğu, kart iç boşluğu |
| `--space-5` | `24px` | Bölümler arası, düğme yatay iç boşluğu |
| `--space-6` | `32px` | Silme ve sıfırlama bölümünü ana eylemlerden ayıran boşluk |

## Köşe, dokunma alanı, ikon, gölge
| Değişken | Değer | Kullanım |
|---|---|---|
| `--radius-sm` | `8px` | Metin kutusu, seçim kutusu, kart içi kutu, tarih rozeti |
| `--radius-md` | `12px` | Kart, liste öğesi, düğme, bant |
| `--radius-pill` | `999px` | Çip |
| `--tap` | `44px` | En küçük dokunma yüksekliği; simge düğmenin eni ve boyu |
| `--icon-md` | `20px` | Liste oku, düğme içindeki simge |
| `--icon-lg` | `24px` | Ayarlar kartlarının başlık simgesi |
| `--shadow-overlay` | `0 8px 24px rgba(0, 0, 0, 0.4)` | Yalnızca sayfanın üstünde duran bant (yeni sürüm); kartlar gölgesiz |
| `--duration-slide` | `200ms` | Kaydırmayla açılan ana ekranın kayması; "hareketi azalt" açıksa kayma yok |

## Tema ve tarayıcı rengi
- `:root { color-scheme: dark; }`: tarayıcının kendi çizdiği parçalar (seçim listesi, dosya seçici, kaydırma çubuğu) da koyu çizilir. Tek tema olduğu için uçtan uca testteki açık/koyu ekran görüntüsü çiftleri tek görüntüye iner.
- `index.html`'deki `<meta name="theme-color">` ile `manifest.webmanifest`'teki `theme_color` ve `background_color` telefonun durum çubuğunu ve açılış ekranını boyar. Bugünkü yeşil (`#034425`) yerine sayfa zemini `#17191c` olur.
- Uygulama simgesi (`icons/icon-*.png`, `apple-touch-icon.png`) değişmez.
- Renkler artık simgeden türemez; ortak olan yalnızca turuncu. CLAUDE.md'deki "Renkler uygulama simgesinden gelir…" maddesi, yenileme uygulanırken bu dosyaya yönlendiren kısa bir maddeyle değiştirilir.
