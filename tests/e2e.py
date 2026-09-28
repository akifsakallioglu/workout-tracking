"""Uçtan uca testler.

Çalıştırma (proje klasöründe):
    .venv\\Scripts\\python tests\\e2e.py

Betik kendi yerel sunucusunu boş bir portta açar ve kurulu Chrome'u telefon
boyutunda (390×844) kullanır. Her akış temiz bir tarayıcı profiliyle (boş
veritabanı) başlar; akıştaki adımlar sırayla aynı sayfada çalışır ve bir adım
başarısız olursa sonrakiler atlanır. Ekran görüntüleri tests/artifacts/
klasörüne kaydedilir; bu klasör git'e eklenmez.
"""
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "tests" / "artifacts"
PHONE = {"width": 390, "height": 844}

sys.path.insert(0, str(ROOT))
from serve import make_server  # noqa: E402

# window.__failWrites true iken her IndexedDB yazması hata verir (kayıt hatasını taklit etmek için).
FAIL_WRITES_SCRIPT = """
(() => {
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (window.__failWrites) throw new DOMException('Test: yazma hatası', 'UnknownError');
    return originalPut.apply(this, args);
  };
})();
"""

COUNT_SESSIONS_SCRIPT = """
() => new Promise((resolve, reject) => {
  const request = indexedDB.open('antrenman-takibi');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const count = db.transaction('sessions').objectStore('sessions').count();
    count.onsuccess = () => { resolve(count.result); db.close(); };
    count.onerror = () => { reject(count.error); db.close(); };
  };
})
"""

TODAY_SCRIPT = "new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date())"


class Runner:
    def __init__(self, browser, base_url):
        self.browser = browser
        self.base_url = base_url
        self.passed = 0
        self.failed = []
        self.skipped = 0

    def flow(self, title, steps, init_script=None):
        print(f"\n{title}")
        context = self.browser.new_context(viewport=PHONE, locale="tr-TR", color_scheme="light")
        if init_script:
            context.add_init_script(init_script)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: message.type == "error" and errors.append(message.text))
        broken = False
        try:
            for name, step in steps:
                if broken:
                    self.skipped += 1
                    print(f"  – {name} (atlandı)")
                    continue
                try:
                    detail = step(page)
                    if errors:
                        raise AssertionError("Sayfada hata var: " + " | ".join(errors))
                    self.passed += 1
                    print(f"  ✓ {name}" + (f" ({detail})" if detail else ""))
                except Exception as error:  # Hata raporlanır; akışın kalan adımları atlanır.
                    broken = True
                    self.failed.append(name)
                    details = "\n      ".join(str(error).strip().splitlines()[:8])
                    print(f"  ✗ {name}\n      {details}")
        finally:
            context.close()


# ---------------------------------------------------------------- Altyapı

def infrastructure_steps(run):
    def unit_tests_pass(page):
        page.goto(run.base_url + "/tests/index.html")
        page.wait_for_selector("body[data-done='true']", timeout=10_000)
        summary = page.text_content("#summary")
        failures = page.locator("#results .fail").all_text_contents()
        assert page.get_attribute("#summary", "data-status") == "pass", f"Birim testleri: {summary} {failures}"
        return summary

    def hidden_files_not_served(page):
        try:
            urllib.request.urlopen(run.base_url + "/.gitignore")
        except urllib.error.HTTPError as error:
            assert error.code == 404, f"Beklenen 404, gelen {error.code}"
        else:
            raise AssertionError("Gizli dosya sunuldu: /.gitignore")

    return [
        ("Birim testlerinin hepsi geçiyor", unit_tests_pass),
        ("Sunucu gizli dosyaları vermiyor", hidden_files_not_served),
    ]


# ---------------------------------------------------------------- Aşama 1

def weight_input(page):
    return page.locator("#weight-input")


def weight_label(page):
    return page.locator("label[for='weight-input']")


def reps(page, row):
    return page.get_by_label(f"{row}. set tekrar")


def log_sets(page, weight_text, reps_texts):
    if weight_text is not None:
        weight_input(page).fill(weight_text)
    for row, text in enumerate(reps_texts, start=1):
        reps(page, row).fill(text)


def save(page):
    page.get_by_role("button", name="Kaydet").click()


def machine(page, name):
    return page.get_by_role("radio", name=name, exact=True)


def machine_names(page):
    return [text.strip() for text in page.locator(".machines .chip:has(input)").all_text_contents()]


def open_machine_form(page):
    page.get_by_role("button", name="+ Makine").click()


def submit_machine(page, name, unit_label):
    page.get_by_label("Ad", exact=True).fill(name)
    if unit_label:
        page.get_by_role("radio", name=unit_label, exact=True).check()
    page.get_by_role("button", name="Ekle").click()


def last_time(page):
    return page.locator("#last-time")


def save_status(page):
    return page.locator("#save-status")


def form_message(page):
    return page.locator("#form-message")


def machine_message(page):
    return page.locator("#machine-message")


