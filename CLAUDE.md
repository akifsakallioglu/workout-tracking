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
- `js/main.js` yönlendirir: `#/` ana ekran (`views/home.js`), `#/antrenman/<gün>` antrenman ekranı (`views/workout.js`). Kart `views/exercise-card.js` içindedir (Aşama 8'deki geçmiş düzenlemede de kullanılacak).
- Aşama 3'e kadar antrenman yalnızca "Bitir" ile kaydedilir; kaydedilmemiş değerlerle çıkarken onay sorulur.

## Kaydetme
- Tüm yazmalar tek sıradan geçer. Durumlar: Kaydediliyor… / Kaydedildi ✓ / Kaydedilemedi (Tekrar dene).
- "Bitir" ve "Güncelle" bekleyen yazmaları bekler; hata varsa işlemi yapmaz.
- Kayıpsızlık garantisi verilmez; arayüzde de verilmez.

## Testler
- Birim testleri: `tests/logic.test.js`, tarayıcıda http://127.0.0.1:8000/tests/ adresinde çalışır. Saf fonksiyonlar `js/logic.js` içindedir.
- Uçtan uca: `.venv\Scripts\python tests\e2e.py`. Kendi sunucusunu açar ve kurulu Chrome'u 390×844 boyutunda kullanır. Ekran görüntüleri `tests/artifacts/` klasörüne gider (git'e eklenmez).
- Sanal ortam yoksa: `python -m venv .venv` ve `.venv\Scripts\python -m pip install playwright`. Tarayıcı indirmeye gerek yok (`channel="chrome"`).

## Çalışma şekli
- Küçük aşamalar: uygula → birim ve uçtan uca testler → `main` dalına commit ("Aşama N: …") → dur. Kullanıcı "devam" deyince sonraki aşamaya geçilir.
- Push yalnızca kullanıcının onayıyla yapılır.
- Yeni kararlar bu dosyaya işlenir.

## Aşamalar
0 Kurulum ✓ · 1 İlk dilim (Push · Rope Pushdown, iki makine) ✓ · 2 Tüm program ve makine ekleme ✓ · 3 Otomatik kaydetme ve devam eden antrenman · 4 Yedekleme · 5 PWA ve yayına alma · 6 İlerleme sayacı · 7 Dönüşümlü hareket önerisi · 8 Geçmiş ve düzeltme · 9 Grafikler · 10 Program düzenleyici ve makine yönetimi
