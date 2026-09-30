# Bitirmeden önce

Her arayüz değişikliğinden sonra uygulanır. Sunucu ve test komutları CLAUDE.md'nin "Testler" bölümündedir.

## Kontrast
- [ ] Yeni ya da değişen her renk çifti [tokens.md](tokens.md#kontrast) tablosunda var; yoksa hesaplandı ve tabloya eklendi. Metin en az 4,5:1; denetim kenarı, odak halkası, sekme çizgisi ve grafik çizgisi en az 3:1.
- [ ] Turuncu yazı `--subtle` kutuda ya da uyarı kutusunda kullanılmıyor.
- [ ] Turuncu dolgunun yazısı koyu (`--accent-text`).
- [ ] Bilgi yalnızca renkle verilmiyor: hata metinle, seçili çip radyo düğmesiyle, etkin sekme alt çizgiyle de belli.

## Klavye odağı
- [ ] Bağlantı, düğme, çip, kutu ve grafik Tab ile ekrandaki okuma sırasında geziliyor.
- [ ] Her öğede odak görünüyor: 2 px `--accent` çizgi, 2 px boşluk; çipte `.chip:has(input:focus-visible)`. `outline: none` yalnızca yerine görünür bir odak biçimi konduysa kullanılıyor.
- [ ] Sekme çubuğunda tek bir `aria-current="page"` var ve açık ekranı gösteriyor; alt ekranda ilk odak geri bağlantısında.
- [ ] Açılan form ilk kutusuna odaklanıyor, kapanınca odak açan düğmeye dönüyor. Bu bugünkü davranıştır; şablon değişince bozulmamalı.

Uçtan uca testteki "Tasarım" akışı taşmayı ve dokunma alanını ana ve alt ekranlarda, 390 ve 320 px'te kendiliğinden denetler. Yeni bir ekran ya da form durumu eklenince o akışa da eklenir; aşağıdaki maddeler akışın kapsamadığı durumlar ve elle bakış içindir.

## Taşma
- [ ] 390 px (test boyutu) ve 320 px genişlikte yatay kaydırma yok. Konsolda `document.documentElement.scrollWidth <= document.documentElement.clientWidth` doğru dönmeli.
- [ ] Uzun adlarla denendi: 60 karakterlik hareket adı, 40 karakterlik makine adı, 30 karakterlik gün adı ve boşluksuz uzun bir sözcük. Başlık alt satıra geçiyor; "Hedef", ↑ ↓, ›, "Kaldır" ve "Bitir" üstüne binmiyor, küçülmüyor.
- [ ] Tarayıcıda yazı büyütülünce sekme çubuğu kendi içinde kayıyor, sayfa kaymıyor.

## Dokunma alanı
- [ ] Düğme, çip, sekme, liste öğesi ve kutular en az 44 px yüksek; simge düğmeleri 44 × 44; yan yana hedefler arasında en az 8 px var. Paragraf içindeki metin bağlantısı ("Yedek al") bunun dışında.
- [ ] Denetim (tarayıcı konsolunda ya da Playwright'ta `page.evaluate` ile). Boş liste beklenir:
  ```js
  [...document.querySelectorAll('a, button, select, input:not([type=radio]), label.chip')]
    .filter((el) => el.getClientRects().length && !el.closest('p'))
    .map((el) => [el, el.getBoundingClientRect()])
    .filter(([, box]) => box.height < 44 || box.width < 44)
    .map(([el, box]) => `${el.outerHTML.slice(0, 80)} → ${Math.round(box.width)}×${Math.round(box.height)}`);
  ```

## Davranış ve testler
- [ ] Değiştirilen her sınıf, kimlik ve metin `tests/e2e.py`'de arandı; bilerek değişenler testte de güncellendi.
- [ ] `data-action`, `data-field`, `data-card`, `data-form`, form alanı adları ve olay akışı değişmedi.
- [ ] Birim testleri ve uçtan uca test geçiyor. `tests/artifacts/` ekran görüntülerine bakıldı; değişen ekranın görüntüsü yoksa teste eklendi.
- [ ] Yayın kuralları uygulandı: CLAUDE.md'ye göre `sw.js` `VERSION` artırıldı, yeni dosya `FILES` listesine eklendi.
- [ ] Uygulamaya giren görseller küçültülmüş kopyalardır (kaynak dosyalar değil), `FILES` listesindedir ve internetsiz açılışta görünür.
- [ ] Telefonda denenecekler kullanıcıya söylendi: salon ışığında okunuyor mu, ipucu ile girilen değer ayırt ediliyor mu, "Bitir" ve "Antrenmanı iptal et" yanlışlıkla basılmayacak yerde mi.
