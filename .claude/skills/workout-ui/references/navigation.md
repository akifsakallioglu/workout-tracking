# Gezinme

## Ekranlar ve üst kısımları
Ana gezinme dört ekrandan oluşur: Ana Sayfa, Geçmiş, İlerleme, Ayarlar. Uygulama adı satırı ve sekme çubuğu yalnızca bunlarda görünür (görsel 1). Diğerleri alt ekrandır: sekme çubuğu yoktur, sol üstte geri bağlantısı ve başlık vardır (görsel 2). Bu ayrım kullanıcı kararıdır (2026-09-30).

| Ekran | Rota | Üst kısım |
|---|---|---|
| Ana Sayfa | `#/`; boş ve bilinmeyen adresler de | Uygulama adı (h1) ve sekmeler |
| Geçmiş | `#/gecmis` | Uygulama adı, sekmeler, h1 "Geçmiş" |
| İlerleme | `#/ilerleme` | Uygulama adı, sekmeler, h1 "İlerleme" |
| Ayarlar | `#/ayarlar` | Uygulama adı, sekmeler, h1 "Ayarlar" |
| Antrenman | `#/antrenman/<gün>` | Yapışkan üst çubuk: ← Ana Sayfa · gün adı · Bitir |
| Başka gün devam ederken | `#/antrenman/<gün>` | ← Ana Sayfa |
| Geçmiş ayrıntısı | `#/gecmis/<kimlik>` | ← Geçmiş |
| Geçmiş düzenleme | `#/gecmis/<kimlik>/duzenle` | Yapışkan üst çubuk: ← Vazgeç · başlık · Kaydet |
| İlerleme grafiği | `#/ilerleme/<gün>/<hareket>` | ← İlerleme |
| Program | `#/program` | ← Ana Sayfa |
| Gün | `#/program/<gün>` | ← Program |
| Satır | `#/program/<gün>/<satır ya da yeni>` | ← gün adı |

Bugünkü "← Günler" bağlantıları değişir (kullanıcı kararı): antrenman, çakışma ve Program ekranlarında "← Ana Sayfa" olur, sekmedeki adla aynı; Geçmiş, İlerleme ve Ayarlar'da kalkar, çünkü oralarda sekmeler var. Testlerdeki "← Günler" seçicileri aynı adımda güncellenir.

## Sekme çubuğu
```html
<header class="app-head">
  <h1 class="app-title">Antrenman Takibi</h1>  <!-- Geçmiş, İlerleme ve Ayarlar'da <p class="app-title"> -->
  <nav class="tabs" aria-label="Ana gezinme">
    <a class="tab" href="#/" aria-current="page">Ana Sayfa</a>
    <a class="tab" href="#/gecmis">Geçmiş</a>
    <a class="tab" href="#/ilerleme">İlerleme</a>
    <a class="tab" href="#/ayarlar">Ayarlar</a>
  </nav>
</header>
```
- **Bağlantıdır, ARIA sekmesi değildir.** Öğeler `<a href="#/…">` olur; `role="tablist"` ve `role="tab"` kullanılmaz. ARIA sekme deseni aynı sayfadaki panelleri değiştirmek içindir ve ok tuşlarıyla gezinme bekler; burada ise ekran değişir. Bağlantı bugünkü davranışı da korur: adres değişir, `hashchange` olur, `beforeLeave` çalışır (kaydedilmemiş düzeltmede onay sorar), yeni ekran çizilir; telefonun geri tuşu da çalışır.
- **Etkin sekme gerçekten açık olan ekrandır.** Tek bir bağlantıda `aria-current="page"` bulunur ve görünüş bu öznitelikten gelir (`.tab[aria-current="page"]`). Ayrı bir "active" sınıfı tutulmaz; böylece görünen ile ekran okuyucunun söylediği birbirinden ayrılamaz.
- **Etkin sekmeyi çizilen ekran belirler, adres metni değil.** Ana sayfa boş adreste ve bilinmeyen adreslerde de açılır; `location.hash` ile karşılaştırma orada hiçbir sekmeyi seçmez. Bunu `js/ui.js`'teki `appHeader(current)` yapar; dört ekran kendi rotasını verir (örneğin `renderHistory` → `appHeader('#/gecmis')`).
- **Görünüş:** sekme yazısı `--font-size-md`, 500, `--muted`. Etkin sekmede yazı `--accent`, altında 3 px kalınlıkta, uçları yuvarlak `--accent` çizgi. Sekmeler satırı kaplar (`justify-content: space-between`, görseldeki gibi); aralarında en az `--space-3` boşluk olur ve her sekme en az `--tap` yüksekliktedir.
- **Dar ekran:** 320 px genişlikte dört sekme sığar. Yazı büyütülüp sığmazsa çubuk kendi içinde yatay kayar (`overflow-x: auto`), sayfa kaymaz. Sekme adı iki satıra bölünmez.
- **Uygulama adı satırı** düz metindir, bağlantı değildir (görseldeki gibi). Ana Sayfa'da sayfanın h1'idir. Diğer üç ekranda h1 sayfa başlığıdır ve uygulama adı `<p>` olur; testler her ekranda tek h1 bekler.
- **Sıra:** başlık ve sekmeler ekranın ilk öğeleridir. Ekran değişince `#app` içi yeniden çizilir; klavyede sonraki Tab yeni ekranın ilk öğesine gelir (bugünkü davranış). Bu yüzden sekmeler ve geri bağlantısı `#app` içinde, en başta durur.

## Geri bağlantısı
```html
<a class="back" href="#/program">← Program</a>
```
- Sol üstte, başlığın üstünde durur ve sayfanın ilk odaklanan öğesidir.
- `--accent` yazı; en az `--tap` yükseklik (`inline-flex`, dikeyde ortalı). Ok "←" karakteridir; erişilebilir ad "← Program" olarak kalır, testler buna bakar.
- Yazı, gidilen ekranın adıdır: "Ana Sayfa", "Program", gün adı, "Geçmiş", "İlerleme".
- Düz bir bağlantıdır. Çıkış onayı (`beforeLeave`) `main.js`'te zaten çalışır; bağlantıya ayrıca tıklama işleyicisi yazılmaz.

## Antrenman üst çubuğu
- `.topbar` yapışkan kalır (`position: sticky; top: 0`); zemini `--bg`, altında 1 px `--border`.
- Solda geri bağlantısı, ortada gün adı (h1, `--font-size-xl`; uzunsa alt satıra geçer), sağda ana eylem: "Bitir", düzenleme modunda "Kaydet". Altında `#save-status`.
- Sekme çubuğu yoktur: antrenman sırasında ekran yalnızca set girmeye ayrılır ve yanlışlıkla başka ekrana geçme olasılığı azalır.
- 320 px'te üç öğe sığmazsa başlık alt satıra geçer; geri bağlantısı ve düğme küçülmez.

## Yeni ekran eklerken
- Önce ana ekran mı alt ekran mı olduğuna karar ver. Dört sekme sabittir; kullanıcı kararı olmadan yeni sekme eklenmez.
- Alt ekranın geri bağlantısı, kullanıcının geldiği yere değil ekranın üst ekranına gider: Satır → Gün → Program → Ana Sayfa. Bugünkü yönlendirme de böyledir.
- Rota `main.js`'e eklenir. Yeni dosya `sw.js` `FILES` listesine, rota CLAUDE.md'deki rota listesine yazılır.
