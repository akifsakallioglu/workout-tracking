"""Uçtan uca testler.

Çalıştırma (proje klasöründe):
    .venv\\Scripts\\python tests\\e2e.py

Betik kendi yerel sunucusunu boş bir portta açar ve kurulu Chrome'u telefon
boyutunda (390×844) kullanır. Ekran görüntüleri tests/artifacts/ klasörüne
kaydedilir; bu klasör git'e eklenmez.
"""
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "tests" / "artifacts"
PHONE = {"width": 390, "height": 844}

sys.path.insert(0, str(ROOT))
from serve import make_server  # noqa: E402


class Runner:
    def __init__(self, browser, base_url):
        self.browser = browser
        self.base_url = base_url
        self.failures = []
        self._contexts = []
        self._errors = {}

    def new_page(self, color_scheme="light"):
        context = self.browser.new_context(viewport=PHONE, locale="tr-TR", color_scheme=color_scheme)
        self._contexts.append(context)
        page = context.new_page()
        errors = self._errors.setdefault(id(page), [])
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: message.type == "error" and errors.append(message.text))
        return page

    def assert_no_errors(self, page):
        errors = self._errors.get(id(page), [])
        assert not errors, "Sayfada hata var: " + " | ".join(errors)

    def check(self, name, scenario):
        try:
            scenario(self)
            print(f"✓ {name}")
        except Exception as error:  # Her senaryonun hatası raporlanır, diğerleri çalışmaya devam eder.
            self.failures.append(name)
            print(f"✗ {name}\n    {error}")
        finally:
            for context in self._contexts:
                context.close()
            self._contexts.clear()
            self._errors.clear()


def unit_tests_pass(run):
    page = run.new_page()
    page.goto(run.base_url + "/tests/index.html")
    page.wait_for_selector("body[data-done='true']", timeout=10_000)
    summary = page.text_content("#summary")
    assert page.get_attribute("#summary", "data-status") == "pass", f"Birim testleri: {summary}"
    run.assert_no_errors(page)


def home_page_opens(run):
    page = run.new_page()
    page.goto(run.base_url + "/")
    heading = page.text_content("h1").strip()
    assert heading == "Antrenman Takibi", f"Beklenmeyen başlık: {heading!r}"
    run.assert_no_errors(page)
    page.screenshot(path=str(ARTIFACTS / "asama0-ana-sayfa.png"))


def hidden_files_not_served(run):
    try:
        urllib.request.urlopen(run.base_url + "/.gitignore")
    except urllib.error.HTTPError as error:
        assert error.code == 404, f"Beklenen 404, gelen {error.code}"
    else:
        raise AssertionError("Gizli dosya sunuldu: /.gitignore")


SCENARIOS = [
    ("Birim testlerinin hepsi geçiyor", unit_tests_pass),
    ("Ana sayfa açılıyor", home_page_opens),
    ("Sunucu gizli dosyaları vermiyor", hidden_files_not_served),
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
            runner = Runner(browser, base_url)
            for name, scenario in SCENARIOS:
                runner.check(name, scenario)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if runner.failures:
        print(f"\n{len(runner.failures)}/{len(SCENARIOS)} senaryo başarısız.")
        return 1
    print(f"\n{len(SCENARIOS)}/{len(SCENARIOS)} senaryo geçti.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
