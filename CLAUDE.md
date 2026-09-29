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
- Makineler harekete aittir. Hareketler makinesiz başlar (varsayılan makine yok); makinelerin hepsini kullanıcı "+ Makine" ile ekler ve birimi kendisi seçer (varsayılan birim yok). Eklenen makine hemen kaydedilir. Makineler kartın "Düzenle" modunda yönetilir: "Değiştir" adı ve birimi değiştirir (kaydı olan makinenin birimi kilitli; eski kayıtlar antrenmandaki adı gösterir), "Sil" onayla siler (kaydı olmayan makine tamamen kalkar, kaydı olan arşivlenir: listeden kalkar, eski kayıtlar bozulmaz), "Silinmiş makineler" listesindeki "Geri al" arşivden çıkarır (aynı adda etkin makine varken önce onun adı değiştirilmeli). Arşivlenen makinenin adı yeniden kullanılabilir. Program satır formu hareketin makinelerini yalnızca gösterir. Kullanıcının eklediği makinelerin kimliği `eq-` ile başlar.
- Program ilk açılışta `js/seed.js`'ten veritabanına (`meta` deposu, `program` anahtarı) yazılır; sonra oradan okunur. Başlangıç programı değişince `SEED_VERSION` artırılır: kayıtlı program yükseltilir (günler yeni programdan gelir, kullanıcının makineleri korunur). Kullanıcı programı düzenlediyse (`customized: true`) yükseltme günleri değiştirmez. 3. sürümden önceki varsayılan makineler yükseltmede kaldırılır; kaydı olanlar arşivlenir.
- Antrenman başlarken hareket adı, makine adı, birim ve hedef kayda kopyalanır. Program değişince eski kayıtlar değişmez.
- Hedef = set × en çok tekrar ("3 × 12"). En az tekrar formlarda yok ve hiçbir yerde gösterilmez (kullanıcının isteği); veride `repMin` durur, formdan kaydedilen hedefte `repMax`'e eşittir. Başlangıç programındaki aralıklarda (10–12) yalnızca en çok tekrar görünür. Formda "En çok tekrar" kutusu hep dolu gelir.
- Program düzenleyici: günler ve satırlar eklenir, adlandırılır, sıralanır (↑ ↓) ve onayla silinir; her işlem hemen kaydedilir, satır formu "Kaydet" ile (kaydedilmemiş satırdan çıkarken onay). Programı değiştiren her işlem `customized: true` koyar. Günlerin sırası "Sıradaki" sırasıdır; en az bir gün kalır. Bir hareket bir günde yalnızca bir satırda olur. Yeni kimlikler: gün `day-`, satır `item-`, hareket `ex-`. Gün ya da satır silinince geçmiş kayıtlar durur (İlerleme'de "Programda olmayan"). Devam eden antrenman başladığı hâliyle sürer; onun günü silinemez ve devam eden antrenman varken program sıfırlanamaz.
- "+ Hareket ekle" (antrenman ve geçmiş düzenleme ekranı): katalogdan bu antrenmanda olmayan bir hareket ya da yeni hareket, hedefiyle (programda varsa ilk satırının hedefi gelir) yalnızca bu antrenmana eklenir; program değişmez. Kart `extra: true` taşır (taslağa da yazılır), "Kaldır" ile çıkarılır (değer girildiyse onayla). Kaydı o günün anahtarıyla tutulur; İlerleme'de "Programda olmayan" altında görünür. Katalog değişiklikleri (yeni hareket, ad) `customized` koymaz; yalnızca gün ve satır değişiklikleri koyar.
- "Adı düzelt" hareketin adını her günde değiştirir; kimlik aynı kaldığından geçmiş kopmaz, eski kayıtlar antrenmandaki adı gösterir. "Programı sıfırla": günler, satırlar, hedefler ve başlangıç hareketlerinin adları `seed.js`'e döner, `customized` kalkar; makineler, eklenen hareketler ve kayıtlar kalır.
- Ağırlık hareket başına bir kez girilir ve tekrarı girilen her sete uygulanır; kayıtta her set bu ağırlığı taşır. Ağırlıksız makinede yalnızca tekrar girilir. Tekrar girilip ağırlık girilmezse ya da yalnızca ağırlık girilirse uyarı verir; boş tekrar kutusu kaydedilmez. Önceki değerler yalnızca ipucudur, kutuları doldurmaz.
- Varsayılan makine: o gün o harekette en son kullanılan makine; yoksa listedeki ilk makine.
- Dönüşümlü satır: aynı günün bitmiş antrenmanlarında bu satırdan en son yapılan (seti girilmiş) hareketin bir sonrakisi önerilir ve seçili gelir; liste bitince başa döner, kayıt yoksa ilk hareket. Atlanan hareket sırayı ilerletmez; elle değiştirilirse gerçekte yapılan esas alınır. Kartta "Son yapılan: … · tarih · Sıradaki: …".
- Seti girilmemiş hareket "atlandı" sayılır ve kayda yazılmaz. Bitmemiş antrenmanlar hesaplara katılmaz.
- "Geçen sefer", ilerleme sayacı, dönüşüm önerisi ve grafikler kayıtlardan hesaplanır; veritabanına yazılmaz.
- İlerleme: bugünkü setler aynı anahtardaki bir önceki kayıtla set set karşılaştırılır; ağırlığı (kademesi) yüksek ya da ağırlığı aynı ve tekrarı yüksek bir set varsa ilerlemedir. Sayaç son ilerlemenin kaç antrenman önce olduğunu söyler (son antrenman = 1): "Geçen antrenmanda ilerledin" / "Son ilerleme N antrenman önce" / hiç ilerleme yoksa "Henüz ilerleme yok"; tek kayıtta sayaç yok. Set girerken "Bu antrenmanda ilerledin ✓".
- Grafik ölçüleri birime göre: kg → Tahmini 1TM (en iyi set, Epley `w × (1 + tekrar/30)`, tek tekrarda `w`), En ağır, Hacim (Σ kg × tekrar); kademe → En yüksek kademe, Toplam tekrar; ağırlıksız → Toplam tekrar, En çok tekrar. Değerler bir ondalığa yuvarlanır.

## Ekranlar
- Renkler uygulama simgesinden gelir (koyu yeşil `#034425`, krem `#faf1e1`, turuncu `#f06b29`); hepsi `css/app.css` başındaki değişkenlerde, açık ve koyu tema için ayrı. Yazı renkleri zemine karşı en az 4,5:1 karşıtlıkta seçilir.
- `js/main.js` yönlendirir: `#/` ana ekran (`views/home.js`), `#/antrenman/<gün>` antrenman ekranı (`views/workout.js`), `#/gecmis` ve `#/gecmis/<kimlik>` geçmiş listesi ve ayrıntısı (`views/history.js`), `#/gecmis/<kimlik>/duzenle` düzenleme (`views/workout.js`, düzenleme modu), `#/ilerleme` ve `#/ilerleme/<gün>/<hareket>` ilerleme listesi ve grafik (`views/progress.js`, grafik `js/chart.js`), `#/program`, `#/program/<gün>` ve `#/program/<gün>/<satır|yeni>` program düzenleyici (`views/program.js`), `#/ayarlar` ayarlar (`views/settings.js`). Kart `views/exercise-card.js` içindedir.
- Geçmiş düzenleme: aynı kartlar; otomatik kaydetme yok, "Kaydet" ile kaydedilir, kaydedilmemiş değişiklikle çıkarken onay sorulur. "Geçen sefer", sayaç ve anlık ilerleme o antrenmandan önceki kayıtlara göredir (`before`). Tarih, gün ve hedefler kayıttaki hâliyle kalır; kaydın makinesi sonradan silindiyse "(silinmiş)" olarak seçilebilir kalır (`keepEquipmentId`). Silme onay alır.
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
- Yayın: GitHub Pages (`main` dalı, kök klasör), https://akifsakallioglu.github.io/workout-tracking/ — depo: https://github.com/akifsakallioglu/workout-tracking. Her push siteyi günceller; telefondaki uygulama ise yalnızca `VERSION` değişince yeni sürüme geçer. Simgeler `tools/render_icons.py` ile `icons/icon-source.png`'den üretilir (kullanıcının seçtiği görsel).
- Bu depoda commit e-postası GitHub'ın gizli adresidir (`44166014+akifsakallioglu@users.noreply.github.com`, yerel git ayarı).

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
- Her aşamanın sonunda, testler geçince commit GitHub'a da gönderilir (kullanıcının izni). Uygulama dosyası değiştiyse önce `sw.js` `VERSION` artırılır.
- Yeni kararlar bu dosyaya işlenir.

## Aşamalar
0 Kurulum ✓ · 1 İlk dilim (Push · Rope Pushdown, iki makine) ✓ · 2 Tüm program ve makine ekleme ✓ · 3 Otomatik kaydetme ve devam eden antrenman ✓ · 4 Yedekleme ✓ · 5 PWA ve yayına alma ✓ (telefonda uçak modu denemesi kullanıcıda) · 6 İlerleme sayacı ✓ (makine silme ve yeni simge de) · 7 Dönüşümlü hareket önerisi ✓ · 8 Geçmiş ve düzeltme ✓ · 9 Grafikler ✓ · 10a Program düzenleyici ✓ · 10b Makine yönetimi ve "+ Hareket ekle" ✓
