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

def weight(page, row):
    return page.get_by_label(f"{row}. set ağırlık")


def reps(page, row):
    return page.get_by_label(f"{row}. set tekrar")


def fill_sets(page, values):
    for row, (weight_text, reps_text) in enumerate(values, start=1):
        weight(page, row).fill(weight_text)
        reps(page, row).fill(reps_text)


def save(page):
    page.get_by_role("button", name="Kaydet").click()


def machine(page, name):
    return page.get_by_role("radio", name=name, exact=True)


def weight_header(page):
    return page.get_by_role("columnheader").nth(1)


def last_time(page):
    return page.locator("#last-time")


def save_status(page):
    return page.locator("#save-status")


def form_message(page):
    return page.locator("#form-message")


def session_count(page):
    return page.evaluate(COUNT_SESSIONS_SCRIPT)


def phase1_steps(run):
    today = {}

    def expect_last(page, sets_text):
        expect(last_time(page)).to_have_text(f"Geçen sefer — {today['text']}: {sets_text}")

    def step1(page):
        page.goto(run.base_url + "/")
        today["text"] = page.evaluate(TODAY_SCRIPT)
        expect(page).to_have_title("Antrenman Takibi")
        expect(page.get_by_role("heading", level=1)).to_have_text("Rope Pushdown")
        expect(page.locator(".target")).to_have_text("Hedef 3 × 12–15")
        expect(machine(page, "Kablo · kg")).to_be_checked()
        expect(last_time(page)).to_have_text("Bu makinede önceki kayıt yok")
        expect(weight_header(page)).to_have_text("Ağırlık (kg)")

    def step2(page):
        fill_sets(page, [("50", "12"), ("50", "12"), ("50", "11")])
        save(page)
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        for row in (1, 2, 3):
            expect(weight(page, row)).to_have_value("")
            expect(reps(page, row)).to_have_value("")
        expect_last(page, "50×12 · 50×12 · 50×11")
        assert session_count(page) == 1, "Veritabanında 1 kayıt olmalıydı"

    def step3(page):
        page.reload()
        expect_last(page, "50×12 · 50×12 · 50×11")
        for row, (weight_hint, reps_hint) in enumerate([("50", "12"), ("50", "12"), ("50", "11")], start=1):
            expect(weight(page, row)).to_have_value("")
            expect(reps(page, row)).to_have_value("")
            expect(weight(page, row)).to_have_attribute("placeholder", weight_hint)
            expect(reps(page, row)).to_have_attribute("placeholder", reps_hint)

    def step4(page):
        save(page)
        expect(form_message(page)).to_have_text("En az bir tam set girin.")
        assert session_count(page) == 1, "Boş kayıt yapılmamalıydı"

    def step5(page):
        weight(page, 1).fill("50")
        save(page)
        expect(form_message(page)).to_contain_text("Yarım set: 1. set")
        expect(reps(page, 1)).to_have_attribute("aria-invalid", "true")
        page.screenshot(path=str(ARTIFACTS / "asama1-yarim-set.png"), full_page=True)
        assert session_count(page) == 1, "Yarım set kaydedilmemeliydi"
        weight(page, 1).fill("")

    def step6(page):
        machine(page, "Kablo 2 · kademe").check()
        expect(last_time(page)).to_have_text("Bu makinede önceki kayıt yok")
        expect(weight_header(page)).to_have_text("Kademe")
        expect(form_message(page)).to_have_text("")
        fill_sets(page, [("10", "12"), ("10", "12"), ("11", "10")])
        save(page)
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        expect_last(page, "10k×12 · 10k×12 · 11k×10")

    def step7(page):
        machine(page, "Kablo · kg").check()
        expect_last(page, "50×12 · 50×12 · 50×11")
        expect(weight_header(page)).to_have_text("Ağırlık (kg)")

    def step8(page):
        fill_sets(page, [("52,5", "10")])
        save(page)
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        expect_last(page, "52,5×10")
        expect(weight(page, 1)).to_have_attribute("placeholder", "52,5")
        expect(weight(page, 2)).to_have_attribute("placeholder", "")

    def step9(page):
        page.evaluate("window.__failWrites = true")
        fill_sets(page, [("55", "8")])
        save(page)
        expect(save_status(page)).to_contain_text("Kaydedilemedi")
        expect(weight(page, 1)).to_have_value("55")
        expect(reps(page, 1)).to_have_value("8")
        assert session_count(page) == 3, "Başarısız yazma kayıt eklememeliydi"
        page.screenshot(path=str(ARTIFACTS / "asama1-kayit-hatasi.png"), full_page=True)
        page.evaluate("window.__failWrites = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        expect_last(page, "55×8")
        assert session_count(page) == 4, "Tekrar denemede tek kayıt eklenmeliydi"

    def step10(page):
        page.screenshot(path=str(ARTIFACTS / "asama1-acik.png"), full_page=True)
        page.emulate_media(color_scheme="dark")
        page.screenshot(path=str(ARTIFACTS / "asama1-koyu.png"), full_page=True)

    return [
        ("1. Kablo seçili; 'önceki kayıt yok' ve 'kg' etiketi görünüyor", step1),
        ("2. 50/12, 50/12, 50/11 kaydediliyor; kutular temizleniyor, 'Geçen sefer' güncelleniyor", step2),
        ("3. Sayfa yenilenince kayıt duruyor; kutular boş, yalnızca ipucu var", step3),
        ("4. Boş Kaydet: kayıt yok, 'En az bir tam set girin' uyarısı", step4),
        ("5. Yalnızca ağırlık girilen satırda yarım set uyarısı", step5),
        ("6. Kablo 2: 'önceki kayıt yok', 'kademe' etiketi; kayıt '10k×12' biçiminde", step6),
        ("7. Kablo'ya dönünce yalnızca Kablo'nun değerleri görünüyor", step7),
        ("8. '52,5'/10 kaydediliyor; 'Geçen sefer' en yeni kaydı gösteriyor", step8),
        ("9. Yazma hatası: 'Kaydedilemedi', değerler kalıyor; 'Tekrar dene' kaydediyor", step9),
        ("10. Açık ve koyu tema ekran görüntüleri alınıyor", step10),
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
