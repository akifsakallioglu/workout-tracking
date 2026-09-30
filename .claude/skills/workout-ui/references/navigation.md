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

Eski "← Günler" bağlantısı yok (kullanıcı kararı): antrenman, çakışma ve Program ekranlarında "← Ana Sayfa" (sekmedeki adla aynı); sekmeli ekranlarda geri bağlantısı yoktur.

## Sekme çubuğu
```html
<header class="app-head">
  <h1 class="app-title">Antrenman Takibi</h1>  <!-- Geçmiş, İlerleme ve Ayarlar'da <p class="app-title"> -->
  <nav class="tabs" aria-label="Ana gezinme">
    <a class="tab" href="#/" data-nav="tab" aria-current="page">Ana Sayfa</a>
    <a class="tab" href="#/gecmis" data-nav="tab">Geçmiş</a>
    <a class="tab" href="#/ilerleme" data-nav="tab">İlerleme</a>
    <a class="tab" href="#/ayarlar" data-nav="tab">Ayarlar</a>
  </nav>
</header>
```
- **Bağlantıdır, ARIA sekmesi değildir.** Öğeler `<a href="#/…">` olur; `role="tablist"` ve `role="tab"` kullanılmaz. ARIA sekme deseni aynı sayfadaki panelleri değiştirmek içindir ve ok tuşlarıyla gezinme bekler; burada ise ekran değişir. Bağlantı davranışı da korur: adres değişir, `hashchange` olur, `beforeLeave` çalışır (kaydedilmemiş düzeltmede onay sorar), yeni ekran çizilir. `data-nav="tab"` sayesinde sekme değişimi geçmişe kayıt eklemez (aşağıda "Geçmiş ve kaydırma").
- **Etkin sekme gerçekten açık olan ekrandır.** Tek bir bağlantıda `aria-current="page"` bulunur ve görünüş bu öznitelikten gelir (`.tab[aria-current="page"]`). Ayrı bir "active" sınıfı tutulmaz; böylece görünen ile ekran okuyucunun söylediği birbirinden ayrılamaz.
- **Etkin sekmeyi çizilen ekran belirler, adres metni değil.** Ana sayfa boş adreste ve bilinmeyen adreslerde de açılır; `location.hash` ile karşılaştırma orada hiçbir sekmeyi seçmez. Bunu `js/ui.js`'teki `appHeader(current)` yapar; dört ekran kendi rotasını verir (örneğin `renderHistory` → `appHeader('#/gecmis')`).
- **Görünüş:** sekme yazısı `--font-size-md`, 500, `--muted`. Etkin sekmede yazı `--accent`, altında 3 px kalınlıkta, uçları yuvarlak `--accent` çizgi. Sekmeler satırı kaplar (`justify-content: space-between`, görseldeki gibi); aralarında en az `--space-3` boşluk olur ve her sekme en az `--tap` yüksekliktedir.
- **Dar ekran:** 320 px genişlikte dört sekme sığar. Yazı büyütülüp sığmazsa çubuk kendi içinde yatay kayar (`overflow-x: auto`), sayfa kaymaz. Sekme adı iki satıra bölünmez.
- **Uygulama adı satırı** düz metindir, bağlantı değildir (görseldeki gibi). Ana Sayfa'da sayfanın h1'idir. Diğer üç ekranda h1 sayfa başlığıdır ve uygulama adı `<p>` olur; testler her ekranda tek h1 bekler.
- **Sıra:** başlık ve sekmeler ekranın ilk öğeleridir. Ekran değişince `#app` içi yeniden çizilir; klavyede sonraki Tab yeni ekranın ilk öğesine gelir (bugünkü davranış). Bu yüzden sekmeler ve geri bağlantısı `#app` içinde, en başta durur.

## Geri bağlantısı
```html
<a class="back" href="#/program" data-nav="up">← Program</a>
```
- Sol üstte, başlığın üstünde durur ve sayfanın ilk odaklanan öğesidir.
- `--accent` yazı; en az `--tap` yükseklik (`inline-flex`, dikeyde ortalı). Ok "←" karakteridir; erişilebilir ad "← Program" olarak kalır, testler buna bakar.
- Yazı, gidilen ekranın adıdır: "Ana Sayfa", "Program", gün adı, "Geçmiş", "İlerleme".
- `data-nav="up"` taşır: `main.js` tıklamayı yakalar; geldiğimiz ekran oysa gerçekten geri gider (`history.back()`), değilse bulunulan kaydın yerine geçer. Geçmiş büyümez. Çıkış onayı (`beforeLeave`) yine çalışır; bağlantıya ayrıca tıklama işleyicisi yazılmaz. Formdaki "Vazgeç" bağlantısı da `up`'tır.

## Antrenman üst çubuğu
- `.topbar` yapışkan kalır (`position: sticky; top: 0`); zemini `--bg`, altında 1 px `--border`.
- Solda geri bağlantısı, ortada gün adı (h1, `--font-size-xl`; uzunsa alt satıra geçer), sağda ana eylem: "Bitir", düzenleme modunda "Kaydet". Altında `#save-status`.
- Sekme çubuğu yoktur: antrenman sırasında ekran yalnızca set girmeye ayrılır ve yanlışlıkla başka ekrana geçme olasılığı azalır.
- 320 px'te üç öğe sığmazsa başlık alt satıra geçer; geri bağlantısı ve düğme küçülmez.

## Geçmiş ve kaydırma
Tarayıcı geçmişi, telefona yüklenen bir uygulamadaki gibi tutulur (kullanıcının isteği, Aşama 12). Her kayıt geldiği ekranı bilir (`history.state.from`) ve telefonun geri hareketi uygulamadaki "←" ile aynı yere gider. Geçmişte bulunulan derinlik kadar kayıt olur; sekmeler arasında gidip gelmek kayıt biriktirmez.

