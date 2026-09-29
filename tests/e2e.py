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

READ_SCRIPT = """
([storeName, key]) => new Promise((resolve, reject) => {
  const request = indexedDB.open('antrenman-takibi');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const store = db.transaction(storeName).objectStore(storeName);
    const read = key === null ? store.getAll() : store.get(key);
    read.onsuccess = () => { resolve(read.result); db.close(); };
    read.onerror = () => { reject(read.error); db.close(); };
  };
})
"""

# Kayıtlı programda bir satırın hedefini değiştirir (başlangıç programındaki değişikliği taklit eder).
EDIT_ITEM_SCRIPT = """
(change) => new Promise((resolve, reject) => {
  const request = indexedDB.open('antrenman-takibi');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const transaction = db.transaction('meta', 'readwrite');
    const store = transaction.objectStore('meta');
    const read = store.get('program');
    read.onsuccess = () => {
      const program = read.result;
      const item = program.days.find((day) => day.id === change.dayId).items.find((row) => row.id === change.itemId);
      Object.assign(item, change.values);
      store.put(program);
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  };
})
"""

# Aşama 1 sürümünün bıraktığı veritabanını kurar: sürümü olmayan tek hareketlik program ve bir kayıt.
PHASE1_DATABASE_SCRIPT = """
(data) => new Promise((resolve, reject) => {
  const request = indexedDB.open('antrenman-takibi', 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const transaction = db.transaction(['meta', 'sessions'], 'readwrite');
    transaction.objectStore('meta').put(data.program);
    for (const session of data.sessions) transaction.objectStore('sessions').put(session);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
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


# ---------------------------------------------------------------- Yardımcılar

def sessions(page):
    return page.evaluate(READ_SCRIPT, ["sessions", None])


def stored_program(page):
    return page.evaluate(READ_SCRIPT, ["meta", "program"])


def today(page):
    return page.evaluate(TODAY_SCRIPT)


def open_day(page, day_id, day_name):
    page.locator(f".days a[href='#/antrenman/{day_id}']").click()
    expect(page.locator(".topbar h1")).to_have_text(day_name)


def go_home(page):
    page.get_by_role("link", name="← Günler").click()
    expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")


def finish(page):
    page.get_by_role("button", name="Bitir").click()


def card(page, title):
    return page.locator("[data-card]").filter(has=page.get_by_role("heading", name=title, exact=True))


def weight_input(scope):
    return scope.locator("input[data-field='weight']")


def weight_label(scope):
    return scope.locator(".weight label")


def reps(scope, row):
    return scope.get_by_label(f"{row}. set tekrar")


def reps_inputs(scope):
    return scope.locator("input[data-field='reps']")


def log_sets(scope, weight_text, reps_texts):
    if weight_text is not None:
        weight_input(scope).fill(weight_text)
    for row, text in enumerate(reps_texts, start=1):
        reps(scope, row).fill(text)


def radio(scope, name):
    return scope.get_by_role("radio", name=name, exact=True)


def machine_names(scope):
    return [text.strip() for text in scope.locator(".machines .chip:has(input)").all_text_contents()]


def add_machine(scope, name, unit_label):
    scope.get_by_role("button", name="+ Makine").click()
    submit_machine(scope, name, unit_label)


def submit_machine(scope, name, unit_label):
    scope.get_by_label("Ad", exact=True).fill(name)
    if unit_label:
        scope.get_by_role("radio", name=unit_label, exact=True).check()
    scope.get_by_role("button", name="Ekle").click()


def last_time(scope):
    return scope.locator(".last")


def card_message(scope):
    return scope.locator(".card-message")


def save_status(page):
    return page.locator("#save-status")


def workout_message(page):
    return page.locator("#workout-message")


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


# ---------------------------------------------------------------- Ana ekran ve program

def program_steps(run):
    def home_screen(page):
        page.goto(run.base_url + "/")
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")
        expect(page.locator("#next-title")).to_have_text("Push")
        expect(page.locator(".day-name")).to_have_text(["Push", "Pull", "Legs", "Upper", "Lower"])
        expect(page.locator(".days .muted")).to_have_text([
            "6 hareket · henüz yapılmadı",
            "8 hareket · henüz yapılmadı",
            "8 hareket · henüz yapılmadı",
            "6 hareket · henüz yapılmadı",
            "6 hareket · henüz yapılmadı",
        ])
        page.screenshot(path=str(ARTIFACTS / "asama2-ana-ekran-acik.png"), full_page=True)
        page.emulate_media(color_scheme="dark")
        page.screenshot(path=str(ARTIFACTS / "asama2-ana-ekran-koyu.png"), full_page=True)
        page.emulate_media(color_scheme="light")

    def push_cards(page):
        open_day(page, "push", "Push")
        expect(page.locator("[data-card] h2")).to_have_text([
            "Machine Chest Press",
            "Cable Fly",
            "Seated Lateral Raise",
            "Machine Shoulder Press",
            "Rope Pushdown",
            "Overhead Rope Extension",
        ])
        expect(page.locator("[data-card] .target")).to_have_text([
            "Hedef 3 × 10–12",
            "Hedef 3 × 12–15",
            "Hedef 4 × 15",
            "Hedef 3 × 10–12",
            "Hedef 3 × 12–15",
            "Hedef 2 × 15",
        ])
        expect(reps_inputs(card(page, "Seated Lateral Raise"))).to_have_count(4)
        expect(radio(card(page, "Machine Chest Press"), "Makine · kg")).to_be_checked()
        expect(radio(card(page, "Seated Lateral Raise"), "Dambıl · kg")).to_be_checked()
        go_home(page)

    def upper_cards(page):
        open_day(page, "upper", "Upper")
        expect(page.locator("[data-card]")).to_have_count(6)
        overhead = card(page, "Overhead Rope Extension")
        expect(overhead.locator(".target")).to_have_text("Hedef 3 × 12–15")
        expect(reps_inputs(overhead)).to_have_count(3)
        go_home(page)

    def lower_bodyweight(page):
        open_day(page, "lower", "Lower")
        for title in ("Hyperextension", "Ab Wheel Roll-Out"):
            bodyweight = card(page, title)
            expect(radio(bodyweight, "Vücut ağırlığı · ağırlıksız")).to_be_checked()
            expect(weight_input(bodyweight)).to_have_count(0)
        go_home(page)

    def pull_alternatives(page):
        open_day(page, "pull", "Pull")
        expect(page.locator("[data-card]")).to_have_count(8)
        alternating = card(page, "Wrist Curl / Reverse Curl")
        expect(radio(alternating, "Wrist Curl")).to_be_checked()
        expect(radio(alternating, "Reverse Curl")).not_to_be_checked()
        assert machine_names(alternating) == ["Dambıl · kg"], machine_names(alternating)
        radio(alternating, "Reverse Curl").check()
        expect(radio(alternating, "Bar · kg")).to_be_checked()
        assert machine_names(alternating) == ["Bar · kg"], machine_names(alternating)
        go_home(page)

    return [
        ("Ana ekran: 'Sıradaki' Push; 5 gün ve hareket sayıları", home_screen),
        ("Push: 6 hareket programdaki sırayla ve hedeflerle; başlangıç makineleri", push_cards),
        ("Upper: Overhead Rope Extension 3 × 12–15 (Push'ta 2 × 15)", upper_cards),
        ("Lower: ağırlıksız hareketlerde ağırlık kutusu yok", lower_bodyweight),
        ("Pull: dönüşümlü satırda hareket elle seçiliyor; makine listesi harekete göre", pull_alternatives),
    ]


# ---------------------------------------------------------------- Push antrenmanı

def push_workout_steps(run):
    state = {}

    def empty_and_missing_values(page):
        page.goto(run.base_url + "/")
        state["today"] = today(page)
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        assert machine_names(rope) == ["Kablo · kg"], machine_names(rope)
        expect(last_time(rope)).to_have_text("Bu makinede önceki kayıt yok")
        expect(weight_label(rope)).to_have_text("Ağırlık (kg)")
        finish(page)
        expect(workout_message(page)).to_have_text("En az bir hareket için set girin.")

        log_sets(rope, None, ["12", "12"])
        finish(page)
        expect(card_message(rope)).to_have_text("Ağırlığı girin.")
        expect(workout_message(page)).to_have_text("Bazı hareketlerde düzeltilmesi gereken değerler var.")
        expect(weight_input(rope)).to_have_attribute("aria-invalid", "true")
        expect(weight_input(rope)).to_be_focused()
        page.screenshot(path=str(ARTIFACTS / "asama2-eksik-deger.png"), full_page=True)
        weight_input(rope).fill("50")
        expect(card_message(rope)).to_have_text("")
        expect(workout_message(page)).to_have_text("")
        log_sets(rope, "", ["", ""])

        chest = card(page, "Machine Chest Press")
        weight_input(chest).fill("40")
        finish(page)
        expect(card_message(chest)).to_have_text("Tekrarları girin ya da ağırlığı silin.")
        expect(reps(chest, 3)).to_have_attribute("aria-invalid", "true")
        reps(chest, 1).fill("12")
        expect(reps(chest, 3)).not_to_have_attribute("aria-invalid", "true")
        log_sets(chest, "", [""])
        assert sessions(page) == [], "Hatalı değerlerle kayıt yapılmamalıydı"

    def machine_form_validation(page):
        rope = card(page, "Rope Pushdown")
        rope.get_by_role("button", name="+ Makine").click()
        expect(rope.get_by_label("Ad", exact=True)).to_be_focused()
        expect(radio(rope, "kg")).not_to_be_checked()
        rope.get_by_role("button", name="Ekle").click()
        expect(rope.locator(".machine-message")).to_have_text("Makineye bir ad verin.")
        submit_machine(rope, "kablo", "kademe")
        expect(rope.locator(".machine-message")).to_have_text("Bu adda bir makine zaten var.")
        rope.screenshot(path=str(ARTIFACTS / "asama2-makine-formu.png"))
        rope.get_by_role("button", name="Vazgeç").click()
        expect(rope.locator(".machine-form")).to_have_count(0)
        rope.get_by_role("button", name="+ Makine").click()
        submit_machine(rope, "Kablo 2", None)
        expect(rope.locator(".machine-message")).to_have_text("Birimi seçin: kg, kademe ya da ağırlıksız.")
        rope.get_by_role("button", name="Vazgeç").click()
        assert machine_names(rope) == ["Kablo · kg"], "Vazgeçince makine eklenmemeliydi"

    def add_machines(page):
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo 2", "kademe")
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        expect(radio(rope, "Kablo 2 · kademe")).to_be_checked()
        expect(weight_label(rope)).to_have_text("Kademe")
        expect(page.locator("#machine-names option[value='Kablo 2']")).to_have_count(1)
        fly = card(page, "Cable Fly")
        add_machine(fly, "Kablo 3", "kg")
        expect(radio(fly, "Kablo 3 · kg")).to_be_checked()
        assert machine_names(rope) == ["Kablo · kg", "Kablo 2 · kademe"], machine_names(rope)

    def add_and_remove_sets(page):
        rope = card(page, "Rope Pushdown")
        rope.get_by_role("button", name="+ Set").click()
        expect(reps_inputs(rope)).to_have_count(4)
        expect(reps(rope, 4)).to_be_focused()
        for _ in range(3):
            rope.get_by_role("button", name="− Set").click()
        expect(reps_inputs(rope)).to_have_count(1)
        expect(rope.get_by_role("button", name="− Set")).to_be_disabled()
        rope.get_by_role("button", name="+ Set").click()
        rope.get_by_role("button", name="+ Set").click()
        expect(reps_inputs(rope)).to_have_count(3)

    def finish_with_error_and_retry(page):
        log_sets(card(page, "Rope Pushdown"), "10", ["12", "12", "10"])
        log_sets(card(page, "Machine Chest Press"), "50", ["12", "11", "10"])
        page.evaluate("window.__failWrites = true")
        finish(page)
        expect(save_status(page)).to_contain_text("Kaydedilemedi.")
        expect(weight_input(card(page, "Rope Pushdown"))).to_have_value("10")
        assert sessions(page) == [], "Başarısız yazma kayıt eklememeliydi"
        page.screenshot(path=str(ARTIFACTS / "asama2-kayit-hatasi.png"))
        page.evaluate("window.__failWrites = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")
        expect(page.locator("#next-title")).to_have_text("Pull")
        expect(page.locator(".days .muted").first).to_have_text(f"6 hareket · son: {state['today']}")
        saved = sessions(page)
        assert len(saved) == 1, f"Tek kayıt olmalıydı: {len(saved)}"
        entries = saved[0]["entries"]
        assert [entry["name"] for entry in entries] == ["Machine Chest Press", "Rope Pushdown"], "Atlanan hareketler yazılmamalı"
        rope_entry = entries[1]
        assert (rope_entry["equipmentName"], rope_entry["unit"]) == ("Kablo 2", "level"), rope_entry
        assert rope_entry["sets"] == [{"weight": 10, "reps": 12}, {"weight": 10, "reps": 12}, {"weight": 10, "reps": 10}], rope_entry
        assert rope_entry["target"] == {"sets": 3, "repMin": 12, "repMax": 15}, rope_entry

    def reopen_shows_last_time(page):
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        expect(radio(rope, "Kablo 2 · kademe")).to_be_checked()
        expect(last_time(rope)).to_have_text(f"Geçen sefer — {state['today']}: 10k × 12 · 12 · 10")
        expect(weight_input(rope)).to_have_attribute("placeholder", "10")
        expect(weight_input(rope)).to_have_value("")
        expect(last_time(card(page, "Machine Chest Press"))).to_have_text(f"Geçen sefer — {state['today']}: 50 kg × 12 · 11 · 10")
        fly = card(page, "Cable Fly")
        expect(radio(fly, "Kablo · kg")).to_be_checked()
        expect(last_time(fly)).to_have_text("Bu makinede önceki kayıt yok")
        radio(rope, "Kablo · kg").check()
        expect(last_time(rope)).to_have_text("Bu makinede önceki kayıt yok")

    def leave_guard(page):
        reps(card(page, "Cable Fly"), 1).fill("12")
        messages = []

        def dismiss(dialog):
            messages.append(dialog.message)
            dialog.dismiss()

        page.once("dialog", dismiss)
        page.get_by_role("link", name="← Günler").click()
        expect(page.locator(".topbar h1")).to_have_text("Push")
        expect(reps(card(page, "Cable Fly"), 1)).to_have_value("12")
        assert messages and "kaydedilmedi" in messages[0], messages
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("link", name="← Günler").click()
        expect(page.locator("#next-title")).to_have_text("Pull")
        expect(page.locator("#flash")).to_have_count(0)

    def machine_error_and_retry(page):
        open_day(page, "push", "Push")
        overhead = card(page, "Overhead Rope Extension")
        page.evaluate("window.__failWrites = true")
        add_machine(overhead, "Kablo 4", "kg")
        expect(save_status(page)).to_contain_text("Makine eklenemedi.")
        expect(overhead.get_by_label("Ad", exact=True)).to_have_value("Kablo 4")
        assert machine_names(overhead) == ["Kablo · kg"], machine_names(overhead)
        page.evaluate("window.__failWrites = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        expect(radio(overhead, "Kablo 4 · kg")).to_be_checked()

    def screenshots(page):
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=str(ARTIFACTS / "asama2-antrenman-ust.png"))
        page.screenshot(path=str(ARTIFACTS / "asama2-antrenman-acik.png"), full_page=True)
        page.emulate_media(color_scheme="dark")
        page.screenshot(path=str(ARTIFACTS / "asama2-antrenman-koyu.png"), full_page=True)

    return [
        ("Boş 'Bitir', eksik ağırlık ve eksik tekrar uyarıları; kayıt yapılmıyor", empty_and_missing_values),
        ("Makine formu: boş ad, aynı ad ve seçilmemiş birim reddediliyor; Vazgeç", machine_form_validation),
        ("'Kablo 2 · kademe' ve 'Kablo 3 · kg' ekleniyor; ad önerileri güncelleniyor", add_machines),
        ("'+ Set' ve '− Set'", add_and_remove_sets),
        ("'Bitir'de yazma hatası: değerler kalıyor; 'Tekrar dene' kaydediyor", finish_with_error_and_retry),
        ("Yeniden açınca son kullanılan makine seçili, 'Geçen sefer' ve ipuçları görünüyor", reopen_shows_last_time),
        ("Kaydedilmemiş değerle çıkarken onay soruluyor", leave_guard),
        ("Makine eklerken yazma hatası: form kalıyor; 'Tekrar dene' ekliyor", machine_error_and_retry),
        ("Açık ve koyu tema ekran görüntüleri", screenshots),
    ]


# ---------------------------------------------------------------- Günler, makineler, dönüşümlü satır

def day_separation_steps(run):
    state = {}

    def legs(page):
        page.goto(run.base_url + "/")
        state["today"] = today(page)
        open_day(page, "legs", "Legs")
        calf = card(page, "Standing Calf Raise")
        expect(reps_inputs(calf)).to_have_count(4)
        add_machine(calf, "Calf 2", "kg")
        expect(radio(calf, "Calf 2 · kg")).to_be_checked()
        log_sets(calf, "60", ["15", "15", "14", "12"])
        finish(page)
        expect(page.locator("#flash")).to_have_text("Legs antrenmanı kaydedildi ✓")
        expect(page.locator("#next-title")).to_have_text("Upper")

    def lower_is_separate(page):
        open_day(page, "lower", "Lower")
        calf = card(page, "Standing Calf Raise")
        assert machine_names(calf) == ["Makine · kg", "Calf 2 · kg"], "Makine harekete ait olmalı"
        expect(radio(calf, "Makine · kg")).to_be_checked()
        radio(calf, "Calf 2 · kg").check()
        expect(last_time(calf)).to_have_text("Bu makinede önceki kayıt yok")
        log_sets(calf, "40", ["15", "15", "15", "15"])
        finish(page)
        expect(page.locator("#flash")).to_have_text("Lower antrenmanı kaydedildi ✓")

    def legs_shows_legs(page):
        open_day(page, "legs", "Legs")
        calf = card(page, "Standing Calf Raise")
        expect(radio(calf, "Calf 2 · kg")).to_be_checked()
        expect(last_time(calf)).to_have_text(f"Geçen sefer — {state['today']}: 60 kg × 15 · 15 · 14 · 12")
        go_home(page)

    def lower_shows_lower(page):
        open_day(page, "lower", "Lower")
        calf = card(page, "Standing Calf Raise")
        expect(radio(calf, "Calf 2 · kg")).to_be_checked()
        expect(last_time(calf)).to_have_text(f"Geçen sefer — {state['today']}: 40 kg × 15 · 15 · 15 · 15")
        go_home(page)
        expect(page.locator("#next-title")).to_have_text("Push")

    def alternating_choice_saved(page):
        open_day(page, "pull", "Pull")
        alternating = card(page, "Wrist Curl / Reverse Curl")
        radio(alternating, "Reverse Curl").check()
        log_sets(alternating, "20", ["15", "15"])
        finish(page)
        expect(page.locator("#flash")).to_have_text("Pull antrenmanı kaydedildi ✓")
        pull = [session for session in sessions(page) if session["dayId"] == "pull"]
        entry = pull[0]["entries"][0]
        assert (entry["exerciseId"], entry["equipmentName"], entry["options"]) == (
            "reverse-curl",
            "Bar",
            ["wrist-curl", "reverse-curl"],
        ), entry

    return [
        ("Legs: Standing Calf Raise 'Calf 2' makinesiyle kaydediliyor; 'Sıradaki' Upper", legs),
        ("Lower: 'Calf 2' listede (makine harekete ait) ama Legs kaydı görünmüyor", lower_is_separate),
        ("Legs'e dönünce yalnızca Legs kaydı görünüyor", legs_shows_legs),
        ("Lower'a dönünce yalnızca Lower kaydı görünüyor; Lower'dan sonra 'Sıradaki' Push", lower_shows_lower),
        ("Pull: dönüşümlü satırda seçilen hareket kaydediliyor", alternating_choice_saved),
    ]


# ---------------------------------------------------------------- Hedef kopyası

def target_copy_steps(run):
    def save_push(page):
        page.goto(run.base_url + "/")
        open_day(page, "push", "Push")
        log_sets(card(page, "Rope Pushdown"), "50", ["12"])
        finish(page)
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")

    def new_target_old_record(page):
        page.evaluate(EDIT_ITEM_SCRIPT, {"dayId": "push", "itemId": "push-rope-pushdown", "values": {"sets": 4, "repMax": 20}})
        page.reload()
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        expect(rope.locator(".target")).to_have_text("Hedef 4 × 12–20")
        expect(reps_inputs(rope)).to_have_count(4)
        entry = sessions(page)[0]["entries"][0]
        assert entry["target"] == {"sets": 3, "repMin": 12, "repMax": 15}, entry["target"]

    return [
        ("Push kaydediliyor (hedef 3 × 12–15)", save_push),
        ("Programdaki hedef değişince yeni antrenman yeni hedefi alıyor; eski kayıt eski hedefi taşıyor", new_target_old_record),
    ]


# ---------------------------------------------------------------- Aşama 1'den yükseltme

def upgrade_steps(run):
    phase1 = {
        "program": {
            "key": "program",
            "exercises": {
                "rope-pushdown": {
                    "name": "Rope Pushdown",
                    "equipment": [
                        {"id": "rope-pushdown-kablo", "name": "Kablo", "unit": "kg"},
                        {"id": "eq-eski", "name": "Kablo 2", "unit": "level"},
                    ],
                },
            },
            "days": [{
                "id": "push",
                "name": "Push",
                "items": [{"id": "push-rope-pushdown", "options": ["rope-pushdown"], "sets": 3, "repMin": 12, "repMax": 15}],
            }],
        },
        "sessions": [{
            "id": "eski-kayit",
            "dayId": "push",
            "dayName": "Push",
            "startedAt": "2026-09-22T12:00:00.000Z",
            "finishedAt": "2026-09-22T12:00:00.000Z",
            "entries": [{
                "exerciseId": "rope-pushdown",
                "equipmentId": "eq-eski",
                "name": "Rope Pushdown",
                "equipmentName": "Kablo 2",
                "unit": "level",
                "options": ["rope-pushdown"],
                "target": {"sets": 3, "repMin": 12, "repMax": 15},
                "sets": [{"weight": 10, "reps": 12}],
            }],
        }],
    }

    def upgraded(page):
        page.goto(run.base_url + "/tests/harness.js")  # aynı adreste boş bir sayfa: veritabanı elle kurulur
        page.evaluate(PHASE1_DATABASE_SCRIPT, phase1)
        page.goto(run.base_url + "/")
        expect(page.locator(".day-name")).to_have_count(5)
        expect(page.locator("#next-title")).to_have_text("Pull")
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        assert machine_names(rope) == ["Kablo · kg", "Kablo 2 · kademe"], machine_names(rope)
        expect(radio(rope, "Kablo 2 · kademe")).to_be_checked()
        expect(last_time(rope)).to_have_text("Geçen sefer — 22 Eyl: 10k × 12")
        assert stored_program(page)["seedVersion"] == 2, "Yükseltilen program kaydedilmeliydi"

    return [
        ("Aşama 1 programı yükseltiliyor: 5 gün geliyor, eklenen makine ve kayıt duruyor", upgraded),
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
            run.flow("Ana ekran ve program", program_steps(run))
            run.flow("Push antrenmanı", push_workout_steps(run), init_script=FAIL_WRITES_SCRIPT)
            run.flow("Günler ayrı, makineler harekete ait", day_separation_steps(run))
            run.flow("Hedef kopyası", target_copy_steps(run))
            run.flow("Aşama 1 verisinden yükseltme", upgrade_steps(run))
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
