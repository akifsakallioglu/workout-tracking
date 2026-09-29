# Antrenman Takibi

Salonda telefondan kullanılan kişisel antrenman günlüğü (PWA). Arayüz Türkçe, koddaki adlar İngilizce. Kullanıcıyla Türkçe konuşulur.

Onaylı ayrıntılı plan: [docs/plan.md](docs/plan.md). Aşamaların kapsamı ve "bitti sayılır" maddeleri orada.

## Teknik kısıtlar
- Düz HTML, CSS ve JavaScript (ES modülleri). Derleme adımı, npm ve harici kütüphane yok.
- Veri tarayıcıda, IndexedDB'de (`antrenman-takibi`). Giriş ve eşitleme yok; yedek JSON.
- Geliştirme sunucusu: `python serve.py` → http://127.0.0.1:8000. `--lan` ile aynı Wi-Fi'deki telefondan açılır. `python -m http.server` kullanılmaz: serve.py önbelleği kapatır, .git/.venv gibi gizli yolları sunmaz ve varsayılan olarak yalnızca bu bilgisayara açıktır.

## Veri kuralları
- Geçmişin anahtarı gün + hareket + makine (`dayId` + `exerciseId` + `equipmentId`). Farklı günler ve makineler birbirine karışmaz.
- Her makinenin tek birimi var: `kg`, `level` (kademe), `none` (ağırlıksız). Birimler dönüştürülmez. Kaydı olan makinenin birimi değiştirilemez.
- Makineler harekete aittir. Hareketler makinesiz başlar (varsayılan makine yok); makinelerin hepsini kullanıcı "+ Makine" ile ekler ve birimi kendisi seçer (varsayılan birim yok). Eklenen makine hemen kaydedilir. Kaydı olan makine silinmez, arşivlenir; arşivlenen makinenin adı yeniden kullanılabilir. Kullanıcının eklediği makinelerin kimliği `eq-` ile başlar.
- Program ilk açılışta `js/seed.js`'ten veritabanına (`meta` deposu, `program` anahtarı) yazılır; sonra oradan okunur. Başlangıç programı değişince `SEED_VERSION` artırılır: kayıtlı program yükseltilir (günler yeni programdan gelir, kullanıcının makineleri korunur). 3. sürümden önceki varsayılan makineler yükseltmede kaldırılır; kaydı olanlar arşivlenir.
- Antrenman başlarken hareket adı, makine adı, birim ve hedef kayda kopyalanır. Program değişince eski kayıtlar değişmez.
- Ağırlık hareket başına bir kez girilir ve tekrarı girilen her sete uygulanır; kayıtta her set bu ağırlığı taşır. Ağırlıksız makinede yalnızca tekrar girilir. Tekrar girilip ağırlık girilmezse ya da yalnızca ağırlık girilirse uyarı verir; boş tekrar kutusu kaydedilmez. Önceki değerler yalnızca ipucudur, kutuları doldurmaz.
- Varsayılan makine: o gün o harekette en son kullanılan makine; yoksa listedeki ilk makine.
- Seti girilmemiş hareket "atlandı" sayılır ve kayda yazılmaz. Bitmemiş antrenmanlar hesaplara katılmaz.
- "Geçen sefer", ilerleme sayacı, dönüşüm önerisi ve grafikler kayıtlardan hesaplanır; veritabanına yazılmaz.

