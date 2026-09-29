"""Uçtan uca testler.

Çalıştırma (proje klasöründe):
    .venv\\Scripts\\python tests\\e2e.py

Betik kendi yerel sunucusunu boş bir portta açar ve kurulu Chrome'u telefon
boyutunda (390×844) kullanır. Her akış temiz bir tarayıcı profiliyle (boş
veritabanı) başlar; akıştaki adımlar sırayla aynı sayfada çalışır ve bir adım
başarısız olursa sonrakiler atlanır. Ekran görüntüleri tests/artifacts/
klasörüne kaydedilir; bu klasör git'e eklenmez.
"""
import json
import re
import shutil
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
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


def add_machine(scope, name, unit_label, wait=True):
    scope.get_by_role("button", name="+ Makine").click()
    submit_machine(scope, name, unit_label)
    if wait:
        # Kart makine kaydedildikten sonra yeniden çizilir; o bitmeden yazılan değer eski kutuya gider.
        expect(radio(scope, f"{name} · {unit_label}")).to_be_checked()


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

    def service_worker_lists_all_files(page):
        text = urllib.request.urlopen(run.base_url + "/sw.js").read().decode("utf-8")
        listed = set(re.findall(r"^\s+'([^']+)',$", text, re.MULTILINE))
        app_files = [*ROOT.glob("css/*.css"), *ROOT.glob("js/**/*.js"), *ROOT.glob("icons/*")]
        expected = {"./", "index.html", "manifest.webmanifest"} | {path.relative_to(ROOT).as_posix() for path in app_files}
        expected -= {"icons/icon-source.png"}  # yalnızca simgeleri üretmek için kaynak
        assert listed == expected, f"sw.js listesi eksik ya da fazla: eksik {expected - listed}, fazla {listed - expected}"
        for file in listed - {"./"}:
            assert urllib.request.urlopen(f"{run.base_url}/{file}").status == 200, file
        return f"{len(listed)} dosya"

    return [
        ("Birim testlerinin hepsi geçiyor", unit_tests_pass),
        ("Sunucu gizli dosyaları vermiyor", hidden_files_not_served),
        ("Service worker uygulamanın bütün dosyalarını saklıyor", service_worker_lists_all_files),
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
        expect(page.locator("[data-card] .no-machine")).to_have_count(6)
        expect(page.locator("[data-card] .chip:has(input[name^='equipment'])")).to_have_count(0)
        expect(page.locator("[data-card] input[data-field]")).to_have_count(0)
        page.screenshot(path=str(ARTIFACTS / "asama2-makinesiz-kartlar.png"))
        lateral = card(page, "Seated Lateral Raise")
        add_machine(lateral, "Dambıl", "kg")
        expect(radio(lateral, "Dambıl · kg")).to_be_checked()
        expect(lateral.locator(".no-machine")).to_have_count(0)
        expect(reps_inputs(lateral)).to_have_count(4)
        go_home(page)

    def upper_cards(page):
        open_day(page, "upper", "Upper")
        expect(page.locator("[data-card]")).to_have_count(6)
        overhead = card(page, "Overhead Rope Extension")
        expect(overhead.locator(".target")).to_have_text("Hedef 3 × 12–15")
        go_home(page)

    def lower_bodyweight(page):
        open_day(page, "lower", "Lower")
        wheel = card(page, "Ab Wheel Roll-Out")
        add_machine(wheel, "Vücut ağırlığı", "ağırlıksız")
        expect(radio(wheel, "Vücut ağırlığı · ağırlıksız")).to_be_checked()
        expect(weight_input(wheel)).to_have_count(0)
        expect(reps_inputs(wheel)).to_have_count(3)
        expect(card(page, "Hyperextension").locator(".no-machine")).to_have_count(1)
        go_home(page)

    def pull_alternatives(page):
        open_day(page, "pull", "Pull")
        expect(page.locator("[data-card]")).to_have_count(8)
        alternating = card(page, "Wrist Curl / Reverse Curl")
        expect(radio(alternating, "Wrist Curl")).to_be_checked()
        expect(radio(alternating, "Reverse Curl")).not_to_be_checked()
        add_machine(alternating, "Dambıl", "kg")
        assert machine_names(alternating) == ["Dambıl · kg"], machine_names(alternating)
        radio(alternating, "Reverse Curl").check()
        expect(alternating.locator(".no-machine")).to_have_count(1)
        assert machine_names(alternating) == [], "Makine harekete ait: Reverse Curl'ün makinesi yok"
        radio(alternating, "Wrist Curl").check()
        expect(radio(alternating, "Dambıl · kg")).to_be_checked()
        go_home(page)

    return [
        ("Ana ekran: 'Sıradaki' Push; 5 gün ve hareket sayıları", home_screen),
        ("Push: 6 hareket programdaki sırayla ve hedeflerle; hiçbirinde varsayılan makine yok", push_cards),
        ("Upper: Overhead Rope Extension 3 × 12–15 (Push'ta 2 × 15)", upper_cards),
        ("Lower: elle eklenen ağırlıksız makinede ağırlık kutusu yok", lower_bodyweight),
        ("Pull: dönüşümlü satırda hareket elle seçiliyor; makine listesi harekete göre", pull_alternatives),
    ]


# ---------------------------------------------------------------- Push antrenmanı

def push_workout_steps(run):
    state = {}

    def machines_added_and_saved(page):
        page.goto(run.base_url + "/")
        state["today"] = today(page)
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        expect(rope.locator(".no-machine")).to_have_text("Bu hareket için henüz makine yok. Kullandığınız makineyi ekleyin.")
        add_machine(rope, "Kablo", "kg")
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        expect(radio(rope, "Kablo · kg")).to_be_checked()
        expect(last_time(rope)).to_have_text("Bu makinede önceki kayıt yok")
        expect(weight_label(rope)).to_have_text("Ağırlık (kg)")
        add_machine(card(page, "Machine Chest Press"), "Göğüs Pres", "kg")
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        page.reload()
        expect(page.locator(".topbar h1")).to_have_text("Push")
        assert machine_names(card(page, "Rope Pushdown")) == ["Kablo · kg"], "Eklenen makine kaydedilmeliydi"
        expect(radio(card(page, "Machine Chest Press"), "Göğüs Pres · kg")).to_be_checked()
        saved = stored_program(page)["exercises"]
        assert [equipment["name"] for equipment in saved["rope-pushdown"]["equipment"]] == ["Kablo"], saved["rope-pushdown"]

    def empty_and_missing_values(page):
        rope = card(page, "Rope Pushdown")
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
        assert not any(session["finishedAt"] for session in sessions(page)), "Hatalı değerlerle antrenman bitmemeliydi"

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
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        page.reload()
        expect(page.locator(".topbar h1")).to_have_text("Push")
        rope = card(page, "Rope Pushdown")
        assert machine_names(rope) == ["Kablo · kg", "Kablo 2 · kademe"], "İkinci makine de kaydedilmeliydi"
        expect(radio(rope, "Kablo 2 · kademe")).to_be_checked()  # devam eden antrenmanda seçim korunur
        expect(radio(card(page, "Cable Fly"), "Kablo 3 · kg")).to_be_checked()

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
        radio(card(page, "Rope Pushdown"), "Kablo 2 · kademe").check()
        log_sets(card(page, "Rope Pushdown"), "10", ["12", "12", "10"])
        log_sets(card(page, "Machine Chest Press"), "50", ["12", "11", "10"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        page.evaluate("window.__failWrites = true")
        finish(page)
        expect(save_status(page)).to_contain_text("Antrenman bitirilemedi.")
        expect(weight_input(card(page, "Rope Pushdown"))).to_have_value("10")
        assert not any(session["finishedAt"] for session in sessions(page)), "Başarısız yazma antrenmanı bitirmemeliydi"
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
        expect(radio(fly, "Kablo 3 · kg")).to_be_checked()
        expect(last_time(fly)).to_have_text("Bu makinede önceki kayıt yok")
        radio(rope, "Kablo · kg").check()
        expect(last_time(rope)).to_have_text("Bu makinede önceki kayıt yok")

    def leaving_keeps_values(page):
        reps(card(page, "Cable Fly"), 1).fill("12")
        dialogs = []
        page.on("dialog", lambda dialog: (dialogs.append(dialog.message), dialog.dismiss()))
        page.get_by_role("link", name="← Günler").click()
        expect(page.locator("#resume-title")).to_have_text("Push")
        assert not dialogs, f"Çıkarken onay sorulmamalıydı: {dialogs}"
        page.get_by_role("link", name="Devam et").click()
        expect(page.locator(".topbar h1")).to_have_text("Push")
        expect(reps(card(page, "Cable Fly"), 1)).to_have_value("12")
        go_home(page)

    def machine_error_and_retry(page):
        open_day(page, "push", "Push")
        overhead = card(page, "Overhead Rope Extension")
        page.evaluate("window.__failWrites = true")
        add_machine(overhead, "Kablo 4", "kg", wait=False)
        expect(save_status(page)).to_contain_text("Makine eklenemedi.")
        expect(overhead.get_by_label("Ad", exact=True)).to_have_value("Kablo 4")
        assert machine_names(overhead) == [], machine_names(overhead)
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
        ("Makineler elle ekleniyor ve sayfa yenilense de kayıtlı kalıyor", machines_added_and_saved),
        ("Boş 'Bitir', eksik ağırlık ve eksik tekrar uyarıları; kayıt yapılmıyor", empty_and_missing_values),
        ("Makine formu: boş ad, aynı ad ve seçilmemiş birim reddediliyor; Vazgeç", machine_form_validation),
        ("İkinci makine ('Kablo 2 · kademe') ve 'Kablo 3 · kg' ekleniyor; yenilemeden sonra duruyor", add_machines),
        ("'+ Set' ve '− Set'", add_and_remove_sets),
        ("'Bitir'de yazma hatası: değerler kalıyor; 'Tekrar dene' kaydediyor", finish_with_error_and_retry),
        ("Yeniden açınca son kullanılan makine seçili, 'Geçen sefer' ve ipuçları görünüyor", reopen_shows_last_time),
        ("Çıkınca değerler kaydediliyor; 'Devam et' ile geri geliyor", leaving_keeps_values),
        ("Makine eklerken yazma hatası: form kalıyor; 'Tekrar dene' ekliyor", machine_error_and_retry),
        ("Açık ve koyu tema ekran görüntüleri", screenshots),
    ]


# ---------------------------------------------------------------- Otomatik kaydetme ve devam eden antrenman

def unfinished(page):
    return [session for session in sessions(page) if not session["finishedAt"]]


def autosave_steps(run):
    state = {}

    def saves_while_typing(page):
        page.goto(run.base_url + "/")
        state["today"] = today(page)
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        assert sessions(page) == [], "Değer girilmeden antrenman kaydedilmemeli"
        log_sets(rope, "50", ["12"])
        expect(save_status(page)).to_have_text("Kaydediliyor…")
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        [session] = unfinished(page)
        draft = next(card for card in session["draft"]["cards"] if card["exerciseId"] == "rope-pushdown")
        assert (draft["weight"], draft["reps"]) == ("50", ["12", "", ""]), draft

    def resume_after_closing(page):
        page.goto("about:blank")  # sekme kapanmış gibi
        page.goto(run.base_url + "/")
        expect(page.locator("#resume-title")).to_have_text("Push")
        expect(page.locator(".days .muted").first).to_have_text("6 hareket · devam ediyor")
        expect(page.locator("#next-title")).to_have_count(0)  # sıradaki gün zaten devam ediyor
        page.screenshot(path=str(ARTIFACTS / "asama3-devam-et.png"))
        page.get_by_role("link", name="Devam et").click()
        rope = card(page, "Rope Pushdown")
        expect(weight_input(rope)).to_have_value("50")
        expect(reps(rope, 1)).to_have_value("12")
        expect(radio(rope, "Kablo · kg")).to_be_checked()
        expect(last_time(rope)).to_have_text("Bu makinede önceki kayıt yok")  # bitmemiş antrenman sayılmaz

    def write_error_and_retry(page):
        rope = card(page, "Rope Pushdown")
        page.evaluate("window.__failWrites = true")
        reps(rope, 2).fill("11")
        expect(save_status(page)).to_contain_text("Kaydedilemedi.")
        expect(save_status(page)).to_contain_text("Uygulamayı kapatmayın")
        expect(reps(rope, 2)).to_have_value("11")
        page.screenshot(path=str(ARTIFACTS / "asama3-kayit-hatasi.png"))
        page.evaluate("window.__failWrites = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        draft = next(card for card in unfinished(page)[0]["draft"]["cards"] if card["exerciseId"] == "rope-pushdown")
        assert draft["reps"] == ["12", "11", ""], draft

    def finish_blocked_by_error(page):
        rope = card(page, "Rope Pushdown")
        page.evaluate("window.__failWrites = true")
        reps(rope, 3).fill("10")
        expect(save_status(page)).to_contain_text("Kaydedilemedi.")
        finish(page)
        expect(save_status(page)).to_contain_text("Antrenman bitirilemedi.")
        expect(page.locator(".topbar h1")).to_have_text("Push")
        assert len(unfinished(page)) == 1 and not [s for s in sessions(page) if s["finishedAt"]], "Antrenman bitmemeliydi"
        page.evaluate("window.__failWrites = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")
        expect(page.locator("#resume-title")).to_have_count(0)
        expect(page.locator("#next-title")).to_have_text("Pull")
        [session] = sessions(page)
        assert session["finishedAt"] and "draft" not in session, session
        assert session["entries"][0]["sets"] == [
            {"weight": 50, "reps": 12},
            {"weight": 50, "reps": 11},
            {"weight": 50, "reps": 10},
        ], session["entries"]

    def leaving_flushes(page):
        open_day(page, "pull", "Pull")
        lat = card(page, "Lat Pulldown (wide grip)")
        add_machine(lat, "Makine", "kg")
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        log_sets(lat, "40", ["10"])
        page.get_by_role("link", name="← Günler").click()  # 0,5 sn beklemeden çıkılıyor
        expect(page.locator("#resume-title")).to_have_text("Pull")
        page.get_by_role("link", name="Devam et").click()
        lat = card(page, "Lat Pulldown (wide grip)")
        expect(weight_input(lat)).to_have_value("40")
        expect(reps(lat, 1)).to_have_value("10")
        go_home(page)

    def conflict_continue_and_delete(page):
        page.locator(".days a[href='#/antrenman/legs']").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Pull antrenmanı bitmedi")
        page.screenshot(path=str(ARTIFACTS / "asama3-baska-gun.png"))
        page.get_by_role("link", name="Devam et").click()
        expect(page.locator(".topbar h1")).to_have_text("Pull")
        go_home(page)
        page.locator(".days a[href='#/antrenman/legs']").click()
        page.once("dialog", lambda dialog: dialog.dismiss())
        page.get_by_role("button", name="Sil ve Legs antrenmanına başla").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Pull antrenmanı bitmedi")
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Sil ve Legs antrenmanına başla").click()
        expect(page.locator(".topbar h1")).to_have_text("Legs")
        assert unfinished(page) == [], "Pull antrenmanı silinmeliydi"

    def conflict_finish(page):
        press = card(page, "Leg Press")
        add_machine(press, "Makine", "kg")
        log_sets(press, "100", ["12", "12"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        go_home(page)
        page.locator(".days a[href='#/antrenman/upper']").click()
        page.get_by_role("button", name="Bitir ve Upper antrenmanına başla").click()
        expect(page.locator(".topbar h1")).to_have_text("Upper")
        legs = [session for session in sessions(page) if session["dayId"] == "legs"]
        assert legs and legs[0]["finishedAt"] and legs[0]["entries"][0]["name"] == "Leg Press", legs

    def conflict_finish_with_problems(page):
        incline = card(page, "Incline Dumbbell Press")
        add_machine(incline, "Dambıl", "kg")
        log_sets(incline, None, ["10"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        go_home(page)
        page.locator(".days a[href='#/antrenman/lower']").click()
        page.get_by_role("button", name="Bitir ve Lower antrenmanına başla").click()
        expect(page.locator("#conflict-message")).to_have_text(
            "Upper antrenmanında eksik ya da hatalı değerler var. Düzeltmek için antrenmana devam edin.")
        assert len(unfinished(page)) == 1, "Hatalı antrenman bitmemeliydi"

    def cancel_workout(page):
        page.get_by_role("link", name="Devam et").click()
        expect(page.locator(".topbar h1")).to_have_text("Upper")
        page.once("dialog", lambda dialog: dialog.dismiss())
        page.get_by_role("button", name="Antrenmanı iptal et").click()
        expect(page.locator(".topbar h1")).to_have_text("Upper")
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Antrenmanı iptal et").click()
        expect(page.locator("#flash")).to_have_text("Antrenman iptal edildi.")
        expect(page.locator("#resume-title")).to_have_count(0)
        assert unfinished(page) == [], "İptal edilen antrenman silinmeliydi"

    return [
        ("Yazınca 'Kaydediliyor…' ve 'Kaydedildi ✓'; bitmemiş antrenman kaydediliyor", saves_while_typing),
        ("Sekme kapatılıp açılınca 'Devam et' ile değerler geliyor; bitmemiş antrenman sayılmıyor", resume_after_closing),
        ("Yazma hatası: 'Kaydedilemedi', değer ekranda; 'Tekrar dene' kaydediyor", write_error_and_retry),
        ("Hata varken 'Bitir' antrenmanı bitirmiyor; 'Tekrar dene' bitiriyor", finish_blocked_by_error),
        ("Beklemeden ekrandan çıkınca da son değer kaydediliyor", leaving_flushes),
        ("Başka gün açılınca soruluyor: 'Devam et' ve onaylı 'Sil'", conflict_continue_and_delete),
        ("'Bitir ve … başla': önceki antrenman bitiyor, yeni gün açılıyor", conflict_finish),
        ("Hatalı değerli antrenman oradan bitirilemiyor", conflict_finish_with_problems),
        ("'Antrenmanı iptal et' onay alıp siliyor", cancel_workout),
    ]


# ---------------------------------------------------------------- Yedekleme

PUT_SCRIPT = """
([storeName, value]) => new Promise((resolve, reject) => {
  const request = indexedDB.open('antrenman-takibi');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  };
})
"""


def iso_days_ago(days):
    moment = datetime.now(timezone.utc) - timedelta(days=days)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def snapshot(page):
    program = stored_program(page)
    program.pop("key", None)
    return {"program": program, "sessions": sorted(sessions(page), key=lambda session: session["id"])}


def backup_steps(run):
    state = {}

    def create_data(page):
        page.goto(run.base_url + "/")
        state["today"] = today(page)
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        log_sets(rope, "50", ["12"])
        finish(page)
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")
        open_day(page, "pull", "Pull")
        lat = card(page, "Lat Pulldown (wide grip)")
        add_machine(lat, "Makine", "kg")
        log_sets(lat, "40", ["10"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        go_home(page)

    def download_backup(page):
        page.get_by_role("link", name="Ayarlar").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Ayarlar")
        expect(page.locator("#last-backup")).to_have_text("Son yedek: henüz yedek alınmadı")
        expect(page.locator("#storage-status")).not_to_be_empty()
        with page.expect_download() as info:
            page.get_by_role("button", name="Yedeği indir").click()
        download = info.value
        assert re.fullmatch(r"antrenman-yedegi-\d{4}-\d{2}-\d{2}\.json", download.suggested_filename), download.suggested_filename
        path = ARTIFACTS / download.suggested_filename
        download.save_as(path)
        state["backup_path"] = path
        backup = json.loads(path.read_text(encoding="utf-8"))
        assert (backup["app"], backup["backupVersion"], len(backup["sessions"])) == ("antrenman-takibi", 1, 2), backup.keys()
        assert sum(1 for session in backup["sessions"] if not session["finishedAt"]) == 1, "Devam eden antrenman da yedekte olmalı"
        assert backup["program"]["exercises"]["rope-pushdown"]["equipment"][0]["name"] == "Kablo"
        expect(page.locator("#backup-message")).to_have_text(f"Yedek hazırlandı: {download.suggested_filename} (2 antrenman).")
        expect(page.locator("#last-backup")).to_contain_text(f"Son yedek: {state['today']}")
        state["exported"] = snapshot(page)
        page.screenshot(path=str(ARTIFACTS / "asama4-ayarlar.png"), full_page=True)

    def change_data(page):
        page.get_by_role("link", name="← Günler").click()
        page.get_by_role("link", name="Devam et").click()
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Antrenmanı iptal et").click()
        expect(page.locator("#flash")).to_have_text("Antrenman iptal edildi.")
        open_day(page, "push", "Push")
        add_machine(card(page, "Cable Fly"), "Kablo 3", "kg")
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        go_home(page)
        assert snapshot(page) != state["exported"], "Veriler değişmiş olmalıydı"
        state["changed"] = snapshot(page)

    def broken_files_rejected(page):
        page.get_by_role("link", name="Ayarlar").click()
        file_input = page.locator("#restore-file")
        file_input.set_input_files({"name": "bozuk.json", "mimeType": "application/json", "buffer": b"bozuk"})
        expect(page.locator("#restore-message")).to_have_text("Dosya okunamadı: JSON biçiminde bir yedek değil. Hiçbir şey değiştirilmedi.")
        file_input.set_input_files({"name": "baska.json", "mimeType": "application/json", "buffer": b'{"app": "baska"}'})
        expect(page.locator("#restore-message")).to_have_text("Bu dosya bir Antrenman Takibi yedeği değil. Hiçbir şey değiştirilmedi.")
        expect(page.locator("#restore-summary")).to_have_count(0)
        assert snapshot(page) == state["changed"], "Bozuk dosya hiçbir şeyi değiştirmemeli"

    def summary_and_cancel(page):
        page.locator("#restore-file").set_input_files(state["backup_path"])
        summary = page.locator("#restore-summary")
        expect(summary).to_contain_text("2 antrenman (devam eden: Pull)")
        expect(summary).to_contain_text("Bu cihazdaki 1 antrenman ve program, yedektekilerle değiştirilecek.")
        page.screenshot(path=str(ARTIFACTS / "asama4-geri-yukleme-ozeti.png"), full_page=True)
        page.get_by_role("button", name="Vazgeç").click()
        expect(summary).to_have_count(0)
        assert snapshot(page) == state["changed"], "Vazgeçince hiçbir şey değişmemeli"

    def failed_restore_changes_nothing(page):
        page.evaluate("window.__failWrites = true")
        page.locator("#restore-file").set_input_files(state["backup_path"])
        page.get_by_role("button", name="Geri yükle").click()
        expect(page.locator("#restore-message")).to_contain_text("Yedek geri yüklenemedi; hiçbir şey değiştirilmedi.")
        page.evaluate("window.__failWrites = false")
        assert snapshot(page) == state["changed"], "Yarıda kalan geri yükleme eski verileri silmemeli"

    def restore_brings_back_same_data(page):
        page.locator("#restore-file").set_input_files(state["backup_path"])
        page.get_by_role("button", name="Geri yükle").click()
        expect(page.locator("#restore-message")).to_have_text("Yedek geri yüklendi: 2 antrenman.")
        assert snapshot(page) == state["exported"], "Geri yüklenen veri yedekle aynı olmalı"
        page.get_by_role("link", name="← Günler").click()
        expect(page.locator("#resume-title")).to_have_text("Pull")
        page.get_by_role("link", name="Devam et").click()
        lat = card(page, "Lat Pulldown (wide grip)")
        expect(weight_input(lat)).to_have_value("40")
        go_home(page)
        assert stored_program(page)["exercises"]["cable-fly"]["equipment"] == [], "Yedekten sonra eklenen makine gitmeli"

    def reminders(page):
        expect(page.locator("#backup-reminder")).to_have_count(0)
        page.evaluate(PUT_SCRIPT, ["meta", {"key": "settings", "lastBackupAt": iso_days_ago(40)}])
        page.reload()
        expect(page.locator("#backup-reminder")).to_contain_text("Son yedek 40 gün önce alındı.")
        page.screenshot(path=str(ARTIFACTS / "asama4-hatirlatma.png"))
        page.evaluate(PUT_SCRIPT, ["meta", {"key": "settings"}])
        finished = next(session for session in sessions(page) if session["finishedAt"])
        page.evaluate(PUT_SCRIPT, ["sessions", {**finished, "startedAt": iso_days_ago(35), "finishedAt": iso_days_ago(35)}])
        page.reload()
        expect(page.locator("#backup-reminder")).to_contain_text("Henüz yedek almadınız.")
        page.locator("#backup-reminder").get_by_role("link", name="Yedek al").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Ayarlar")

    return [
        ("Veri oluşturuluyor: bitmiş Push ve devam eden Pull", create_data),
        ("Yedek indiriliyor: dosya adı, içerik (devam eden dahil) ve son yedek tarihi", download_backup),
        ("Yedekten sonra veriler değiştiriliyor", change_data),
        ("Bozuk ve yabancı dosya reddediliyor; hiçbir şey değişmiyor", broken_files_rejected),
        ("Geri yükleme özeti gösteriliyor; 'Vazgeç' hiçbir şeyi değiştirmiyor", summary_and_cancel),
        ("Geri yükleme yarıda hata verirse eski veriler olduğu gibi kalıyor", failed_restore_changes_nothing),
        ("Geri yükleyince veri yedekle birebir aynı geliyor", restore_brings_back_same_data),
        ("Hatırlatma: 30 günden eski yedek ve hiç alınmamış yedek", reminders),
    ]


# ---------------------------------------------------------------- Makine silme ve ilerleme sayacı

def counter_line(scope):
    return scope.locator(".counter")


def live_progress(scope):
    return scope.locator(".progress-live")


def delete_machine(page, scope, name, accept):
    messages = []

    def answer(dialog):
        messages.append(dialog.message)
        dialog.accept() if accept else dialog.dismiss()

    page.once("dialog", answer)
    scope.get_by_role("button", name=f"{name} makinesini sil").click()
    return messages


def machines_and_counter_steps(run):
    state = {}

    def delete_unused_machine(page):
        page.goto(run.base_url + "/")
        state["today"] = today(page)
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        add_machine(rope, "Kablo 2", "kademe")
        expect(radio(rope, "Kablo 2 · kademe")).to_be_checked()
        rope.get_by_role("button", name="Düzenle").click()
        expect(rope.locator(".machine-list li")).to_have_count(2)
        messages = delete_machine(page, rope, "Kablo 2", accept=False)
        assert messages == ['"Kablo 2" makinesi silinsin mi?'], messages
        expect(rope.locator(".machine-list li")).to_have_count(2)
        delete_machine(page, rope, "Kablo 2", accept=True)
        expect(save_status(page)).to_have_text("Makine silindi ✓")
        expect(rope.locator(".machine-list li")).to_have_count(1)
        page.screenshot(path=str(ARTIFACTS / "asama6-makine-duzenle.png"))
        rope.get_by_role("button", name="Bitti").click()
        assert machine_names(rope) == ["Kablo · kg"], machine_names(rope)
        expect(radio(rope, "Kablo · kg")).to_be_checked()
        saved = stored_program(page)["exercises"]["rope-pushdown"]["equipment"]
        assert [equipment["name"] for equipment in saved] == ["Kablo"], "Kaydı olmayan makine tamamen silinmeli"

    def delete_used_machine(page):
        chest = card(page, "Machine Chest Press")
        add_machine(chest, "Göğüs Pres", "kg")
        log_sets(chest, "40", ["12"])
        finish(page)
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")
        open_day(page, "push", "Push")
        chest = card(page, "Machine Chest Press")
        chest.get_by_role("button", name="Düzenle").click()
        messages = delete_machine(page, chest, "Göğüs Pres", accept=True)
        assert messages and "1 kayıtlı antrenman var; o kayıtlar silinmez." in messages[0], messages
        expect(chest.locator(".no-machine")).to_have_count(1)
        saved = stored_program(page)["exercises"]["machine-chest-press"]["equipment"]
        assert len(saved) == 1 and saved[0]["archived"] is True, saved
        assert len(sessions(page)) == 1, "Kayıtlar silinmemeli"
        add_machine(chest, "Göğüs Pres", "kg")  # silinen makinenin adı yeniden kullanılabilir
        expect(radio(chest, "Göğüs Pres · kg")).to_be_checked()
        expect(last_time(chest)).to_have_text("Bu makinede önceki kayıt yok")
        go_home(page)

    def counter_from_existing_records(page):
        kablo = next(e for e in stored_program(page)["exercises"]["rope-pushdown"]["equipment"] if e["name"] == "Kablo")
        state["kablo"] = kablo["id"]

        def record(record_id, days_ago, weight, reps_list):
            return {
                "id": record_id,
                "dayId": "push",
                "dayName": "Push",
                "startedAt": iso_days_ago(days_ago),
                "finishedAt": iso_days_ago(days_ago),
                "entries": [{
                    "exerciseId": "rope-pushdown",
                    "equipmentId": kablo["id"],
                    "name": "Rope Pushdown",
                    "equipmentName": "Kablo",
                    "unit": "kg",
                    "options": ["rope-pushdown"],
                    "target": {"sets": 3, "repMin": 12, "repMax": 15},
                    "sets": [{"weight": weight, "reps": count} for count in reps_list],
                }],
            }

        page.evaluate(PUT_SCRIPT, ["sessions", record("gecmis-1", 14, 40, [12, 11, 10])])
        page.evaluate(PUT_SCRIPT, ["sessions", record("gecmis-2", 7, 40, [12, 11, 10])])
        page.reload()
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        expect(radio(rope, "Kablo · kg")).to_be_checked()
        expect(last_time(rope)).to_contain_text("40 kg × 12 · 11 · 10")
        expect(counter_line(rope)).to_have_text("İlk kayıttan beri 1 antrenman")
        expect(live_progress(rope)).to_be_hidden()

    def live_progress_and_reset(page):
        rope = card(page, "Rope Pushdown")
        log_sets(rope, "40", ["12", "12", "10"])
        expect(live_progress(rope)).to_have_text("Bu antrenmanda ilerledin ✓")
        page.screenshot(path=str(ARTIFACTS / "asama6-ilerleme.png"))
        reps(rope, 2).fill("11")
        expect(live_progress(rope)).to_be_hidden()
        reps(rope, 2).fill("12")
        expect(live_progress(rope)).to_have_text("Bu antrenmanda ilerledin ✓")
        finish(page)
        open_day(page, "push", "Push")
        expect(counter_line(card(page, "Rope Pushdown"))).to_have_text("Geçen antrenmanda ilerledin")

    def no_progress_increments(page):
        rope = card(page, "Rope Pushdown")
        log_sets(rope, "40", ["12", "12", "10"])
        expect(live_progress(rope)).to_be_hidden()
        finish(page)
        open_day(page, "push", "Push")
        expect(counter_line(card(page, "Rope Pushdown"))).to_have_text("Son ilerlemeden beri 1 antrenman")

    def other_machine_keeps_counter(page):
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo 3", "kg")
        log_sets(rope, "30", ["15"])
        expect(live_progress(rope)).to_have_text("İlk kayıt: başlangıç noktası")
        finish(page)
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        expect(radio(rope, "Kablo 3 · kg")).to_be_checked()
        expect(counter_line(rope)).to_have_count(0)
        radio(rope, "Kablo · kg").check()
        expect(counter_line(rope)).to_have_text("Son ilerlemeden beri 1 antrenman")
        page.screenshot(path=str(ARTIFACTS / "asama6-sayac.png"))
        go_home(page)

    return [
        ("Kaydı olmayan makine onayla tamamen siliniyor; 'Vazgeç' silmiyor", delete_unused_machine),
        ("Kaydı olan makine listeden kalkıyor, kayıtlar duruyor; aynı ad yeniden eklenebiliyor", delete_used_machine),
        ("Mevcut kayıtlardan sayaç: 'İlk kayıttan beri 1 antrenman'", counter_from_existing_records),
        ("Set girerken 'Bu antrenmanda ilerledin ✓'; sonra 'Geçen antrenmanda ilerledin'", live_progress_and_reset),
        ("İlerleme olmayan antrenmandan sonra 'Son ilerlemeden beri 1 antrenman'", no_progress_increments),
        ("Başka makine kullanılınca ilk makinenin sayacı değişmiyor", other_machine_keeps_counter),
    ]


# ---------------------------------------------------------------- Dönüşümlü hareket önerisi

def rotation_steps(run):
    state = {}

    def pull_card(page):
        return card(page, "Wrist Curl / Reverse Curl")

    def first_time(page):
        page.goto(run.base_url + "/")
        state["today"] = today(page)
        open_day(page, "pull", "Pull")
        wrist = pull_card(page)
        expect(radio(wrist, "Wrist Curl")).to_be_checked()
        expect(wrist.locator(".suggestion")).to_have_text("Henüz kayıt yok · Sıradaki: Wrist Curl")
        add_machine(wrist, "Dambıl", "kg")
        log_sets(wrist, "10", ["15", "15"])
        finish(page)
        expect(page.locator("#flash")).to_have_text("Pull antrenmanı kaydedildi ✓")

    def suggests_next(page):
        open_day(page, "pull", "Pull")
        wrist = pull_card(page)
        expect(radio(wrist, "Reverse Curl")).to_be_checked()
        expect(wrist.locator(".suggestion")).to_have_text(f"Son yapılan: Wrist Curl · {state['today']} · Sıradaki: Reverse Curl")
        wrist.screenshot(path=str(ARTIFACTS / "asama7-oneri.png"))
        lat = card(page, "Lat Pulldown (wide grip)")
        add_machine(lat, "Makine", "kg")
        log_sets(lat, "40", ["10"])  # Reverse Curl atlanıyor
        finish(page)

    def skip_keeps_suggestion(page):
        open_day(page, "pull", "Pull")
        wrist = pull_card(page)
        expect(radio(wrist, "Reverse Curl")).to_be_checked()
        expect(wrist.locator(".suggestion")).to_contain_text("Son yapılan: Wrist Curl")

    def manual_choice_counts(page):
        wrist = pull_card(page)
        radio(wrist, "Wrist Curl").check()
        expect(radio(wrist, "Dambıl · kg")).to_be_checked()
        log_sets(wrist, "10", ["15", "15"])
        finish(page)
        open_day(page, "pull", "Pull")
        expect(radio(pull_card(page), "Reverse Curl")).to_be_checked()

    def wraps_around(page):
        wrist = pull_card(page)
        add_machine(wrist, "Bar", "kg")
        log_sets(wrist, "20", ["12", "12"])
        finish(page)
        open_day(page, "pull", "Pull")
        wrist = pull_card(page)
        expect(radio(wrist, "Wrist Curl")).to_be_checked()
        expect(wrist.locator(".suggestion")).to_have_text(f"Son yapılan: Reverse Curl · {state['today']} · Sıradaki: Wrist Curl")
        go_home(page)

    def legs_group_independent(page):
        open_day(page, "legs", "Legs")
        chop = card(page, "Cable Chop / Reverse Cable Chop")
        expect(radio(chop, "Cable Chop")).to_be_checked()
        expect(chop.locator(".suggestion")).to_have_text("Henüz kayıt yok · Sıradaki: Cable Chop")
        go_home(page)

    return [
        ("İlk açılışta Wrist Curl öneriliyor: 'Henüz kayıt yok · Sıradaki: Wrist Curl'", first_time),
        ("Wrist Curl yapıldıktan sonra Reverse Curl öneriliyor ve seçili geliyor", suggests_next),
        ("Reverse Curl atlanınca öneri değişmiyor", skip_keeps_suggestion),
        ("Öneri elle değiştirilip Wrist Curl yapılınca sonraki öneri yine Reverse Curl", manual_choice_counts),
        ("Reverse Curl yapılınca liste başa dönüyor: Wrist Curl", wraps_around),
        ("Legs'teki Cable Chop grubu Pull'dan bağımsız", legs_group_independent),
    ]


# ---------------------------------------------------------------- İnternetsiz çalışma ve güncelleme

WAIT_FOR_CONTROLLER = "navigator.serviceWorker.controller !== null"


def offline_steps(run):
    def installs_and_opens_offline(page):
        page.goto(run.base_url + "/?sw=1")
        page.wait_for_function(WAIT_FOR_CONTROLLER)
        manifest = page.evaluate("fetch('manifest.webmanifest').then((response) => response.json())")
        assert (manifest["name"], manifest["display"], manifest["start_url"]) == ("Antrenman Takibi", "standalone", "./"), manifest
        page.context.set_offline(True)
        page.reload()
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")
        expect(page.locator(".day-name")).to_have_count(5)

    def logs_offline(page):
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        expect(save_status(page)).to_have_text("Makine eklendi ✓")
        log_sets(rope, "50", ["12", "11"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")

    def reopens_offline_with_values(page):
        page.goto(run.base_url + "/?sw=1")  # internet yokken uygulama kapatılıp açılmış gibi
        expect(page.locator("#resume-title")).to_have_text("Push")
        page.get_by_role("link", name="Devam et").click()
        rope = card(page, "Rope Pushdown")
        expect(weight_input(rope)).to_have_value("50")
        expect(reps(rope, 2)).to_have_value("11")
        finish(page)
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")
        expect(page.locator("#update-banner")).to_be_hidden()
        page.context.set_offline(False)

    return [
        ("?sw=1 ile uygulama kuruluyor ve internetsiz açılıyor", installs_and_opens_offline),
        ("İnternet yokken makine ekleniyor ve setler kaydediliyor", logs_offline),
        ("İnternet yokken kapatılıp açılınca değerler duruyor; antrenman bitiriliyor", reopens_offline_with_values),
    ]


def update_steps(base_url, app_copy):
    def bump_version(version):
        sw = app_copy / "sw.js"
        text = sw.read_text(encoding="utf-8")
        sw.write_text(re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", text), encoding="utf-8")

    def check_for_update(page):
        page.evaluate("navigator.serviceWorker.getRegistration().then((registration) => registration.update())")

    def cache_names(page):
        return page.evaluate("caches.keys()")

    def new_version_offered(page):
        page.goto(base_url + "/?sw=1")
        page.wait_for_function(WAIT_FOR_CONTROLLER)
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        log_sets(rope, "50", [])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        expect(page.locator("#update-banner")).to_be_hidden()
        bump_version("test-2")
        check_for_update(page)
        expect(page.locator("#update-banner")).to_be_visible()
        expect(page.locator("#update-text")).to_have_text("Yeni sürüm var.")
        page.screenshot(path=str(ARTIFACTS / "asama5-yeni-surum.png"))

    def update_waits_for_pending_write(page):
        reps(card(page, "Rope Pushdown"), 1).fill("12")  # 0,5 sn dolmadan "Güncelle"
        with page.expect_navigation():
            page.get_by_role("button", name="Güncelle").click()
        expect(page.locator(".topbar h1")).to_have_text("Push")
        expect(reps(card(page, "Rope Pushdown"), 1)).to_have_value("12")
        expect(page.locator("#update-banner")).to_be_hidden()
        names = cache_names(page)
        assert "antrenman-test-2" in names and "antrenman-1" not in names, names

    def update_refused_on_write_error(page):
        rope = card(page, "Rope Pushdown")
        page.evaluate("window.__failWrites = true")
        reps(rope, 2).fill("11")
        expect(save_status(page)).to_contain_text("Kaydedilemedi.")
        bump_version("test-3")
        check_for_update(page)
        expect(page.locator("#update-banner")).to_be_visible()
        page.get_by_role("button", name="Güncelle").click()
        expect(page.locator("#update-text")).to_have_text("Son değişiklikler kaydedilemediği için güncellenmedi. Önce kaydı tamamlayın.")
        assert "antrenman-test-3" not in cache_names(page) or page.evaluate(
            "navigator.serviceWorker.getRegistration().then((registration) => registration.waiting !== null)"
        ), "Yeni sürüm devreye girmemeliydi"
        page.evaluate("window.__failWrites = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        with page.expect_navigation():
            page.get_by_role("button", name="Güncelle").click()
        expect(reps(card(page, "Rope Pushdown"), 2)).to_have_value("11")
        assert "antrenman-test-3" in cache_names(page)

    return [
        ("Yeni sürüm yayınlanınca 'Yeni sürüm var: Güncelle' bandı çıkıyor", new_version_offered),
        ("'Güncelle' bekleyen kaydı önce bitiriyor, sonra yeni sürüme geçiyor", update_waits_for_pending_write),
        ("Kayıt hatası varken güncellenmiyor; kayıt tamamlanınca güncelleniyor", update_refused_on_write_error),
    ]


def copy_app(target):
    for name in ("index.html", "manifest.webmanifest", "sw.js"):
        shutil.copy2(ROOT / name, target / name)
    for folder in ("css", "js", "icons"):
        shutil.copytree(ROOT / folder, target / folder)


# ---------------------------------------------------------------- Günler, makineler, dönüşümlü satır

def day_separation_steps(run):
    state = {}

    def legs(page):
        page.goto(run.base_url + "/")
        state["today"] = today(page)
        open_day(page, "legs", "Legs")
        calf = card(page, "Standing Calf Raise")
        add_machine(calf, "Makine", "kg")
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
        add_machine(alternating, "Bar", "kg")
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
        add_machine(card(page, "Rope Pushdown"), "Kablo", "kg")
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
        page.goto(run.base_url + "/tests/blank.html")  # aynı adreste boş bir sayfa: veritabanı elle kurulur
        page.evaluate(PHASE1_DATABASE_SCRIPT, phase1)
        page.goto(run.base_url + "/")
        expect(page.locator(".day-name")).to_have_count(5)
        expect(page.locator("#next-title")).to_have_text("Pull")
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        assert machine_names(rope) == ["Kablo 2 · kademe"], machine_names(rope)
        expect(radio(rope, "Kablo 2 · kademe")).to_be_checked()
        expect(last_time(rope)).to_have_text("Geçen sefer — 22 Eyl: 10k × 12")
        saved = stored_program(page)
        assert saved["seedVersion"] == 3, "Yükseltilen program kaydedilmeliydi"
        assert [equipment["id"] for equipment in saved["exercises"]["rope-pushdown"]["equipment"]] == ["eq-eski"], saved

    return [
        ("Aşama 1 programı yükseltiliyor: 5 gün geliyor; eklenen makine ve kaydı duruyor, varsayılan makine gidiyor", upgraded),
    ]


# ---------------------------------------------------------------- Aşama 2'den yükseltme

def phase2_upgrade_steps(run):
    def entry(equipment_id, name):
        return {
            "exerciseId": "machine-chest-press",
            "equipmentId": equipment_id,
            "name": "Machine Chest Press",
            "equipmentName": name,
            "unit": "kg",
            "options": ["machine-chest-press"],
            "target": {"sets": 3, "repMin": 10, "repMax": 12},
            "sets": [{"weight": 40, "reps": 12}],
        }

    phase2 = {
        "program": {
            "key": "program",
            "seedVersion": 2,
            "exercises": {
                "machine-chest-press": {
                    "name": "Machine Chest Press",
                    "equipment": [{"id": "machine-chest-press-makine", "name": "Makine", "unit": "kg"}],
                },
                "cable-fly": {
                    "name": "Cable Fly",
                    "equipment": [
                        {"id": "cable-fly-kablo", "name": "Kablo", "unit": "kg"},
                        {"id": "eq-kablo-3", "name": "Kablo 3", "unit": "kg"},
                    ],
                },
            },
            "days": [],
        },
        "sessions": [{
            "id": "aşama-2-kaydi",
            "dayId": "push",
            "dayName": "Push",
            "startedAt": "2026-09-22T12:00:00.000Z",
            "finishedAt": "2026-09-22T12:00:00.000Z",
            "entries": [entry("machine-chest-press-makine", "Makine")],
        }],
    }

    def upgraded(page):
        page.goto(run.base_url + "/tests/blank.html")
        page.evaluate(PHASE1_DATABASE_SCRIPT, phase2)
        page.goto(run.base_url + "/")
        open_day(page, "push", "Push")
        chest = card(page, "Machine Chest Press")
        expect(chest.locator(".no-machine")).to_have_count(1)
        assert machine_names(card(page, "Cable Fly")) == ["Kablo 3 · kg"], machine_names(card(page, "Cable Fly"))
        add_machine(chest, "Makine", "kg")
        expect(radio(chest, "Makine · kg")).to_be_checked()
        expect(last_time(chest)).to_have_text("Bu makinede önceki kayıt yok")
        saved = stored_program(page)["exercises"]["machine-chest-press"]["equipment"]
        assert saved[0] == {"id": "machine-chest-press-makine", "name": "Makine", "unit": "kg", "archived": True}, saved
        assert len(sessions(page)) == 1, "Eski kayıt silinmemeli"

    return [
        ("Aşama 2 programı yükseltiliyor: varsayılan makineler listeden kalkıyor, kaydı olan arşivleniyor", upgraded),
    ]


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    server = make_server(port=0, quiet=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"
    # Güncelleme testi için uygulamanın geçici bir kopyası ayrı bir sunucuda: sw.js orada değiştirilir.
    app_copy = Path(tempfile.mkdtemp(prefix="antrenman-kopya-"))
    copy_app(app_copy)
    copy_server = make_server(port=0, quiet=True, directory=app_copy)
    threading.Thread(target=copy_server.serve_forever, daemon=True).start()
    copy_url = f"http://127.0.0.1:{copy_server.server_address[1]}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome")
            run = Runner(browser, base_url)
            run.flow("Altyapı", infrastructure_steps(run))
            run.flow("Ana ekran ve program", program_steps(run))
            run.flow("Push antrenmanı", push_workout_steps(run), init_script=FAIL_WRITES_SCRIPT)
            run.flow("Otomatik kaydetme ve devam eden antrenman", autosave_steps(run), init_script=FAIL_WRITES_SCRIPT)
            run.flow("Yedekleme", backup_steps(run), init_script=FAIL_WRITES_SCRIPT)
            run.flow("Makine silme ve ilerleme sayacı", machines_and_counter_steps(run))
            run.flow("Dönüşümlü hareket önerisi", rotation_steps(run))
            run.flow("İnternetsiz çalışma", offline_steps(run))
            run.flow("Yeni sürüm ve güncelleme", update_steps(copy_url, app_copy), init_script=FAIL_WRITES_SCRIPT)
            run.flow("Günler ayrı, makineler harekete ait", day_separation_steps(run))
            run.flow("Hedef kopyası", target_copy_steps(run))
            run.flow("Aşama 1 verisinden yükseltme", upgrade_steps(run))
            run.flow("Aşama 2 verisinden yükseltme", phase2_upgrade_steps(run))
            browser.close()
    finally:
        for running in (server, copy_server):
            running.shutdown()
            running.server_close()
        shutil.rmtree(app_copy, ignore_errors=True)

    total = run.passed + len(run.failed) + run.skipped
    print(f"\n{run.passed}/{total} adım geçti", end="")
    print(f", {len(run.failed)} başarısız, {run.skipped} atlandı." if run.failed or run.skipped else ".")
    return 1 if run.failed else 0


if __name__ == "__main__":
    sys.exit(main())