| Tür | Nerede | Ne yapar |
|---|---|---|
| Derine giriş (`push`) | Liste öğeleri, "Başla", "Devam et", "Programı düzenle", "Düzenle", "+ Satır ekle"; koddan yeni gün ekleyince | Geçmişe kayıt ekler; sade `<a href>` yeter |
| Üst ekrana dönüş (`up`) | "←" bağlantıları ve formdaki "Vazgeç" (`data-nav="up"`); koddan Bitir, Kaydet, Sil, İptal sonrası | Geldiğimiz ekran oysa `history.back()`, değilse yerine geçer |
| Yerine geçme (`replace`) | Koddan: bulunamayan kayıttan listeye düşerken | Bulunulan kaydın yerine geçer |
| Sekme (`tab`) | Sekmeler ve bir ana ekrana götüren bağlantı ("Yedek al"), `data-nav="tab"` | Ana Sayfa'dan başka sekmeye: kayıt ekler (Ana Sayfa altta kalır); sekmeler arası: yerine geçer; Ana Sayfa'ya: `up` |

- Koddan ekran değiştirmek `navigate(adres, mesaj, tür)` ile olur (`main.js`, ekranlara parametre olarak gelir). Yeni bir bağlantı ya da çağrı eklerken türünü bu tablodan seç; yanlış tür geri hareketini bozar.
- **Kaydırma:** yalnızca dört ana ekranda. Parmak sola kayarsa sıradaki sekme, sağa kayarsa önceki açılır. Karar kuralları `js/swipe.js`'te saf fonksiyonlardır (birim testi); görünüş `main.js`'tedir.
  - **Yön kilidi:** yön ilk 6 px'te belirlenir (`gestureAxis`). Yatay başladıysa parmak kalkana kadar `touchmove` engellenir ve sayfa dikey kaymaz; dikey başladıysa sayfa olağan kayar, sürükleme olmaz. Engelleme için `touchmove` dinleyicisi `passive: false`'tur; yalnızca ana ekranda ve yatay hareket sırasında engeller.
  - **Parmağı izleme:** içerik (başlık ve sekmeler hariç: `.swipe-drag > :not(.app-head)`, `--drag-x`) parmakla kayar. Başlık ve sekmeler yerinde kalır.
  - **Bırakınca** (`swipeResult`): ekranın dörtte biri kadar sürüklendiyse ya da hızla fırlatıldıysa (en az 30 px, 0,5 px/ms) içerik o yöne kayıp çıkar ve yan sekme açılır; yeni içerik karşı kenardan gelir. Değilse yerine döner. Parmak durup öyle kalkarsa hız sıfırdır.
  - **Uçlar:** sekmenin olmadığı yönde içerik parmağın gerisinde kalır ve esner (`stretch`), bırakınca döner.
- **Sekme çizgisi:** durağan çizgi açık sekmenin altındadır (CSS `::after`). Hareket sırasında onun yerine kayan çizgi (`.tab-indicator`, `.tabs.moving`) görünür: sürüklerken yandaki sekmeye doğru yol alır (yer ve genişlik ara değerli), sekmeye dokununca ve geri hareketiyle ana ekranlar arasında geçerken eski yerinden kayar. Hareket bitince durağan çizgiye bırakılır; kendini yeniden çizen ekranda (Ayarlar) çizgi bu yüzden kaybolmaz.
- **Kenarlar telefonundur:** ekranın 24 px kenarından başlayan kaydırma sayılmaz; iPhone'da geri/ileri, Android'de sistem geri hareketidir ve sayfa bunları kapatamaz. Chrome'un kendi yatay kaydırma gezinmesi `html { overscroll-behavior-x: none }` ile kapalıdır.
- Dinleyici bütün sayfadadır (`document`): kısa bir ekranın boş alt kısmı `main`'in dışında kalır.
- Ana ekrana yatay sürüklenen bir öğe (kaydırılan şerit, kaydırıcı) eklenirse kaydırmayla çakışır: ya eklenmez ya da taşan sekme çubuğu gibi dışarıda bırakılır (`main.js`).
- Kaymalar `--duration-slide` sürer. "Hareketi azalt" açıksa içerik ve çizgi kaymaz, bırakınca doğrudan geçer; yön kilidi yine çalışır.
- Kayarken `main` yatayda kırpılır (`overflow-x: clip`), sayfada yatay kaydırma çubuğu çıkmaz; kayma bitince sınıflar kalkar.
- Yan sekme sürüklerken görünmez (iki ekranı aynı anda hazır tutmak büyük bir yapı değişikliği olurdu).
- Test: uçtan uca testteki "Uygulama gibi geçmiş ve kaydırma" akışı, Chrome'a gerçek dokunma hareketi göndererek denetler: izleme, geri dönme, esneme, dikey kilit, dokununca çizgi, "hareketi azalt".

## Yeni ekran eklerken
- Önce ana ekran mı alt ekran mı olduğuna karar ver. Dört sekme sabittir; kullanıcı kararı olmadan yeni sekme eklenmez.
- Ekrana götüren bağlantının ve koddaki `navigate` çağrılarının türünü seç ("Geçmiş ve kaydırma").
- Alt ekranın geri bağlantısı, kullanıcının geldiği yere değil ekranın üst ekranına gider: Satır → Gün → Program → Ana Sayfa. Bugünkü yönlendirme de böyledir.
- Rota `main.js`'e eklenir. Yeni dosya `sw.js` `FILES` listesine, rota CLAUDE.md'deki rota listesine yazılır.