## Ekranlar
- `js/main.js` yönlendirir: `#/` ana ekran (`views/home.js`), `#/antrenman/<gün>` antrenman ekranı (`views/workout.js`), `#/ayarlar` ayarlar (`views/settings.js`). Kart `views/exercise-card.js` içindedir (Aşama 8'deki geçmiş düzenlemede de kullanılacak).
- Ekranlar `{ beforeLeave?, flush?, hasUnsavedChanges?, destroy? }` döndürür; `main.js` ekran değişmeden önce `beforeLeave`, sayfa kapanırken `flush` ve `hasUnsavedChanges` çağırır.
- Devam eden antrenman, ilk değer girilince `finishedAt: null` ve `draft.cards` (ham kutu değerleri, seçili hareket ve makine, başlarken kopyalanan hedef) ile kaydedilir. "Bitir" aynı kaydı `entries` ile bitmiş hâle getirir, "İptal" siler. Aynı anda tek devam eden antrenman olur; başka gün açılınca "devam et / bitir / sil" ekranı çıkar.

## Kaydetme
- Tüm yazmalar tek sıradan geçer. Durumlar: Kaydediliyor… / Kaydedildi ✓ / Kaydedilemedi (Tekrar dene). Henüz yazılmaya başlanmamış (beklemedeki) değişiklik de "Kaydediliyor…" sayılır.
- Zamanlama: yazarken 0,5 sn bekleyip; kutudan çıkınca, set/makine değişince, ekrandan çıkınca ve uygulama arka plana geçince hemen.
- Okumalar (`loadProgram`, `loadSessions`) sıradaki yazmaların bitmesini bekler; ekranlar daha önce istenen bütün değişiklikleri görür.
- "Bitir" ve "Güncelle" bekleyen yazmaları bekler; hata varsa işlemi yapmaz.
- Kayıpsızlık garantisi verilmez; arayüzde de verilmez.

## İnternetsiz çalışma (PWA)
- `sw.js` uygulama dosyalarını sürümlü önbellekte saklar (önce önbellek). **Her yayında `VERSION` artırılır**; yeni dosya eklenince `FILES` listesine yazılır (uçtan uca test eksik ya da fazla dosyayı yakalar).
- Bilgisayarda (localhost/127.0.0.1) service worker kapalıdır, yalnızca adreste `?sw=1` varsa çalışır.
- Yeni sürüm hazır olunca "Yeni sürüm var: Güncelle" bandı çıkar; "Güncelle" bekleyen yazmaları bitirir, yazma başarısızsa güncellemez.
- Yayın: GitHub Pages (`main` dalı, kök klasör). Push yalnızca kullanıcının onayıyla. Simgeler `tools/render_icons.py` ile SVG'den üretilir.

## Yedek
- Biçim: `{ app: "antrenman-takibi", backupVersion: 1, exportedAt, program, sessions }`; devam eden antrenman dahil. Cihaza özel ayarlar (`meta/settings`: `lastBackupAt`) yedeğe girmez.
- Geri yüklemede dosya `parseBackup` ile denetlenir; özet gösterilir, onaydan sonra program ve antrenmanlar tek işlemde değiştirilir (`replaceAll`). İşlem yarıda hata verirse iptal edilir, hiçbir şey değişmez.
- Hatırlatma: son yedekten (hiç yoksa ilk bitirilen antrenmandan) bu yana 30 günden fazla geçtiyse ana ekranda.
- İlk bitirilen antrenmandan sonra tarayıcıdan kalıcı depolama istenir; Ayarlar'da durumu görünür ve elle istenebilir.

## Testler
- Birim testleri: `tests/logic.test.js`, tarayıcıda http://127.0.0.1:8000/tests/ adresinde çalışır. Saf fonksiyonlar `js/logic.js` içindedir.
- Uçtan uca: `.venv\Scripts\python tests\e2e.py`. Kendi sunucusunu açar ve kurulu Chrome'u 390×844 boyutunda kullanır. Ekran görüntüleri `tests/artifacts/` klasörüne gider (git'e eklenmez).
- Sanal ortam yoksa: `python -m venv .venv` ve `.venv\Scripts\python -m pip install playwright`. Tarayıcı indirmeye gerek yok (`channel="chrome"`).

## Çalışma şekli
- Küçük aşamalar: uygula → birim ve uçtan uca testler → `main` dalına commit ("Aşama N: …") → dur. Kullanıcı "devam" deyince sonraki aşamaya geçilir.
- Push yalnızca kullanıcının onayıyla yapılır.
- Yeni kararlar bu dosyaya işlenir.

## Aşamalar
0 Kurulum ✓ · 1 İlk dilim (Push · Rope Pushdown, iki makine) ✓ · 2 Tüm program ve makine ekleme ✓ · 3 Otomatik kaydetme ve devam eden antrenman ✓ · 4 Yedekleme ✓ · 5 PWA ve yayına alma (kod ✓, GitHub Pages yayını kullanıcı onayı bekliyor) · 6 İlerleme sayacı · 7 Dönüşümlü hareket önerisi · 8 Geçmiş ve düzeltme · 9 Grafikler · 10 Program düzenleyici ve makine yönetimi