def session_count(page):
    return page.evaluate(COUNT_SESSIONS_SCRIPT)


def phase1_steps(run):
    today = {}

    def expect_last(page, sets_text):
        expect(last_time(page)).to_have_text(f"Geçen sefer — {today['text']}: {sets_text}")

    def expect_cleared(page):
        expect(weight_input(page)).to_have_value("")
        for row in (1, 2, 3):
            expect(reps(page, row)).to_have_value("")

    def initial_screen(page):
        page.goto(run.base_url + "/")
        today["text"] = page.evaluate(TODAY_SCRIPT)
        expect(page).to_have_title("Antrenman Takibi")
        expect(page.get_by_role("heading", level=1)).to_have_text("Rope Pushdown")
        expect(page.locator(".target")).to_have_text("Hedef 3 × 12–15")
        expect(machine(page, "Kablo · kg")).to_be_checked()
        assert machine_names(page) == ["Kablo · kg"], f"Başlangıçta tek makine olmalıydı: {machine_names(page)}"
        expect(last_time(page)).to_have_text("Bu makinede önceki kayıt yok")
        expect(weight_label(page)).to_have_text("Ağırlık (kg)")
        expect(page.locator("input[data-field='weight']")).to_have_count(1)
        expect(page.locator("input[data-field='reps']")).to_have_count(3)

    def save_first(page):
        log_sets(page, "50", ["12", "12", "11"])
        save(page)
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        expect_cleared(page)
        expect_last(page, "50 kg × 12 · 12 · 11")
        assert session_count(page) == 1, "Veritabanında 1 kayıt olmalıydı"

    def reload_keeps_record(page):
        page.reload()
        expect_last(page, "50 kg × 12 · 12 · 11")
        expect_cleared(page)
        expect(weight_input(page)).to_have_attribute("placeholder", "50")
        for row, hint in enumerate(["12", "12", "11"], start=1):
            expect(reps(page, row)).to_have_attribute("placeholder", hint)

    def empty_save(page):
        save(page)
        expect(form_message(page)).to_have_text("En az bir setin tekrar sayısını girin.")
        assert session_count(page) == 1, "Boş kayıt yapılmamalıydı"

    def missing_weight(page):
        log_sets(page, None, ["12", "12"])
        save(page)
        expect(form_message(page)).to_have_text("Ağırlığı girin.")
        expect(weight_input(page)).to_have_attribute("aria-invalid", "true")
        page.screenshot(path=str(ARTIFACTS / "asama1-agirlik-eksik.png"), full_page=True)
        assert session_count(page) == 1, "Ağırlıksız kayıt yapılmamalıydı"
        weight_input(page).fill("50")
        expect(form_message(page)).to_have_text("")
        expect(weight_input(page)).not_to_have_attribute("aria-invalid", "true")
        log_sets(page, "", ["", ""])

    def machine_form_validation(page):
        open_machine_form(page)
        expect(page.get_by_label("Ad", exact=True)).to_be_focused()
        expect(page.get_by_role("radio", name="kg", exact=True)).not_to_be_checked()
        page.get_by_role("button", name="Ekle").click()
        expect(machine_message(page)).to_have_text("Makineye bir ad verin.")
        submit_machine(page, "kablo", "kademe")
        expect(machine_message(page)).to_have_text("Bu adda bir makine zaten var.")
        page.screenshot(path=str(ARTIFACTS / "asama1-makine-formu.png"), full_page=True)
        page.get_by_role("button", name="Vazgeç").click()
        expect(page.locator(".machine-form")).to_have_count(0)
        assert machine_names(page) == ["Kablo · kg"], "Vazgeçince makine eklenmemeliydi"
        open_machine_form(page)
        submit_machine(page, "Kablo 2", None)
        expect(machine_message(page)).to_have_text("Birimi seçin: kg, kademe ya da ağırlıksız.")
        page.get_by_role("button", name="Vazgeç").click()

    def add_level_machine(page):
        open_machine_form(page)
        submit_machine(page, "Kablo 2", "kademe")
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        expect(machine(page, "Kablo 2 · kademe")).to_be_checked()
        expect(last_time(page)).to_have_text("Bu makinede önceki kayıt yok")
        expect(weight_label(page)).to_have_text("Kademe")
        log_sets(page, "10", ["12", "12", "10"])
        save(page)
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        expect_last(page, "10k × 12 · 12 · 10")

    def add_second_kg_machine(page):
        open_machine_form(page)
        submit_machine(page, "Kablo 3", "kg")
        expect(machine(page, "Kablo 3 · kg")).to_be_checked()
        expect(weight_label(page)).to_have_text("Ağırlık (kg)")
        expect(last_time(page)).to_have_text("Bu makinede önceki kayıt yok")
        log_sets(page, "45", ["12", "12", "12"])
        save(page)
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        expect_last(page, "45 kg × 12 · 12 · 12")

    def machines_persist_and_stay_separate(page):
        page.reload()
        names = machine_names(page)
        assert names == ["Kablo · kg", "Kablo 2 · kademe", "Kablo 3 · kg"], f"Makineler kalıcı olmalıydı: {names}"
        expect(machine(page, "Kablo · kg")).to_be_checked()
        expect_last(page, "50 kg × 12 · 12 · 11")
        machine(page, "Kablo 2 · kademe").check()
        expect_last(page, "10k × 12 · 12 · 10")
        machine(page, "Kablo 3 · kg").check()
        expect_last(page, "45 kg × 12 · 12 · 12")
        machine(page, "Kablo · kg").check()
        expect_last(page, "50 kg × 12 · 12 · 11")

    def decimal_weight(page):
        log_sets(page, "52,5", ["10"])
        save(page)
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        expect_last(page, "52,5 kg × 10")
        expect(weight_input(page)).to_have_attribute("placeholder", "52,5")
        expect(reps(page, 2)).to_have_attribute("placeholder", "")
        assert session_count(page) == 4, "4 kayıt olmalıydı"

    def save_error_and_retry(page):
        page.evaluate("window.__failWrites = true")
        log_sets(page, "55", ["8"])
        save(page)
        expect(save_status(page)).to_contain_text("Kaydedilemedi.")
        expect(weight_input(page)).to_have_value("55")
        expect(reps(page, 1)).to_have_value("8")
        assert session_count(page) == 4, "Başarısız yazma kayıt eklememeliydi"
        page.screenshot(path=str(ARTIFACTS / "asama1-kayit-hatasi.png"), full_page=True)
        page.evaluate("window.__failWrites = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        expect_last(page, "55 kg × 8")
        assert session_count(page) == 5, "Tekrar denemede tek kayıt eklenmeliydi"

    def machine_error_and_retry(page):
        page.evaluate("window.__failWrites = true")
        open_machine_form(page)
        submit_machine(page, "Kablo 4", "kg")
        expect(save_status(page)).to_contain_text("Makine eklenemedi.")
        expect(page.get_by_label("Ad", exact=True)).to_have_value("Kablo 4")
        assert len(machine_names(page)) == 3, "Başarısız yazmada makine eklenmemeliydi"
        page.evaluate("window.__failWrites = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        expect(machine(page, "Kablo 4 · kg")).to_be_checked()
        page.reload()
        assert machine_names(page)[-1] == "Kablo 4 · kg", "Tekrar denemede eklenen makine kalıcı olmalıydı"

    def screenshots(page):
        page.screenshot(path=str(ARTIFACTS / "asama1-acik.png"), full_page=True)
        page.emulate_media(color_scheme="dark")
        page.screenshot(path=str(ARTIFACTS / "asama1-koyu.png"), full_page=True)

    return [
        ("1. Başlangıçta yalnızca 'Kablo · kg' var; tek ağırlık kutusu, 3 tekrar kutusu", initial_screen),
        ("2. 50 kg ile 12, 12, 11 kaydediliyor; kutular temizleniyor", save_first),
        ("3. Sayfa yenilenince kayıt duruyor; kutular boş, yalnızca ipucu var", reload_keeps_record),
        ("4. Boş Kaydet: kayıt yok, uyarı var", empty_save),
        ("5. Tekrar girilip ağırlık girilmezse 'Ağırlığı girin' uyarısı", missing_weight),
        ("6. Makine formu: boş ad, aynı ad ve seçilmemiş birim reddediliyor; Vazgeç", machine_form_validation),
        ("7. 'Kablo 2 · kademe' elle ekleniyor; kayıt '10k × …' biçiminde", add_level_machine),
        ("8. İkinci kablo da kg olabiliyor: 'Kablo 3 · kg'", add_second_kg_machine),
        ("9. Makineler yenilemeden sonra duruyor; kayıtları birbirine karışmıyor", machines_persist_and_stay_separate),
        ("10. '52,5' kg kaydediliyor; 'Geçen sefer' en yeni kaydı gösteriyor", decimal_weight),
        ("11. Set kaydında yazma hatası: değerler kalıyor; 'Tekrar dene' kaydediyor", save_error_and_retry),
        ("12. Makine eklerken yazma hatası: form kalıyor; 'Tekrar dene' ekliyor", machine_error_and_retry),
        ("13. Açık ve koyu tema ekran görüntüleri alınıyor", screenshots),
    ]


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    server = make_server(port=0, quiet=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome")
            run = Runner(browser, base_url)
            run.flow("Altyapı", infrastructure_steps(run))
            run.flow("Aşama 1 · Push · Rope Pushdown", phase1_steps(run), init_script=FAIL_WRITES_SCRIPT)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    total = run.passed + len(run.failed) + run.skipped
    print(f"\n{run.passed}/{total} adım geçti", end="")
    print(f", {len(run.failed)} başarısız, {run.skipped} atlandı." if run.failed or run.skipped else ".")
    return 1 if run.failed else 0


if __name__ == "__main__":
    sys.exit(main())
