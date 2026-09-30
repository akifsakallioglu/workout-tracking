# Antrenman Takibi

Salonda telefondan kullanılan kişisel antrenman günlüğü. Her hareket için makineyi seçer, ağırlığı ve set tekrarlarını girersiniz; uygulama aynı gün, hareket ve makinede geçen sefer ne yaptığınızı gösterir.

- Telefonda ana ekrana eklenip uygulama gibi açılan bir web sitesidir (PWA).
- Veriler yalnızca kullandığınız cihazda, tarayıcının içindeki veritabanında durur. Giriş ya da sunucu yoktur.
- İnternet olmadan da çalışır: yazdıklarınız hemen kaydedilir, uygulama uçak modunda da açılır.

## Telefona kurulum

1. Telefonda uygulamanın adresini açın (örneğin `https://<kullanıcı-adı>.github.io/workout-tracking/`).
2. Ana ekrana ekleyin:
   - **iPhone:** Safari → Paylaş → **Ana Ekrana Ekle**.
   - **Android:** Chrome → ⋮ menüsü → **Uygulamayı yükle** (ya da **Ana ekrana ekle**).
3. Bundan sonra uygulamayı hep ana ekrandaki simgeden açın. iPhone'da ana ekran uygulaması ile Safari ayrı depolama kullanır; Safari'de girilen kayıtlar ana ekran uygulamasında görünmez.

Uygulama ilk açılışta dosyalarını telefona kaydeder; sonraki açılışlarda internet gerekmez.

## Gezinme

- Ana Sayfa, Geçmiş, İlerleme ve Ayarlar arasında üstteki sekmelerle ya da bu dört ekranda parmağı sağa sola kaydırarak geçersiniz.
- Telefonun geri hareketi uygulamadaki "←" ile aynı yere gider. Sekmeler arasında gidip gelmek geçmişte kayıt biriktirmez; bir sekmedeyken geri hareketi Ana Sayfa'ya döner.
- Ekranın en kenarından başlayan kaydırma telefonun kendi hareketidir (iPhone'da geri ya da ileri, Android'de geri).

## Yedekleme

Veriler yalnızca telefonda durduğu için telefon değişirse, kaybolursa ya da tarayıcı verileri silinirse kaybolur. **Ayarlar → Yedeği indir** (ya da **Paylaş…**) ile yedek alın ve dosyayı Drive gibi başka bir yerde saklayın. Geri yüklemek için **Ayarlar → Yedeği geri yükle**. Son yedekten bu yana 30 günden fazla geçince ana ekranda hatırlatma çıkar.

## Bilgisayarda çalıştırma

Python 3 yeterlidir; başka kurulum gerekmez.

```
python serve.py
```

Tarayıcıda http://127.0.0.1:8000 adresini açın. Aynı Wi-Fi'deki telefondan denemek için `python serve.py --lan` çalıştırın ve yazdığı adresi açın (Windows güvenlik duvarı izin isteyebilir). Bilgisayardaki veriler telefondakilerden ayrıdır.

Service worker bilgisayarda kapalıdır; böylece kod değişiklikleri sayfa yenilenince hemen görünür. İnternetsiz açılışı bilgisayarda denemek için adrese `?sw=1` ekleyin: http://127.0.0.1:8000/?sw=1

## Testler

- **Birim testleri:** sunucu açıkken http://127.0.0.1:8000/tests/ adresini açın.
- **Uçtan uca testler:** kurulu Chrome'u telefon boyutunda kullanır.

  ```
  python -m venv .venv
  .venv\Scripts\python -m pip install playwright
  .venv\Scripts\python tests\e2e.py
  ```

  Ekran görüntüleri `tests/artifacts/` klasörüne kaydedilir.

## Yayına alma (GitHub Pages)

İlk kez:

1. GitHub'da boş bir depo açın (ücretsiz hesapta depo herkese açık olmalıdır).
2. Kodu gönderin:

   ```
   git remote add origin https://github.com/<kullanıcı-adı>/workout-tracking.git
   git push -u origin main
   ```

3. Depoda **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, Branch **main**, klasör **/ (root)** → **Save**.
4. Birkaç dakika sonra uygulama `https://<kullanıcı-adı>.github.io/workout-tracking/` adresinde yayında olur.

Her yeni sürümde:

1. `sw.js` içindeki `VERSION` değerini artırın. Yeni bir dosya eklediyseniz `FILES` listesine de yazın (uçtan uca test eksik dosyayı yakalar).
2. Testleri çalıştırın, commit atın ve `git push` ile gönderin.
3. Telefondaki uygulama yeni sürümü fark edince **Yeni sürüm var: Güncelle** bandını gösterir. "Güncelle" önce bekleyen kayıtları tamamlar, sonra yeni sürüme geçer.

## Simgeler

Simgelerin kaynağı `icons/icon-source.png` (kare, zemini kenarlara kadar dolu, çizim ortadaki %80'lik alanda). Kaynak değişirse diğer boyutları yeniden üretin:

```
.venv\Scripts\python tools\render_icons.py
```

Ana sayfadaki gün görsellerinin kaynakları `.claude/skills/workout-ui/references/` içindedir (`push.png` … `lower.png`). Kaynak değişirse uygulamadaki küçük kopyaları (`icons/day-<gün>.png`) yeniden üretin:

```
.venv\Scripts\python tools\render_day_images.py
```

## Klasörler

```
index.html, manifest.webmanifest, sw.js   sayfa, uygulama tanımı, internetsiz çalışma
css/app.css                               görünüm
js/                                       uygulama kodu (logic.js: saf kurallar, store.js: veri erişimi)
js/views/                                 ekranlar
icons/                                    simgeler ve gün görselleri
tests/                                    birim ve uçtan uca testler
tools/                                    simge ve gün görseli üreten araçlar
docs/plan.md                              geliştirme planı
.claude/skills/workout-ui/                arayüz kuralları ve tasarım görselleri (Claude Code skill'i)
```
