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

# window.__failWritesLater true iken IndexedDB yazması (put ya da delete) yapılır, sonra işlem geri alınır:
# hata, gerçek yazma hatalarındaki gibi işlem çalışınca (gecikmeli) gelir. Geri alınabilsin diye o sırada
# işlem erkenden tamamlanmaz (commit atlanır).
FAIL_WRITES_LATER_SCRIPT = """
(() => {
  for (const method of ['put', 'delete']) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (...args) {
      const request = original.apply(this, args);
      if (window.__failWritesLater) request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
  }
  const commit = IDBTransaction.prototype.commit;
  if (commit) {
    IDBTransaction.prototype.commit = function () {
      if (!window.__failWritesLater) return commit.call(this);
    };
  }
})();
"""

# Veritabanını başka bir bağlantıdaki yazma işlemiyle tutar: uygulamanın yazmaları window.__releaseWrites()
# çağrılana kadar başlamaz (yazma sürerken yapılanları sınamak için). Tutarken veritabanı okunamaz.
HOLD_WRITES_SCRIPT = """
() => new Promise((resolve, reject) => {
  const request = indexedDB.open('antrenman-takibi');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const transaction = db.transaction(['meta', 'sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    let held = true;
    window.__releaseWrites = () => { held = false; };
    const keepAlive = () => { if (held) store.count().onsuccess = keepAlive; };
    store.count().onsuccess = () => { resolve(); keepAlive(); };
    transaction.oncomplete = () => db.close();
  };
})
"""

# Bağlantı denemeleri: window.__closeConnections() uygulamanın açık IndexedDB bağlantılarını kapatır
# (tarayıcının bağlantıyı kapatmasını taklit eder; veritabanının sürümü değişmez). __failOpen true iken
# veritabanı açılamaz; __openCount açma denemelerini sayar. __failWritesWith = 'QuotaExceededError' gibi
# bir ad verilince yazma o hatayı verir.
CONNECTION_SCRIPT = """
(() => {
  const connections = [];
  window.__openCount = 0;
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...args) {
    window.__openCount++;
    if (window.__failOpen) throw new DOMException('Test: veritabanı açılamadı', 'UnknownError');
    const request = open.apply(this, args);
    request.addEventListener('success', () => connections.push(request.result));
    return request;
  };
  window.__closeConnections = () => { for (const db of connections) db.close(); };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (window.__failWritesWith) throw new DOMException('Test: yazma hatası', window.__failWritesWith);
    return put.apply(this, args);
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

    def flow(self, title, steps, init_script=None, **context_options):
        print(f"\n{title}")
        context = self.browser.new_context(viewport=PHONE, locale="tr-TR", color_scheme="light", **context_options)
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
    page.get_by_role("link", name="Ana Sayfa").click()
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
        page.screenshot(path=str(ARTIFACTS / "asama2-ana-ekran.png"), full_page=True)

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
            "Hedef 3 × 12",
            "Hedef 3 × 15",
            "Hedef 4 × 15",
            "Hedef 3 × 12",
            "Hedef 3 × 15",
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
        expect(overhead.locator(".target")).to_have_text("Hedef 3 × 15")
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
        ("Upper: Overhead Rope Extension 3 × 15 (Push'ta 2 × 15)", upper_cards),
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
        page.get_by_role("link", name="Ana Sayfa").click()
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
        page.screenshot(path=str(ARTIFACTS / "asama2-antrenman.png"), full_page=True)

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
        ("Antrenman ekranının görüntüleri", screenshots),
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

    def hidden_retries_failed_write(page):
        rope = card(page, "Rope Pushdown")
        page.evaluate("window.__failWrites = true")
        reps(rope, 3).fill("9")
        expect(save_status(page)).to_contain_text("Kaydedilemedi.")
        page.evaluate("window.__failWrites = false")
        # Uygulama arka plana geçiyor (ekran kilitlendi): son yazma hatalıysa yeniden denenir.
        page.evaluate("""() => {
          Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
          delete document.visibilityState;
        }""")
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        draft = next(card for card in unfinished(page)[0]["draft"]["cards"] if card["exerciseId"] == "rope-pushdown")
        assert draft["reps"] == ["12", "11", "9"], draft

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
        page.get_by_role("link", name="Ana Sayfa").click()  # 0,5 sn beklemeden çıkılıyor
        expect(page.locator("#resume-title")).to_have_text("Pull")
        page.get_by_role("link", name="Devam et").click()
        lat = card(page, "Lat Pulldown (wide grip)")
        expect(weight_input(lat)).to_have_value("40")
        expect(reps(lat, 1)).to_have_value("10")
        go_home(page)

    def leaving_with_write_error(page):
        page.get_by_role("link", name="Devam et").click()
        lat = card(page, "Lat Pulldown (wide grip)")
        expect(reps(lat, 1)).to_have_value("10")
        page.evaluate("window.__failWrites = true")
        reps(lat, 2).fill("9")
        # Telefonun geri hareketi: kutudan çıkılmadan, 0,5 sn beklemeden; yazmayı çıkış başlatır.
        with page.expect_event("dialog", timeout=5000) as leaving:
            page.go_back()
        assert leaving.value.message == "Son değişiklikler kaydedilemedi ve kaybolabilir. Yine de çıkmak istiyor musunuz?", leaving.value.message
        leaving.value.dismiss()
        expect(page).to_have_url(re.compile(r"#/antrenman/pull$"))
        expect(save_status(page)).to_contain_text("Kaydedilemedi.")
        expect(reps(lat, 2)).to_have_value("9")
        draft = next(card for card in unfinished(page)[0]["draft"]["cards"] if card["exerciseId"] == "lat-pulldown-wide-grip")
        assert draft["reps"] == ["10", "", ""], draft
        page.evaluate("window.__failWrites = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        draft = next(card for card in unfinished(page)[0]["draft"]["cards"] if card["exerciseId"] == "lat-pulldown-wide-grip")
        assert draft["reps"] == ["10", "9", ""], draft
        go_home(page)
        page.get_by_role("link", name="Devam et").click()
        expect(reps(card(page, "Lat Pulldown (wide grip)"), 2)).to_have_value("9")
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
        page.evaluate("""() => {
          window.__persistRequests = 0;
          navigator.storage.persisted = async () => false;
          navigator.storage.persist = async () => { window.__persistRequests++; return false; };
        }""")
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
        assert page.evaluate("window.__persistRequests") == 1, "Bitirince kalıcı depolama istenmeliydi"

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
        ("Son yazma hatalıyken uygulama arka plana geçince yeniden deneniyor", hidden_retries_failed_write),
        ("Hata varken 'Bitir' antrenmanı bitirmiyor; 'Tekrar dene' bitiriyor", finish_blocked_by_error),
        ("Beklemeden ekrandan çıkınca da son değer kaydediliyor", leaving_flushes),
        ("Çıkarken başlatılan yazma başarısız: ekran kapanmıyor, soruluyor; değer duruyor, 'Tekrar dene' kaydediyor",
         leaving_with_write_error),
        ("Başka gün açılınca soruluyor: 'Devam et' ve onaylı 'Sil'", conflict_continue_and_delete),
        ("'Bitir ve … başla': önceki antrenman bitiyor, kalıcı depolama isteniyor, yeni gün açılıyor", conflict_finish),
        ("Hatalı değerli antrenman oradan bitirilemiyor", conflict_finish_with_problems),
        ("'Antrenmanı iptal et' onay alıp siliyor", cancel_workout),
    ]


# ---------------------------------------------------------------- Bitir ve İptal sürerken ekrandan çıkış

LEAVE_ANYWAY = "Son değişiklikler kaydedilemedi ve kaybolabilir. Yine de çıkmak istiyor musunuz?"


def hold_writes(page):
    page.evaluate(HOLD_WRITES_SCRIPT)


def release_writes(page):
    page.evaluate("window.__releaseWrites()")


def leave_while_writing(page, day_name):
    # "← Ana Sayfa": adres değişiyor, ama yazma bitene kadar antrenman ekranı açık kalıyor.
    page.get_by_role("link", name="Ana Sayfa").click()
    expect(page).not_to_have_url(re.compile(r"#/antrenman/"))
    page.wait_for_timeout(300)
    expect(page.locator(".topbar h1")).to_have_text(day_name)


def ending_while_leaving_steps(run):
    def finish_while_leaving(page):
        page.goto(run.base_url + "/")
        open_day(page, "pull", "Pull")
        lat = card(page, "Lat Pulldown (wide grip)")
        add_machine(lat, "Makine", "kg")
        log_sets(lat, "40", ["10", "9"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        hold_writes(page)
        reps(lat, 3).fill("8")  # 0,5 sn dolmadan "Bitir"
        finish(page)
        expect(page.get_by_role("button", name="Bitir")).to_be_disabled()
        leave_while_writing(page, "Pull")
        release_writes(page)
        expect(page.locator("#flash")).to_have_text("Pull antrenmanı kaydedildi ✓")
        expect(page.locator("#resume-title")).to_have_count(0)
        [session] = sessions(page)
        assert session["finishedAt"] and "draft" not in session, session
        assert session["entries"][0]["sets"] == [
            {"weight": 40, "reps": 10}, {"weight": 40, "reps": 9}, {"weight": 40, "reps": 8}], session["entries"]

    def finish_fails_while_leaving(page):
        open_day(page, "legs", "Legs")
        press = card(page, "Leg Press")
        add_machine(press, "Makine", "kg")
        log_sets(press, "100", ["12"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        hold_writes(page)
        page.evaluate("window.__failWritesLater = true")
        reps(press, 2).fill("11")  # 0,5 sn dolmadan "Bitir"
        finish(page)
        expect(page.get_by_role("button", name="Bitir")).to_be_disabled()
        with page.expect_event("dialog") as leaving:
            leave_while_writing(page, "Legs")
            release_writes(page)
        assert leaving.value.message == LEAVE_ANYWAY, leaving.value.message
        leaving.value.dismiss()
        expect(page).to_have_url(re.compile(r"#/antrenman/legs$"))
        expect(save_status(page)).to_contain_text("Antrenman bitirilemedi.")
        expect(weight_input(press)).to_have_value("100")
        expect(reps(press, 2)).to_have_value("11")
        [session] = unfinished(page)
        assert session["dayId"] == "legs", session
        page.evaluate("window.__failWritesLater = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(page.locator("#flash")).to_have_text("Legs antrenmanı kaydedildi ✓")
        [legs] = [session for session in sessions(page) if session["dayId"] == "legs"]
        assert legs["finishedAt"] and legs["entries"][0]["sets"] == [
            {"weight": 100, "reps": 12}, {"weight": 100, "reps": 11}], legs["entries"]

    def cancel_while_leaving(page):
        open_day(page, "upper", "Upper")
        incline = card(page, "Incline Dumbbell Press")
        add_machine(incline, "Dambıl", "kg")
        log_sets(incline, "20", ["10"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        hold_writes(page)
        page.once("dialog", lambda dialog: dialog.accept())  # "Bu antrenman silinecek…"
        page.get_by_role("button", name="Antrenmanı iptal et").click()
        expect(page.get_by_role("button", name="Bitir")).to_be_disabled()
        leave_while_writing(page, "Upper")
        release_writes(page)
        expect(page.locator("#flash")).to_have_text("Antrenman iptal edildi.")
        expect(page.locator("#resume-title")).to_have_count(0)
        assert unfinished(page) == [], "İptal edilen antrenman silinmeliydi"

    def cancel_fails_while_leaving(page):
        open_day(page, "upper", "Upper")
        incline = card(page, "Incline Dumbbell Press")
        log_sets(incline, "22", ["10"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        hold_writes(page)
        page.evaluate("window.__failWritesLater = true")
        page.once("dialog", lambda dialog: dialog.accept())  # "Bu antrenman silinecek…"
        page.get_by_role("button", name="Antrenmanı iptal et").click()
        expect(page.get_by_role("button", name="Bitir")).to_be_disabled()
        with page.expect_event("dialog") as leaving:
            leave_while_writing(page, "Upper")
            release_writes(page)
        assert leaving.value.message == LEAVE_ANYWAY, leaving.value.message
        leaving.value.dismiss()
        expect(page).to_have_url(re.compile(r"#/antrenman/upper$"))
        expect(save_status(page)).to_contain_text("Antrenman silinemedi.")
        expect(weight_input(incline)).to_have_value("22")
        [session] = unfinished(page)
        draft = next(card for card in session["draft"]["cards"] if card["exerciseId"] == "incline-dumbbell-press")
        assert (draft["weight"], draft["reps"]) == ("22", ["10", "", ""]), draft
        page.evaluate("window.__failWritesLater = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(page.locator("#flash")).to_have_text("Antrenman iptal edildi.")
        assert unfinished(page) == [], "İptal edilen antrenman silinmeliydi"

    def type_then_clear_while_first_write_waits(page):
        # İlk değer yazılıyor; 0,5 sn dolunca istenen ilk yazma bekletiliyor ve bu sırada değer siliniyor.
        open_day(page, "lower", "Lower")
        first = page.locator("[data-card]").first
        if first.locator("input[data-field='weight']").count() == 0:
            add_machine(first, "Makine", "kg")
            expect(save_status(page)).to_have_text("Makine eklendi ✓")
        hold_writes(page)
        weight_input(first).fill("30")
        page.wait_for_timeout(800)
        weight_input(first).fill("")
        return first

    def cancel_while_first_write_waits(page):
        type_then_clear_while_first_write_waits(page)
        dialogs = []
        page.once("dialog", lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
        page.get_by_role("button", name="Antrenmanı iptal et").click()
        release_writes(page)
        expect(page.locator("#flash")).to_have_text("Antrenman iptal edildi.")
        assert dialogs == ["Bu antrenman silinecek; girdiğiniz değerler geri gelmez. Emin misiniz?"], dialogs
        expect(page.locator("#resume-title")).to_have_count(0)
        assert unfinished(page) == [], "İptal edilen antrenman kalmamalı"

    def leave_while_first_write_waits(page):
        type_then_clear_while_first_write_waits(page)
        page.get_by_role("link", name="Ana Sayfa").click()
        page.wait_for_timeout(300)
        release_writes(page)
        expect(page.locator("#resume-title")).to_have_text("Lower")
        [session] = unfinished(page)
        assert all(card["weight"] == "" for card in session["draft"]["cards"]), "Silinen değer taslakta kalmamalı"
        page.get_by_role("link", name="Devam et").click()
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Antrenmanı iptal et").click()
        expect(page.locator("#flash")).to_have_text("Antrenman iptal edildi.")

    return [
        ("'Bitir' yazması sürerken çıkış: ekran yazma bitene kadar açık; antrenman son değeriyle bitiyor",
         finish_while_leaving),
        ("'Bitir' sürerken çıkış ve gecikmeli hata: soruluyor, ekran kalıyor; değerler duruyor, 'Tekrar dene' bitiriyor",
         finish_fails_while_leaving),
        ("İptal yazması sürerken çıkış: ekran yazma bitene kadar açık; antrenman siliniyor", cancel_while_leaving),
        ("İptal sürerken çıkış ve gecikmeli hata: soruluyor, ekran kalıyor; antrenman duruyor, 'Tekrar dene' siliyor",
         cancel_fails_while_leaving),
        ("İlk yazma sürerken değer silinip İptal: onay soruluyor, antrenman siliniyor", cancel_while_first_write_waits),
        ("İlk yazma sürerken değer silinip çıkış: taslakta silinen değer kalmıyor", leave_while_first_write_waits),
    ]


# ---------------------------------------------------------------- IndexedDB bağlantısı kapanınca

def open_count(page):
    return page.evaluate("window.__openCount")


def connection_steps(run):
    def rope_reps(page):
        [session] = unfinished(page)
        return next(card for card in session["draft"]["cards"] if card["exerciseId"] == "rope-pushdown")["reps"]

    def workout_in_progress(page):
        page.goto(run.base_url + "/")
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        log_sets(rope, "50", ["12"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")

    def reopens_closed_connection(page):
        page.evaluate("window.__closeConnections()")
        opens = open_count(page)
        reps(card(page, "Rope Pushdown"), 2).fill("11")
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        assert open_count(page) == opens + 1, f"Bağlantı bir kez yeniden açılmalıydı: {open_count(page) - opens}"
        assert rope_reps(page)[1] == "11", rope_reps(page)
        # Okumalar da: ekranlar açılıyor, yedek alınıyor.
        page.evaluate("window.__closeConnections()")
        go_home(page)
        expect(page.locator("#resume-title")).to_have_text("Push")
        page.evaluate("window.__closeConnections()")
        page.get_by_role("link", name="Ayarlar").click()
        with page.expect_download():
            page.get_by_role("button", name="Yedeği indir").click()
        expect(page.locator("#backup-message")).to_contain_text("İndirme başlatıldı")
        page.get_by_role("link", name="Ana Sayfa").click()
        page.get_by_role("link", name="Devam et").click()
        expect(reps(card(page, "Rope Pushdown"), 2)).to_have_value("11")

    def unrecoverable_keeps_values(page):
        rope = card(page, "Rope Pushdown")
        page.evaluate("window.__closeConnections(); window.__failOpen = true")
        opens = open_count(page)
        reps(rope, 3).fill("10")
        expect(save_status(page)).to_contain_text("Kaydedilemedi. Tarayıcı veritabanına bağlanılamadı.")
        expect(reps(rope, 3)).to_have_value("10")
        page.wait_for_timeout(1000)
        assert open_count(page) - opens == 1, f"Yeniden açma bir kez denenmeli: {open_count(page) - opens}"
        page.evaluate("window.__failOpen = false")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        assert rope_reps(page)[2] == "10", rope_reps(page)

    def other_errors_do_not_reopen(page):
        rope = card(page, "Rope Pushdown")
        opens = open_count(page)
        page.evaluate("window.__failWritesWith = 'QuotaExceededError'")
        reps(rope, 1).fill("13")
        expect(save_status(page)).to_contain_text("Kaydedilemedi. Depolama alanı dolu.")
        page.evaluate("window.__failWritesWith = 'DataCloneError'")
        reps(rope, 1).fill("14")
        expect(save_status(page)).to_contain_text("Kaydedilemedi. Tarayıcı veriyi yazamadı.")
        assert open_count(page) == opens, "Kota ya da geçersiz veri hatasında bağlantı yeniden açılmamalı"
        page.evaluate("window.__failWritesWith = null")
        page.get_by_role("button", name="Tekrar dene").click()
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        assert rope_reps(page)[0] == "14", rope_reps(page)

    return [
        ("Veri: devam eden Push antrenmanı", workout_in_progress),
        ("Bağlantı kapanınca bir kez yeniden açılıyor: kayıt, ekranlar ve yedek çalışıyor", reopens_closed_connection),
        ("Bağlantı açılamazsa: değer ekranda, anlaşılır hata, tek deneme; açılınca 'Tekrar dene' kaydediyor",
         unrecoverable_keeps_values),
        ("Kota ve geçersiz veri hatası bağlantıyı yeniden açmıyor; kendi mesajıyla görünüyor", other_errors_do_not_reopen),
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

    def backup_date_not_saved(page):
        # Dosya indirildi ama son yedek tarihi yazılamadı: ekranda yeni tarih görünmemeli.
        page.get_by_role("link", name="Ayarlar").click()
        expect(page.locator("#last-backup")).to_have_text("Son yedek: henüz yedek alınmadı")
        page.evaluate("window.__failWrites = true")
        with page.expect_download() as info:
            page.get_by_role("button", name="Yedeği indir").click()
        expect(page.locator("#backup-message")).to_have_text(
            f"İndirme başlatıldı: {info.value.suggested_filename} (2 antrenman). Dosyanın kaydedildiğini denetleyin. "
            "Son yedek tarihi kaydedilemedi. Tarayıcı veriyi yazamadı.")
        expect(page.locator("#last-backup")).to_have_text("Son yedek: henüz yedek alınmadı")
        page.evaluate("window.__failWrites = false")

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
        expect(page.locator("#backup-message")).to_have_text(
            f"İndirme başlatıldı: {download.suggested_filename} (2 antrenman). Dosyanın kaydedildiğini denetleyin.")
        expect(page.locator("#last-backup")).to_contain_text(f"Son yedek: {state['today']}")
        state["exported"] = snapshot(page)
        page.screenshot(path=str(ARTIFACTS / "asama4-ayarlar.png"), full_page=True)

    def share_messages(page):
        # "Paylaş…": başarılıysa tarih güncellenir; başarısızsa paylaşım hatası söylenir, tarih değişmez.
        page.evaluate("""() => {
          navigator.canShare = () => true;
          navigator.share = () => (window.__shareFails
            ? Promise.reject(new DOMException('Test: paylaşılamadı', 'NotAllowedError'))
            : Promise.resolve());
        }""")
        page.get_by_role("link", name="Ana Sayfa").click()
        page.get_by_role("link", name="Ayarlar").click()
        page.get_by_role("button", name="Paylaş…").click()
        expect(page.locator("#backup-message")).to_contain_text("Yedek paylaşıldı: antrenman-yedegi-")
        expect(page.locator("#backup-message")).to_contain_text("Dosyanın seçtiğiniz yere kaydedildiğini denetleyin.")
        shared_at = page.evaluate(READ_SCRIPT, ["meta", "settings"])["lastBackupAt"]
        page.evaluate("window.__shareFails = true")
        page.get_by_role("button", name="Paylaş…").click()
        expect(page.locator("#backup-message")).to_have_text("Yedek paylaşılamadı. \"Yedeği indir\" ile deneyin.")
        assert page.evaluate(READ_SCRIPT, ["meta", "settings"])["lastBackupAt"] == shared_at, "Tarih değişmemeli"

    def change_data(page):
        page.get_by_role("link", name="Ana Sayfa").click()
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

    def unreadable_file_rejected(page):
        page.evaluate("""() => {
          window.__originalText = Blob.prototype.text;
          Blob.prototype.text = () => Promise.reject(new DOMException('Test: dosya okunamadı', 'NotReadableError'));
        }""")
        page.locator("#restore-file").set_input_files(state["backup_path"])
        expect(page.locator("#restore-message")).to_have_text("Dosya okunamadı. Hiçbir şey değiştirilmedi.")
        page.evaluate("() => { Blob.prototype.text = window.__originalText; }")
        expect(page.locator("#restore-summary")).to_have_count(0)
        assert snapshot(page) == state["changed"], "Okunamayan dosya hiçbir şeyi değiştirmemeli"

    def broken_contents_rejected(page):
        backup = json.loads(state["backup_path"].read_text(encoding="utf-8"))
        index, active = next((i, s) for i, s in enumerate(backup["sessions"], start=1) if not s["finishedAt"])
        active["draft"]["cards"][0]["exerciseId"] = "olmayan-hareket"
        page.locator("#restore-file").set_input_files(
            {"name": "bozuk-taslak.json", "mimeType": "application/json", "buffer": json.dumps(backup).encode("utf-8")})
        expect(page.locator("#restore-message")).to_have_text(
            f"Yedek dosyası bozuk: {index}. antrenmanın taslağı programla uyuşmuyor. Hiçbir şey değiştirilmedi.")
        expect(page.locator("#restore-summary")).to_have_count(0)
        assert snapshot(page) == state["changed"], "Bozuk yedek hiçbir şeyi değiştirmemeli"

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
        page.get_by_role("link", name="Ana Sayfa").click()
        expect(page.locator("#resume-title")).to_have_text("Pull")
        page.get_by_role("link", name="Devam et").click()
        lat = card(page, "Lat Pulldown (wide grip)")
        expect(weight_input(lat)).to_have_value("40")
        go_home(page)
        assert stored_program(page)["exercises"]["cable-fly"]["equipment"] == [], "Yedekten sonra eklenen makine gitmeli"

    def program_key_stays(page):
        page.get_by_role("link", name="Ayarlar").click()
        settings = page.evaluate(READ_SCRIPT, ["meta", "settings"])
        backup = json.loads(state["backup_path"].read_text(encoding="utf-8"))
        backup["program"]["key"] = "settings"
        page.locator("#restore-file").set_input_files(
            {"name": "anahtarli.json", "mimeType": "application/json", "buffer": json.dumps(backup).encode("utf-8")})
        page.get_by_role("button", name="Geri yükle").click()
        expect(page.locator("#restore-message")).to_have_text("Yedek geri yüklendi: 2 antrenman.")
        assert page.evaluate(READ_SCRIPT, ["meta", "settings"]) == settings, "Ayarlar yerinde kalmalı"
        assert snapshot(page) == state["exported"], "Program kendi anahtarına, yedektekiyle aynı yazılmalı"
        page.get_by_role("link", name="Ana Sayfa").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")

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
        ("Son yedek tarihi yazılamazsa ekranda yeni tarih görünmüyor; mesaj bunu söylüyor", backup_date_not_saved),
        ("Yedek indiriliyor: dosya adı, içerik (devam eden dahil) ve son yedek tarihi", download_backup),
        ("'Paylaş…': başarılıysa tarih güncelleniyor, başarısızsa paylaşım hatası söyleniyor", share_messages),
        ("Yedekten sonra veriler değiştiriliyor", change_data),
        ("Bozuk ve yabancı dosya reddediliyor; hiçbir şey değişmiyor", broken_files_rejected),
        ("Okunamayan dosya: mesaj çıkıyor; hiçbir şey değişmiyor", unreadable_file_rejected),
        ("Taslağı programla uyuşmayan yedek reddediliyor; hiçbir şey değişmiyor", broken_contents_rejected),
        ("Geri yükleme özeti gösteriliyor; 'Vazgeç' hiçbir şeyi değiştirmiyor", summary_and_cancel),
        ("Geri yükleme yarıda hata verirse eski veriler olduğu gibi kalıyor", failed_restore_changes_nothing),
        ("Geri yükleyince veri yedekle birebir aynı geliyor", restore_brings_back_same_data),
        ("Yedekteki program.key programı başka anahtara taşıyamıyor; ayarlar yerinde kalıyor", program_key_stays),
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
        expect(counter_line(rope)).to_have_text("Henüz ilerleme yok")
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
        expect(counter_line(card(page, "Rope Pushdown"))).to_have_text("Son ilerleme 2 antrenman önce")

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
        expect(counter_line(rope)).to_have_text("Son ilerleme 2 antrenman önce")
        page.screenshot(path=str(ARTIFACTS / "asama6-sayac.png"))
        go_home(page)

    return [
        ("Kaydı olmayan makine onayla tamamen siliniyor; 'Vazgeç' silmiyor", delete_unused_machine),
        ("Kaydı olan makine listeden kalkıyor, kayıtlar duruyor; aynı ad yeniden eklenebiliyor", delete_used_machine),
        ("Mevcut kayıtlardan sayaç: ilerleme yokken 'Henüz ilerleme yok'", counter_from_existing_records),
        ("Set girerken 'Bu antrenmanda ilerledin ✓'; sonra 'Geçen antrenmanda ilerledin'", live_progress_and_reset),
        ("İlerleme olmayan antrenmandan sonra 'Son ilerleme 2 antrenman önce'", no_progress_increments),
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


# ---------------------------------------------------------------- Geçmiş ve düzeltme

def iso_at(days_ago, plus_minutes=0):
    moment = datetime.now(timezone.utc) - timedelta(days=days_ago) + timedelta(minutes=plus_minutes)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def history_rows(page):
    return page.locator(".history .day")


def history_steps(run):
    state = {}

    def record(record_id, days_ago, equipment_id, reps_list):
        return {
            "id": record_id,
            "dayId": "push",
            "dayName": "Push",
            "startedAt": iso_at(days_ago),
            "finishedAt": iso_at(days_ago, 60),
            "entries": [{
                "exerciseId": "rope-pushdown",
                "equipmentId": equipment_id,
                "name": "Rope Pushdown",
                "equipmentName": "Kablo",
                "unit": "kg",
                "options": ["rope-pushdown"],
                "target": {"sets": 3, "repMin": 12, "repMax": 15},
                "sets": [{"weight": 40, "reps": count} for count in reps_list],
            }],
        }

    def list_newest_first(page):
        page.goto(run.base_url + "/")
        open_day(page, "push", "Push")
        add_machine(card(page, "Rope Pushdown"), "Kablo", "kg")
        kablo = stored_program(page)["exercises"]["rope-pushdown"]["equipment"][0]["id"]
        page.evaluate(PUT_SCRIPT, ["sessions", record("gecmis-eski", 14, kablo, [12, 11, 10])])
        page.evaluate(PUT_SCRIPT, ["sessions", record("gecmis-yeni", 7, kablo, [12, 11, 10])])
        state["older_date"] = page.evaluate(
            "(iso) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(iso))",
            iso_at(14),
        )
        go_home(page)
        page.get_by_role("link", name="Geçmiş").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Geçmiş")
        expect(history_rows(page)).to_have_count(2)
        expect(history_rows(page).first).to_have_attribute("href", "#/gecmis/gecmis-yeni")
        expect(history_rows(page).first.locator(".muted")).to_have_text("1 hareket · 3 set · 1 sa")
        page.screenshot(path=str(ARTIFACTS / "asama8-gecmis.png"))

    def detail(page):
        history_rows(page).first.click()
        expect(page.get_by_role("heading", level=1)).to_contain_text("Push · ")
        entry = page.locator(".entry")
        expect(entry.locator("h2")).to_have_text("Rope Pushdown · Kablo")
        expect(entry.locator(".entry-sets")).to_have_text("40 kg × 12 · 11 · 10")
        expect(entry.locator(".muted")).to_have_text("Hedef 3 × 15")
        page.screenshot(path=str(ARTIFACTS / "asama8-ayrinti.png"))

    def edit_uses_earlier_records(page):
        page.get_by_role("link", name="Düzenle").click()
        expect(page.get_by_role("button", name="Kaydet")).to_be_visible()
        rope = card(page, "Rope Pushdown")
        expect(weight_input(rope)).to_have_value("40")
        expect(reps(rope, 2)).to_have_value("11")
        expect(last_time(rope)).to_have_text(f"Geçen sefer — {state['older_date']}: 40 kg × 12 · 11 · 10")
        expect(counter_line(rope)).to_have_count(0)
        reps(rope, 2).fill("12")
        expect(live_progress(rope)).to_have_text("Bu antrenmanda ilerledin ✓")
        page.screenshot(path=str(ARTIFACTS / "asama8-duzenleme.png"))
        page.get_by_role("button", name="Kaydet").click()
        expect(page.locator("#flash")).to_have_text("Değişiklikler kaydedildi ✓")
        expect(page.locator(".entry .entry-sets")).to_have_text("40 kg × 12 · 12 · 10")

    def correction_updates_today(page):
        page.get_by_role("link", name="← Geçmiş").click()
        page.get_by_role("link", name="Ana Sayfa").click()
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        expect(last_time(rope)).to_contain_text("40 kg × 12 · 12 · 10")
        expect(counter_line(rope)).to_have_text("Geçen antrenmanda ilerledin")
        go_home(page)

    def validation_and_leave_guard(page):
        page.get_by_role("link", name="Geçmiş").click()
        history_rows(page).nth(1).click()
        page.get_by_role("link", name="Düzenle").click()
        rope = card(page, "Rope Pushdown")
        log_sets(rope, "", ["", "", ""])
        page.get_by_role("button", name="Kaydet").click()
        expect(workout_message(page)).to_contain_text("En az bir hareket için set girin.")
        page.once("dialog", lambda dialog: dialog.dismiss())
        page.get_by_role("link", name="← Vazgeç").click()
        expect(page.get_by_role("button", name="Kaydet")).to_be_visible()
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("link", name="← Vazgeç").click()
        expect(page.locator(".entry .entry-sets")).to_have_text("40 kg × 12 · 11 · 10")

    def change_machine(page):
        page.get_by_role("link", name="Düzenle").click()
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo 2", "kg")
        expect(reps(rope, 1)).to_have_value("12")
        page.get_by_role("button", name="Kaydet").click()
        expect(page.locator(".entry h2")).to_have_text("Rope Pushdown · Kablo 2")
        older = next(session for session in sessions(page) if session["id"] == "gecmis-eski")
        assert older["entries"][0]["equipmentName"] == "Kablo 2", older["entries"][0]

    def delete_with_confirmation(page):
        page.once("dialog", lambda dialog: dialog.dismiss())
        page.get_by_role("button", name="Sil").click()
        expect(page.locator(".entry")).to_have_count(1)
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Sil").click()
        expect(page.locator("#flash")).to_have_text("Antrenman silindi.")
        expect(history_rows(page)).to_have_count(1)
        assert [session["id"] for session in sessions(page)] == ["gecmis-yeni"], sessions(page)

    return [
        ("Geçmiş listesi en yeniden eskiye; hareket, set ve süre", list_newest_first),
        ("Ayrıntı: hareket, makine, setler ve hedef", detail),
        ("Düzenlemede 'geçen sefer' o antrenmandan öncekine göre; değişiklik kaydediliyor", edit_uses_earlier_records),
        ("Düzeltmeden sonra bugünün 'geçen sefer' ve sayacı değişiyor", correction_updates_today),
        ("Boş kayıt uyarısı; kaydetmeden çıkarken onay", validation_and_leave_guard),
        ("Düzenlerken makine değiştiriliyor", change_machine),
        ("Silmeden önce onay soruluyor", delete_with_confirmation),
    ]



# ---------------------------------------------------------------- İlerleme grafikleri

def readout(page):
    return page.locator("#readout")


def chip_names(page, legend):
    group = page.locator("fieldset").filter(has=page.locator("legend", has_text=legend))
    return [text.strip() for text in group.locator(".chip").all_text_contents()]


def record_values(page):
    return page.locator(".records tbody td.number").all_text_contents()


def tap_point(page, index):
    box = page.locator(".chart .dot").nth(index).bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def progress_steps(run):
    state = {}

    def entry(exercise_id, name, equipment_id, equipment_name, unit, set_list):
        return {
            "exerciseId": exercise_id,
            "equipmentId": equipment_id,
            "name": name,
            "equipmentName": equipment_name,
            "unit": unit,
            "options": [exercise_id],
            "target": {"sets": 3, "repMin": 12, "repMax": 15},
            "sets": [{"weight": weight, "reps": count} for weight, count in set_list],
        }

    def record(record_id, days_ago, day_id, day_name, entries):
        return {
            "id": record_id,
            "dayId": day_id,
            "dayName": day_name,
            "startedAt": iso_at(days_ago),
            "finishedAt": iso_at(days_ago, 60),
            "entries": entries,
        }

    def date_of(page, days_ago):
        return page.evaluate(
            "(iso) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(iso))",
            iso_at(days_ago),
        )

    def list_grouped_by_day(page):
        page.goto(run.base_url + "/")
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        add_machine(rope, "Kablo 2", "kademe")
        go_home(page)
        open_day(page, "lower", "Lower")
        add_machine(card(page, "Ab Wheel Roll-Out"), "Vücut ağırlığı", "ağırlıksız")
        go_home(page)
        ids = {
            (exercise_id, equipment["name"]): equipment["id"]
            for exercise_id, exercise in stored_program(page)["exercises"].items()
            for equipment in exercise["equipment"]
        }
        kablo = ids[("rope-pushdown", "Kablo")]
        kablo2 = ids[("rope-pushdown", "Kablo 2")]
        wheel = ids[("ab-wheel-roll-out", "Vücut ağırlığı")]
        rope_kg = lambda set_list: entry("rope-pushdown", "Rope Pushdown", kablo, "Kablo", "kg", set_list)
        rope_level = lambda set_list: entry("rope-pushdown", "Rope Pushdown", kablo2, "Kablo 2", "level", set_list)
        records = [
            record("p1", 21, "push", "Push", [rope_kg([(40, 12), (40, 11), (40, 10)])]),
            record("p2", 14, "push", "Push", [rope_kg([(40, 12), (40, 12), (40, 10)])]),
            record("p3", 10, "push", "Push", [rope_level([(10, 15), (10, 13)])]),
            record("p4", 7, "push", "Push", [
                rope_kg([(40, 12), (40, 12), (40, 10)]),
                entry("eski-hareket", "Eski Hareket", "eski-makine", "Eski makine", "kg", [(20, 10)]),
            ]),
            record("p5", 3, "push", "Push", [rope_level([(11, 12), (11, 10)])]),
            record("l1", 12, "lower", "Lower", [entry("ab-wheel-roll-out", "Ab Wheel Roll-Out", wheel, "Vücut ağırlığı", "none", [(None, 10), (None, 8)])]),
            record("l2", 5, "lower", "Lower", [entry("ab-wheel-roll-out", "Ab Wheel Roll-Out", wheel, "Vücut ağırlığı", "none", [(None, 12), (None, 10)])]),
        ]
        for item in records:
            page.evaluate(PUT_SCRIPT, ["sessions", item])
        state["first_date"] = date_of(page, 21)
        page.reload()
        page.get_by_role("link", name="İlerleme").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("İlerleme")
        expect(page.locator(".section-title")).to_have_text(["Push", "Lower", "Programda olmayan"])
        rows = page.locator(".days .day")
        expect(rows).to_have_count(3)
        expect(rows.nth(0).locator(".day-name")).to_have_text("Rope Pushdown")
        expect(rows.nth(0).locator(".muted")).to_have_text(f"5 antrenman · son: {date_of(page, 3)}")
        expect(rows.nth(1).locator(".day-name")).to_have_text("Ab Wheel Roll-Out")
        expect(rows.nth(2).locator(".day-name")).to_have_text("Eski Hareket")
        expect(rows.nth(2).locator(".muted")).to_have_text(f"Push · 1 antrenman · son: {date_of(page, 7)}")
        page.screenshot(path=str(ARTIFACTS / "asama9-liste.png"), full_page=True)

    def level_chart(page):
        page.locator(".days .day").first.click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Rope Pushdown")
        expect(page.locator(".page-head .muted")).to_have_text("Push")
        assert chip_names(page, "Makine") == ["Kablo 2 · kademe", "Kablo · kg"], chip_names(page, "Makine")
        expect(page.get_by_role("radio", name="Kablo 2 · kademe", exact=True)).to_be_checked()
        assert chip_names(page, "Ölçü") == ["En yüksek kademe", "Toplam tekrar"], chip_names(page, "Ölçü")
        expect(page.locator("#progress-counter")).to_have_text("Geçen antrenmanda ilerledin")
        expect(page.locator(".chart .dot")).to_have_count(2)
        expect(readout(page).locator(".readout-value")).to_have_text("11k")
        expect(readout(page).locator(".readout-sets")).to_have_text("11k × 12 · 10")
        assert record_values(page) == ["11k", "10k"], record_values(page)
        page.get_by_role("radio", name="Toplam tekrar", exact=True).check()
        expect(readout(page).locator(".readout-value")).to_have_text("22")
        assert record_values(page) == ["22", "28"], record_values(page)

    def kg_chart(page):
        page.get_by_role("radio", name="Kablo · kg", exact=True).check()
        assert chip_names(page, "Ölçü") == ["Tahmini 1TM", "En ağır", "Hacim"], chip_names(page, "Ölçü")
        expect(page.get_by_role("radio", name="Tahmini 1TM", exact=True)).to_be_checked()
        expect(page.locator("#progress-counter")).to_have_text("Son ilerleme 2 antrenman önce")
        expect(page.locator(".chart .dot")).to_have_count(3)
        expect(readout(page).locator(".readout-value")).to_have_text("56 kg")
        expect(page.locator(".records thead th").nth(1)).to_have_text("Tahmini 1TM")
        page.get_by_role("radio", name="Hacim", exact=True).check()
        expect(readout(page).locator(".readout-value")).to_have_text("1.360 kg")
        assert record_values(page) == ["1.360 kg", "1.360 kg", "1.320 kg"], record_values(page)
        page.get_by_role("radio", name="En ağır", exact=True).check()
        assert record_values(page) == ["40 kg", "40 kg", "40 kg"], record_values(page)
        page.get_by_role("radio", name="Hacim", exact=True).check()

    def tap_shows_sets(page):
        tap_point(page, 0)
        expect(readout(page).locator(".readout-value")).to_have_text("1.320 kg")
        expect(readout(page).locator(".readout-sets")).to_have_text("40 kg × 12 · 11 · 10")
        expect(readout(page).locator(".muted")).to_contain_text(state["first_date"])
        crosshair = page.locator(".chart .crosshair").get_attribute("x1")
        assert crosshair == page.locator(".chart .dot").first.get_attribute("cx"), crosshair
        page.locator(".chart").focus()
        page.keyboard.press("ArrowRight")
        expect(readout(page).locator(".readout-sets")).to_have_text("40 kg × 12 · 12 · 10")
        page.keyboard.press("End")
        page.keyboard.press("ArrowLeft")
        page.mouse.move(0, 0)
        expect(readout(page).locator(".readout-sets")).to_have_text("40 kg × 12 · 12 · 10")
        tap_point(page, 0)
        page.evaluate("document.activeElement.blur()")
        page.screenshot(path=str(ARTIFACTS / "asama9-grafik.png"), full_page=True)

    def bodyweight_chart(page):
        page.get_by_role("link", name="← İlerleme").click()
        page.locator(".days .day").filter(has_text="Ab Wheel Roll-Out").click()
        expect(page.locator(".page-head .muted")).to_have_text("Lower")
        assert chip_names(page, "Makine") == ["Vücut ağırlığı · ağırlıksız"], chip_names(page, "Makine")
        assert chip_names(page, "Ölçü") == ["Toplam tekrar", "En çok tekrar"], chip_names(page, "Ölçü")
        expect(readout(page).locator(".readout-value")).to_have_text("22")
        expect(readout(page).locator(".readout-sets")).to_have_text("12 · 10")
        page.get_by_role("radio", name="En çok tekrar", exact=True).check()
        assert record_values(page) == ["12", "10"], record_values(page)

    def removed_exercise(page):
        page.get_by_role("link", name="← İlerleme").click()
        page.locator(".days .day").filter(has_text="Eski Hareket").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Eski Hareket")
        assert chip_names(page, "Makine") == ["Eski makine · kg (silinmiş)"], chip_names(page, "Makine")
        expect(page.locator("#progress-counter")).to_have_text("Tek kayıt var: ilerleme ikinci antrenmandan sonra hesaplanır.")
        expect(page.locator(".chart")).to_have_count(0)
        expect(page.locator(".chart-note")).to_have_text("Grafik ikinci antrenmandan sonra çizilir.")
        assert record_values(page) == ["26,7 kg"], record_values(page)
        page.goto(run.base_url + "/#/ilerleme/push/olmayan-hareket")
        expect(page.get_by_role("heading", level=1)).to_have_text("İlerleme")

    return [
        ("İlerleme listesi günlere göre; programda olmayan kayıt ayrı grupta", list_grouped_by_day),
        ("Makine sekmeleri, en son kullanılan önce; kademe makinesi kendi biriminde", level_chart),
        ("kg makinesinde ölçüler: Tahmini 1TM, En ağır, Hacim; sayaç grafiğin üstünde", kg_chart),
        ("Noktaya dokununca o günün setleri görünüyor; ok tuşlarıyla da geziliyor", tap_shows_sets),
        ("Ağırlıksız makinede ölçüler: Toplam tekrar, En çok tekrar", bodyweight_chart),
        ("Programda olmayan hareket ve silinmiş makine; tek kayıtta grafik yerine not", removed_exercise),
    ]



# ---------------------------------------------------------------- Program düzenleyici

def program_rows(page):
    return page.locator(".program-list .program-link")


def open_program(page):
    page.get_by_role("link", name="Programı düzenle").click()
    expect(page.get_by_role("heading", level=1)).to_have_text("Program")


def open_program_row(page, day_name, row_title):
    open_program(page)
    program_rows(page).filter(has_text=day_name).click()
    expect(page.get_by_role("heading", level=1)).to_have_text(day_name)
    program_rows(page).filter(has=page.get_by_text(row_title, exact=True)).click()
    expect(page.get_by_role("heading", level=1)).to_have_text("Satırı düzenle")


def item_message(page):
    return page.locator("#item-message")


def fill_target(page, sets, rep_max):
    page.get_by_label("Set", exact=True).fill(sets)
    page.get_by_label("En çok tekrar", exact=True).fill(rep_max)


def save_item(page):
    page.get_by_role("button", name="Kaydet", exact=True).click()


def program_editor_steps(run):
    def program_screen(page):
        page.goto(run.base_url + "/")
        open_program(page)
        expect(page.locator(".program-list .program-link .day-name")).to_have_text(["Push", "Pull", "Legs", "Upper", "Lower"])
        expect(program_rows(page).first.locator(".muted")).to_have_text("6 hareket")
        expect(page.get_by_role("button", name="Push: yukarı taşı")).to_be_disabled()
        expect(page.get_by_role("button", name="Lower: aşağı taşı")).to_be_disabled()
        page.screenshot(path=str(ARTIFACTS / "asama10-program.png"), full_page=True)

    def add_day_and_reorder(page):
        page.get_by_role("button", name="+ Gün ekle").click()
        expect(page.get_by_label("Yeni günün adı")).to_be_focused()
        page.get_by_role("button", name="Ekle").click()
        expect(page.locator(".program-form .message")).to_have_text("Güne bir ad verin.")
        page.get_by_label("Yeni günün adı").fill("push")
        page.get_by_role("button", name="Ekle").click()
        expect(page.locator(".program-form .message")).to_have_text("Bu adda bir gün zaten var.")
        page.get_by_label("Yeni günün adı").fill("Arms")
        page.get_by_role("button", name="Ekle").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Arms")
        expect(page.locator("#flash")).to_have_text("Gün eklendi ✓ Şimdi satır ekleyin.")
        expect(page.locator(".empty-state")).to_have_text("Bu günde henüz satır yok.")
        page.get_by_role("link", name="← Program").click()
        expect(page.locator(".program-list .program-link .day-name")).to_have_text(["Push", "Pull", "Legs", "Upper", "Lower", "Arms"])
        page.get_by_role("button", name="Arms: yukarı taşı").click()
        expect(program_rows(page).nth(4)).to_contain_text("Arms")
        expect(page.get_by_role("button", name="Arms: yukarı taşı")).to_be_focused()
        expect(page.locator(".program-list .program-link .day-name")).to_have_text(["Push", "Pull", "Legs", "Upper", "Arms", "Lower"])
        page.get_by_role("link", name="Ana Sayfa").click()
        expect(page.locator(".days .day-name")).to_have_text(["Push", "Pull", "Legs", "Upper", "Arms", "Lower"])
        expect(page.locator(".days .day").filter(has_text="Arms").locator(".muted")).to_have_text("0 hareket · henüz yapılmadı")

    def add_rows(page):
        open_program(page)
        program_rows(page).filter(has_text="Arms").click()
        page.get_by_role("link", name="+ Satır ekle").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Yeni satır")
        save_item(page)
        expect(item_message(page)).to_have_text("Bir hareket seçin.")
        page.get_by_label("Hareket", exact=True).select_option(label="+ Yeni hareket")
        expect(page.get_by_label("Yeni hareketin adı")).to_be_focused()
        save_item(page)
        expect(item_message(page)).to_have_text("Harekete bir ad verin.")
        page.get_by_label("Yeni hareketin adı").fill("rope pushdown")
        save_item(page)
        expect(item_message(page)).to_have_text("Bu adda bir hareket zaten var.")
        page.get_by_label("Yeni hareketin adı").fill("Cable Curl")
        expect(page.get_by_label("En az tekrar", exact=True)).to_have_count(0)
        fill_target(page, "3", "")
        save_item(page)
        expect(item_message(page)).to_have_text("En çok tekrar 1 ile 100 arasında bir tam sayı olmalı.")
        expect(page.get_by_label("En çok tekrar", exact=True)).to_have_attribute("aria-invalid", "true")
        page.get_by_label("En çok tekrar", exact=True).fill("12")
        page.screenshot(path=str(ARTIFACTS / "asama10-satir.png"), full_page=True)
        save_item(page)
        expect(page.locator("#flash")).to_have_text("Satır kaydedildi ✓")
        expect(program_rows(page).first.locator(".day-name")).to_have_text("Cable Curl")
        expect(program_rows(page).first.locator(".muted")).to_have_text("Hedef 3 × 12")

        page.get_by_role("link", name="+ Satır ekle").click()
        page.get_by_label("Hareket", exact=True).select_option(label="Wrist Curl")
        page.get_by_label("İkinci hareket (isteğe bağlı)").select_option(label="Reverse Curl")
        fill_target(page, "2", "15")
        save_item(page)
        expect(program_rows(page).nth(1).locator(".day-name")).to_have_text("Wrist Curl / Reverse Curl")
        expect(program_rows(page).nth(1).locator(".muted")).to_have_text("Hedef 2 × 15")

        page.get_by_role("link", name="+ Satır ekle").click()
        page.get_by_label("Hareket", exact=True).select_option(label="Cable Curl")
        fill_target(page, "3", "10")
        save_item(page)
        expect(item_message(page)).to_have_text("Cable Curl bu günde zaten var.")
        page.once("dialog", lambda dialog: dialog.dismiss())
        page.get_by_role("link", name="← Arms").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Yeni satır")
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("link", name="← Arms").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Arms")

        page.get_by_role("button", name="Wrist Curl / Reverse Curl: yukarı taşı").click()
        expect(program_rows(page).first.locator(".day-name")).to_have_text("Wrist Curl / Reverse Curl")
        page.screenshot(path=str(ARTIFACTS / "asama10-gun.png"), full_page=True)

    def workout_uses_new_rows(page):
        page.get_by_role("link", name="← Program").click()
        page.get_by_role("link", name="Ana Sayfa").click()
        page.locator(".days .day").filter(has_text="Arms").click()
        expect(page.locator(".topbar h1")).to_have_text("Arms")
        expect(page.locator("[data-card] h2")).to_have_text(["Wrist Curl / Reverse Curl", "Cable Curl"])
        expect(card(page, "Cable Curl").locator(".target")).to_have_text("Hedef 3 × 12")
        expect(card(page, "Cable Curl").locator(".no-machine")).to_have_count(1)
        go_home(page)

    def target_change(page):
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        log_sets(rope, "40", ["12", "12", "12"])
        finish(page)
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")
        open_program_row(page, "Push", "Overhead Rope Extension")
        expect(page.get_by_label("En çok tekrar", exact=True)).to_have_value("15")  # "2 × 15": kutu boş değil
        page.get_by_role("link", name="Vazgeç").click()
        program_rows(page).filter(has=page.get_by_text("Rope Pushdown", exact=True)).click()
        expect(page.get_by_label("Hareket", exact=True)).to_have_value("rope-pushdown")
        expect(page.get_by_label("Set", exact=True)).to_have_value("3")
        expect(page.get_by_label("En çok tekrar", exact=True)).to_have_value("15")  # "12–15": en çok tekrar
        fill_target(page, "4", "12")
        save_item(page)
        expect(program_rows(page).filter(has_text="Rope Pushdown").locator(".muted")).to_have_text("Hedef 4 × 12")
        page.get_by_role("link", name="← Program").click()
        page.get_by_role("link", name="Ana Sayfa").click()
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        expect(rope.locator(".target")).to_have_text("Hedef 4 × 12")
        expect(reps_inputs(rope)).to_have_count(4)
        expect(last_time(rope)).to_contain_text("40 kg × 12 · 12 · 12")
        go_home(page)
        page.get_by_role("link", name="Geçmiş").click()
        history_rows(page).first.click()
        expect(page.locator(".entry .muted")).to_have_text("Hedef 3 × 15")
        page.get_by_role("link", name="← Geçmiş").click()
        page.get_by_role("link", name="Ana Sayfa").click()

    def rename_keeps_history(page):
        open_program_row(page, "Push", "Rope Pushdown")
        page.get_by_role("button", name="Adı düzelt").click()
        rename = page.get_by_label("Yeni ad (her günde değişir; geçmiş kayıtlar eski adla kalır)")
        expect(rename).to_be_focused()
        expect(rename).to_have_value("Rope Pushdown")
        rename.fill("cable fly")
        page.get_by_role("button", name="Adı kaydet").click()
        expect(page.locator(".rename-form .message")).to_have_text("Bu adda bir hareket zaten var.")
        page.get_by_label("Yeni ad (her günde değişir; geçmiş kayıtlar eski adla kalır)").fill("Triceps Rope Pushdown")
        page.get_by_label("Yeni ad (her günde değişir; geçmiş kayıtlar eski adla kalır)").press("Enter")
        expect(page.locator("#item-notice")).to_have_text("Hareketin adı değiştirildi ✓")
        expect(page.get_by_label("Hareket", exact=True).locator("option:checked")).to_have_text("Triceps Rope Pushdown")
        page.get_by_role("link", name="Vazgeç").click()  # satırda değişiklik yok: onay sorulmaz
        expect(program_rows(page).filter(has_text="Triceps Rope Pushdown")).to_have_count(1)
        page.get_by_role("link", name="← Program").click()
        page.get_by_role("link", name="Ana Sayfa").click()
        open_day(page, "push", "Push")
        rope = card(page, "Triceps Rope Pushdown")
        expect(radio(rope, "Kablo · kg")).to_be_checked()
        expect(last_time(rope)).to_contain_text("40 kg × 12 · 12 · 12")
        go_home(page)
        page.get_by_role("link", name="Geçmiş").click()
        history_rows(page).first.click()
        expect(page.locator(".entry h2")).to_have_text("Rope Pushdown · Kablo")  # kayıt, antrenmandaki adı taşır
        page.get_by_role("link", name="← Geçmiş").click()
        page.get_by_role("link", name="Ana Sayfa").click()
        page.get_by_role("link", name="İlerleme").click()
        expect(page.locator(".days .day-name")).to_have_text(["Triceps Rope Pushdown"])
        page.get_by_role("link", name="Ana Sayfa").click()

    def delete_row_and_day(page):
        open_program_row(page, "Arms", "Cable Curl")
        page.once("dialog", lambda dialog: dialog.dismiss())
        page.get_by_role("button", name="Satırı sil").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Satırı düzenle")
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Satırı sil").click()
        expect(page.locator("#flash")).to_have_text("Satır silindi.")
        expect(program_rows(page)).to_have_count(1)

        page.get_by_role("link", name="← Program").click()
        page.get_by_role("link", name="Ana Sayfa").click()
        page.locator(".days .day").filter(has_text="Arms").click()
        wrist = card(page, "Wrist Curl / Reverse Curl")
        add_machine(wrist, "Dambıl", "kg")
        log_sets(wrist, "10", ["15"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        go_home(page)
        open_program(page)
        page.get_by_role("button", name="Programı sıfırla").click()
        expect(page.locator("#program-message")).to_have_text(
            "Devam eden antrenman varken program sıfırlanamaz. Önce antrenmanı bitirin ya da silin.")
        program_rows(page).filter(has_text="Arms").click()
        expect(page.locator(".reminder")).to_contain_text("Bu günün devam eden antrenmanı var")
        page.get_by_role("button", name="Günü sil").click()
        expect(page.locator("#day-message")).to_have_text("Bu günün devam eden antrenmanı var. Önce antrenmanı bitirin ya da silin.")
        page.get_by_role("link", name="← Program").click()
        page.get_by_role("link", name="Ana Sayfa").click()
        page.get_by_role("link", name="Devam et").click()
        finish(page)
        expect(page.locator("#flash")).to_have_text("Arms antrenmanı kaydedildi ✓")

        open_program(page)
        program_rows(page).filter(has_text="Arms").click()
        messages = []
        page.once("dialog", lambda dialog: (messages.append(dialog.message), dialog.dismiss()))
        page.get_by_role("button", name="Günü sil").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Arms")
        assert messages == ['"Arms" günü silinsin mi? Bu günün geçmiş kayıtları silinmez.'], messages
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Günü sil").click()
        expect(page.locator("#flash")).to_have_text('"Arms" günü silindi.')
        expect(page.locator(".program-list .program-link .day-name")).to_have_text(["Push", "Pull", "Legs", "Upper", "Lower"])
        assert len(sessions(page)) == 2, "Silinen günün kaydı durmalı"
        page.get_by_role("link", name="Ana Sayfa").click()
        page.get_by_role("link", name="İlerleme").click()
        other = page.locator(".days .day").filter(has_text="Wrist Curl")
        expect(other.locator(".muted")).to_contain_text("Arms · 1 antrenman")
        page.get_by_role("link", name="Ana Sayfa").click()

    def reset_program(page):
        open_program(page)
        page.get_by_role("button", name="Pull: yukarı taşı").click()
        expect(program_rows(page).first).to_contain_text("Pull")
        page.once("dialog", lambda dialog: dialog.dismiss())
        page.get_by_role("button", name="Programı sıfırla").click()
        expect(program_rows(page).first).to_contain_text("Pull")
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("button", name="Programı sıfırla").click()
        expect(page.locator("#flash")).to_have_text("Program sıfırlandı ✓")
        expect(page.locator(".program-list .program-link .day-name")).to_have_text(["Push", "Pull", "Legs", "Upper", "Lower"])
        saved = stored_program(page)
        assert "customized" not in saved, saved.keys()
        rope = saved["exercises"]["rope-pushdown"]
        assert rope["name"] == "Rope Pushdown", rope
        assert [equipment["name"] for equipment in rope["equipment"]] == ["Kablo"], rope
        assert saved["exercises"]["wrist-curl"]["equipment"][0]["name"] == "Dambıl"
        assert any(exercise["name"] == "Cable Curl" for exercise in saved["exercises"].values())
        page.get_by_role("link", name="Ana Sayfa").click()
        open_day(page, "push", "Push")
        rope_card = card(page, "Rope Pushdown")
        expect(rope_card.locator(".target")).to_have_text("Hedef 3 × 15")
        expect(last_time(rope_card)).to_contain_text("40 kg × 12 · 12 · 12")
        go_home(page)
        open_program(page)
        page.screenshot(path=str(ARTIFACTS / "asama10-program-sifirlandi.png"), full_page=True)

    return [
        ("Program ekranı: günler sırasıyla; baştaki ve sondaki taşıma düğmesi kapalı", program_screen),
        ("Gün ekleniyor (boş ve aynı ad reddediliyor) ve sırası değişiyor; ana ekran yeni sırada", add_day_and_reorder),
        ("Satır ekleniyor: yeni hareket, dönüşümlü satır, hedef denetimi; aynı hareket reddediliyor", add_rows),
        ("Antrenman ekranı yeni günün satırlarını programdaki sırayla gösteriyor", workout_uses_new_rows),
        ("Hedef değişince yeni antrenman yeni hedefle; eski kayıt eski hedefi gösteriyor", target_change),
        ("Hareketin adı düzeltiliyor; geçmiş kopmuyor, eski kayıt eski adı taşıyor", rename_keeps_history),
        ("Satır ve gün onayla siliniyor; devam eden antrenmanın günü silinemiyor; kayıtlar duruyor", delete_row_and_day),
        ("Programı sıfırla: günler ve adlar geri geliyor; makineler ve kayıtlar duruyor", reset_program),
    ]



# ---------------------------------------------------------------- Makine yönetimi ve "+ Hareket ekle"

def machine_rows(scope):
    return scope.locator(".machine-list:not(.archived) li")


def archived_rows(scope):
    return scope.locator(".machine-list.archived li")


def extra_form(page):
    return page.locator("[data-form='extra']")


def machine_management_steps(run):
    def rename_machine(page):
        page.goto(run.base_url + "/")
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        add_machine(rope, "Kablo 2", "kademe")
        radio(rope, "Kablo · kg").check()
        log_sets(rope, "40", ["12", "12"])
        finish(page)
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        rope.get_by_role("button", name="Düzenle").click()
        rope.get_by_role("button", name="Kablo makinesini değiştir").click()
        name = rope.get_by_label("Makinenin adı")
        expect(name).to_be_focused()
        expect(name).to_have_value("Kablo")
        expect(rope.locator(".unit-locked")).to_have_text("Birim: kg (bu makinede kayıt olduğu için değiştirilemez)")
        name.fill("kablo 2")
        rope.get_by_role("button", name="Kaydet").click()
        expect(rope.locator(".machine-message")).to_have_text("Bu adda bir makine zaten var.")
        rope.get_by_label("Makinenin adı").fill("Halat")
        rope.get_by_role("button", name="Kaydet").click()
        expect(save_status(page)).to_have_text("Makine kaydedildi ✓")
        expect(machine_rows(rope).first).to_contain_text("Halat · kg")
        rope.get_by_role("button", name="Bitti").click()
        expect(radio(rope, "Halat · kg")).to_be_checked()
        expect(last_time(rope)).to_contain_text("40 kg × 12 · 12")
        go_home(page)
        page.get_by_role("link", name="Geçmiş").click()
        history_rows(page).first.click()
        expect(page.locator(".entry h2")).to_have_text("Rope Pushdown · Kablo")  # kayıt, antrenmandaki adı taşır
        page.get_by_role("link", name="← Geçmiş").click()
        page.get_by_role("link", name="Ana Sayfa").click()

    def change_unit_of_unused(page):
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        rope.get_by_role("button", name="Düzenle").click()
        rope.get_by_role("button", name="Kablo 2 makinesini değiştir").click()
        expect(rope.locator(".unit-locked")).to_have_count(0)
        expect(rope.get_by_role("radio", name="kademe", exact=True)).to_be_checked()
        rope.get_by_role("radio", name="kg", exact=True).check()
        page.screenshot(path=str(ARTIFACTS / "asama10-makine-degistir.png"), full_page=True)
        rope.get_by_role("button", name="Kaydet").click()
        expect(machine_rows(rope).nth(1)).to_contain_text("Kablo 2 · kg")
        rope.get_by_role("button", name="Bitti").click()
        radio(rope, "Kablo 2 · kg").check()
        expect(weight_label(rope)).to_have_text("Ağırlık (kg)")
        saved = stored_program(page)["exercises"]["rope-pushdown"]["equipment"]
        assert [(item["name"], item["unit"]) for item in saved] == [("Halat", "kg"), ("Kablo 2", "kg")], saved

    def delete_and_restore(page):
        rope = card(page, "Rope Pushdown")
        rope.get_by_role("button", name="Düzenle").click()
        delete_machine(page, rope, "Halat", accept=True)
        expect(save_status(page)).to_have_text("Makine silindi ✓")
        expect(archived_rows(rope)).to_have_count(1)
        expect(archived_rows(rope).first).to_contain_text("Halat · kg")
        # Silinen makinenin adı başka makinede kullanılınca geri alma, önce ad değişikliğini ister.
        rope.get_by_role("button", name="Kablo 2 makinesini değiştir").click()
        rope.get_by_label("Makinenin adı").fill("Halat")
        rope.get_by_role("button", name="Kaydet").click()
        expect(machine_rows(rope).first).to_contain_text("Halat · kg")
        rope.get_by_role("button", name="Halat makinesini geri al").click()
        expect(rope.locator(".card-message")).to_have_text('"Halat" adında etkin bir makine var. Geri almadan önce onun adını değiştirin.')
        rope.get_by_role("button", name="Halat makinesini değiştir").click()
        rope.get_by_label("Makinenin adı").fill("Kablo 2")
        rope.get_by_role("button", name="Kaydet").click()
        expect(machine_rows(rope).first).to_contain_text("Kablo 2 · kg")
        rope.get_by_role("button", name="Halat makinesini geri al").click()
        expect(save_status(page)).to_have_text("Makine geri alındı ✓")
        expect(archived_rows(rope)).to_have_count(0)
        page.screenshot(path=str(ARTIFACTS / "asama10-makineler.png"), full_page=True)
        rope.get_by_role("button", name="Bitti").click()
        assert machine_names(rope) == ["Halat · kg", "Kablo 2 · kg"], machine_names(rope)
        radio(rope, "Halat · kg").check()
        expect(last_time(rope)).to_contain_text("40 kg × 12 · 12")
        go_home(page)

    def add_exercise_to_workout(page):
        open_day(page, "pull", "Pull")
        page.get_by_role("button", name="+ Hareket ekle").click()
        form = extra_form(page)
        expect(form.get_by_label("Hareket", exact=True)).to_be_focused()
        form.get_by_role("button", name="Ekle").click()
        expect(form.locator(".message")).to_have_text("Bir hareket seçin.")
        expect(form.locator("option", has_text="Face Pull")).to_have_count(0)  # bu antrenmanda zaten var
        form.get_by_label("Hareket", exact=True).select_option(label="Rope Pushdown")
        expect(form.get_by_label("Set", exact=True)).to_have_value("3")
        expect(form.get_by_label("En az tekrar", exact=True)).to_have_count(0)
        expect(form.get_by_label("En çok tekrar", exact=True)).to_have_value("15")
        form.get_by_role("button", name="Ekle").click()
        rope = card(page, "Rope Pushdown")
        expect(rope.locator(".extra-row .muted")).to_have_text("Yalnızca bu antrenmana eklendi")
        expect(rope.locator(".target")).to_have_text("Hedef 3 × 15")
        expect(radio(rope, "Halat · kg")).to_be_checked()
        expect(last_time(rope)).to_have_text("Bu makinede önceki kayıt yok")  # Push kaydı Pull'a karışmaz

        page.get_by_role("button", name="+ Hareket ekle").click()
        form = extra_form(page)
        expect(form.locator("option", has_text="Rope Pushdown")).to_have_count(0)
        form.get_by_label("Hareket", exact=True).select_option(label="+ Yeni hareket")
        expect(form.get_by_label("Yeni hareketin adı")).to_be_focused()
        form.get_by_label("Yeni hareketin adı").fill("face pull")
        form.get_by_role("button", name="Ekle").click()
        expect(form.locator(".message")).to_have_text("Bu adda bir hareket zaten var.")
        form.get_by_label("Yeni hareketin adı").fill("Hammer Curl")
        form.get_by_label("En çok tekrar", exact=True).fill("12")
        page.screenshot(path=str(ARTIFACTS / "asama10-hareket-ekle.png"), full_page=True)
        form.get_by_role("button", name="Ekle").click()
        expect(save_status(page)).to_have_text("Hareket eklendi ✓")
        hammer = card(page, "Hammer Curl")
        expect(hammer.locator(".target")).to_have_text("Hedef 3 × 12")
        expect(hammer.locator(".no-machine")).to_have_count(1)
        add_machine(hammer, "Dambıl", "kg")
        log_sets(hammer, "12", ["10", "10"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")

    def extra_cards_survive_reload(page):
        page.reload()
        expect(page.locator(".topbar h1")).to_have_text("Pull")
        hammer = card(page, "Hammer Curl")
        expect(hammer.locator(".extra-row")).to_have_count(1)
        expect(weight_input(hammer)).to_have_value("12")
        rope = card(page, "Rope Pushdown")
        rope.get_by_role("button", name="Rope Pushdown hareketini bu antrenmandan kaldır").click()  # değer yok: sorulmaz
        expect(card(page, "Rope Pushdown")).to_have_count(0)
        page.once("dialog", lambda dialog: dialog.dismiss())
        hammer.get_by_role("button", name="Hammer Curl hareketini bu antrenmandan kaldır").click()
        expect(card(page, "Hammer Curl")).to_have_count(1)
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        finish(page)
        expect(page.locator("#flash")).to_have_text("Pull antrenmanı kaydedildi ✓")
        pull = next(session for session in sessions(page) if session["dayId"] == "pull")
        entry = pull["entries"][0]
        assert (entry["name"], entry["target"]) == ("Hammer Curl", {"sets": 3, "repMin": 12, "repMax": 12}), entry
        program = stored_program(page)
        assert len(program["days"][1]["items"]) == 8, "Program değişmemeli"
        assert "customized" not in program, program.keys()

    def next_workout_without_extra(page):
        open_day(page, "pull", "Pull")
        expect(page.locator("[data-card]")).to_have_count(8)
        expect(card(page, "Hammer Curl")).to_have_count(0)
        go_home(page)
        page.get_by_role("link", name="İlerleme").click()
        other = page.locator(".days .day").filter(has_text="Hammer Curl")
        expect(other.locator(".muted")).to_contain_text("Pull · 1 antrenman")
        page.get_by_role("link", name="Ana Sayfa").click()

    def add_exercise_while_editing_history(page):
        page.get_by_role("link", name="Geçmiş").click()
        history_rows(page).first.click()
        expect(page.get_by_role("heading", level=1)).to_contain_text("Pull · ")
        page.get_by_role("link", name="Düzenle").click()
        page.get_by_role("button", name="+ Hareket ekle").click()
        extra_form(page).get_by_label("Hareket", exact=True).select_option(label="Cable Row")
        expect(extra_form(page).get_by_label("En çok tekrar", exact=True)).to_have_value("12")
        extra_form(page).get_by_role("button", name="Ekle").click()
        row = card(page, "Cable Row")
        add_machine(row, "Kablo", "kg")
        log_sets(row, "35", ["12"])
        page.get_by_role("button", name="Kaydet", exact=True).click()
        expect(page.locator("#flash")).to_have_text("Değişiklikler kaydedildi ✓")
        expect(page.locator(".entry h2")).to_have_text(["Hammer Curl · Dambıl", "Cable Row · Kablo"])
        page.get_by_role("link", name="← Geçmiş").click()
        page.get_by_role("link", name="Ana Sayfa").click()

    def row_editor_lists_machines(page):
        page.get_by_role("link", name="Programı düzenle").click()
        page.locator(".program-link").filter(has_text="Push").click()
        page.locator(".program-link").filter(has=page.get_by_text("Rope Pushdown", exact=True)).click()
        expect(page.locator(".machine-summary")).to_have_text("Makineler: Halat · kg, Kablo 2 · kg")
        page.get_by_label("İkinci hareket (isteğe bağlı)").select_option(label="Face Pull")
        expect(page.locator(".machine-summary").nth(1)).to_have_text("Henüz makine yok")

    return [
        ("Makinenin adı değişiyor; kaydı olan makinenin birimi kilitli; geçmiş kopmuyor", rename_machine),
        ("Kaydı olmayan makinenin birimi değişiyor", change_unit_of_unused),
        ("Silinen makine geri alınıyor; aynı adda etkin makine varken önce ad değişikliği isteniyor", delete_and_restore),
        ("'+ Hareket ekle': katalogdan ya da yeni hareket; hedef programdan geliyor", add_exercise_to_workout),
        ("Eklenen kartlar sayfa yenilenince duruyor, kaldırılabiliyor; kayda yazılıyor, program değişmiyor", extra_cards_survive_reload),
        ("Sonraki antrenmanda eklenen hareket yok; İlerleme'de 'Programda olmayan' altında", next_workout_without_extra),
        ("Geçmiş düzenlerken de '+ Hareket ekle' ile hareket ekleniyor", add_exercise_while_editing_history),
        ("Program satır formu hareketin makinelerini gösteriyor", row_editor_lists_machines),
    ]


# ---------------------------------------------------------------- İnternetsiz çalışma ve güncelleme

WAIT_FOR_CONTROLLER = "navigator.serviceWorker.controller !== null"
# Yeni sürüm kuruldu ama henüz etkinleşmedi (bekliyor).
WAITING_WORKER = "navigator.serviceWorker.getRegistration().then((registration) => registration.waiting !== null)"


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
    state = {}

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
        # Başlangıçtaki gerçek önbellek: kopyadaki sw.js'in sürümüyle kurulan tek önbellek.
        version = re.search(r"const VERSION = '([^']*)';", (app_copy / "sw.js").read_text(encoding="utf-8")).group(1)
        state["old_cache"] = f"antrenman-{version}"
        assert cache_names(page) == [state["old_cache"]], cache_names(page)
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
        assert state["old_cache"] not in names, f"Eski önbellek silinmeliydi: {names}"
        assert "antrenman-test-2" in names, f"Yeni sürümün önbelleği olmalıydı: {names}"

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

    def update_after_leaving_with_error(page):
        rope = card(page, "Rope Pushdown")
        page.evaluate("window.__failWrites = true")
        reps(rope, 3).fill("10")
        expect(save_status(page)).to_contain_text("Kaydedilemedi.")
        page.evaluate("window.__failWrites = false")
        page.once("dialog", lambda dialog: dialog.accept())  # "Yine de çık": kaydedilemeyen değer bırakılıyor
        page.get_by_role("link", name="Ana Sayfa").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")
        bump_version("test-4")
        check_for_update(page)
        expect(page.locator("#update-banner")).to_be_visible()
        with page.expect_navigation():
            page.get_by_role("button", name="Güncelle").click()
        assert "antrenman-test-4" in cache_names(page)

    def new_version_waiting(page, version):
        bump_version(version)
        check_for_update(page)
        expect(page.locator("#update-banner")).to_be_visible()
        page.wait_for_function(f"async () => {WAITING_WORKER}")

    def update_asks_before_discarding(page, question, value, unsaved, saved, version):
        # Kaydedilmemiş düzenleme: "Güncelle" yeni sürümü etkinleştirmeden önce uygulama içinde sorar.
        new_version_waiting(page, version)
        dialogs = []  # vazgeç: form, düğme ve bekleyen sürüm yerinde kalır
        page.once("dialog", lambda dialog: (dialogs.append(f"{dialog.type}: {dialog.message}"), dialog.dismiss()))
        page.get_by_role("button", name="Güncelle").click()
        expect(page.get_by_role("button", name="Güncelle")).to_be_enabled()
        assert dialogs == [f"confirm: {question}"], dialogs
        expect(page.locator("#update-text")).to_have_text("Yeni sürüm var.")
        expect(value(page)).to_have_value(unsaved)
        assert page.evaluate(WAITING_WORKER), "Yeni sürüm etkinleşmemeliydi"
        page.once("dialog", lambda dialog: dialog.accept())  # onay: değişiklik bırakılır
        with page.expect_navigation():
            page.get_by_role("button", name="Güncelle").click()
        expect(value(page)).to_have_value(saved)
        assert f"antrenman-{version}" in cache_names(page)

    def update_with_unsaved_history_edit(page):
        page.get_by_role("link", name="Devam et").click()
        finish(page)
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")
        page.get_by_role("link", name="Geçmiş").click()
        history_rows(page).first.click()
        page.get_by_role("link", name="Düzenle").click()
        weight = lambda page: weight_input(card(page, "Rope Pushdown"))  # noqa: E731
        weight(page).fill("55")
        update_asks_before_discarding(
            page, "Değişiklikler kaydedilmedi ve kaybolacak. Çıkmak istiyor musunuz?", weight, "55", "50", "test-5")

    def update_with_unsaved_row_form(page):
        page.evaluate("location.hash = '#/program/push/push-rope-pushdown'")
        expect(page.get_by_role("heading", level=1)).to_have_text("Satırı düzenle")
        fill_target(page, "4", "15")
        sets = lambda page: page.get_by_label("Set", exact=True)  # noqa: E731
        update_asks_before_discarding(page, "Satırdaki değişiklikler kaydedilmedi. Çıkılsın mı?", sets, "4", "3", "test-6")

    return [
        ("Yeni sürüm yayınlanınca 'Yeni sürüm var: Güncelle' bandı çıkıyor", new_version_offered),
        ("'Güncelle' bekleyen kaydı önce bitiriyor, sonra yeni sürüme geçiyor", update_waits_for_pending_write),
        ("Kayıt hatası varken güncellenmiyor; kayıt tamamlanınca güncelleniyor", update_refused_on_write_error),
        ("Kapanan ekranın eski kayıt hatası 'Güncelle'yi engellemiyor", update_after_leaving_with_error),
        ("Geçmiş düzenlemede kaydedilmemiş değişiklik: 'Güncelle' önce soruyor; vazgeçince değer ve düğme kalıyor",
         update_with_unsaved_history_edit),
        ("Satır formunda kaydedilmemiş değişiklik: 'Güncelle' önce soruyor; vazgeçince değer ve düğme kalıyor",
         update_with_unsaved_row_form),
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
        expect(rope.locator(".target")).to_have_text("Hedef 4 × 20")
        expect(reps_inputs(rope)).to_have_count(4)
        entry = sessions(page)[0]["entries"][0]
        assert entry["target"] == {"sets": 3, "repMin": 12, "repMax": 15}, entry["target"]

    return [
        ("Push kaydediliyor (hedef 3 × 15)", save_push),
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


# ---------------------------------------------------------------- Yükseltme: yazma hatası ve devam eden antrenman

# Sayfa açılırken yazma hatası: sessionStorage'daki işaret, uygulama kodundan önce __failWrites'i açar.
FAIL_WRITES_ON_OPEN_SCRIPT = FAIL_WRITES_SCRIPT + """
if (sessionStorage.getItem('failWrites')) window.__failWrites = true;
"""


def upgrade_resilience_steps(run):
    # Aşama 2 verisi: varsayılan makine yalnızca devam eden antrenmanın taslağında seçili (kaydı yok).
    old = {
        "program": {
            "key": "program",
            "seedVersion": 2,
            "exercises": {
                "machine-chest-press": {
                    "name": "Machine Chest Press",
                    "equipment": [{"id": "machine-chest-press-makine", "name": "Makine", "unit": "kg"}],
                },
            },
            "days": [],
        },
        "sessions": [{
            "id": "devam-eden",
            "dayId": "push",
            "dayName": "Push",
            "startedAt": iso_days_ago(0),
            "finishedAt": None,
            "entries": [],
            "draft": {"cards": [{
                "item": {"id": "push-machine-chest-press", "options": ["machine-chest-press"], "sets": 3, "repMin": 12, "repMax": 12},
                "exerciseId": "machine-chest-press",
                "equipmentId": "machine-chest-press-makine",
                "weight": "40",
                "reps": ["12", "", ""],
            }]},
        }],
    }

    def install_old_data(page):
        page.goto(run.base_url + "/tests/blank.html")
        page.evaluate(PHASE1_DATABASE_SCRIPT, old)

    def opens_when_upgrade_write_fails(page):
        install_old_data(page)
        page.evaluate("sessionStorage.setItem('failWrites', '1')")
        page.goto(run.base_url + "/")
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")
        expect(page.locator(".day-name")).to_have_count(5)
        assert stored_program(page)["seedVersion"] == 2, "Yazma hatasında eski program yerinde kalmalı"
        page.get_by_role("link", name="Ayarlar").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Ayarlar")
        page.evaluate("sessionStorage.removeItem('failWrites'); window.__failWrites = false")
        page.get_by_role("link", name="Ana Sayfa").click()
        expect(page.locator("#resume-title")).to_have_text("Push")
        assert stored_program(page)["seedVersion"] == 3, "Yazma düzelince yükseltilen program kaydedilmeli"

    def draft_keeps_machine(page):
        install_old_data(page)
        page.goto(run.base_url + "/")
        expect(page.locator("#resume-title")).to_have_text("Push")
        machines = stored_program(page)["exercises"]["machine-chest-press"]["equipment"]
        assert machines == [{"id": "machine-chest-press-makine", "name": "Makine", "unit": "kg", "archived": True}], machines
        page.get_by_role("link", name="Devam et").click()
        chest = card(page, "Machine Chest Press")
        expect(radio(chest, "Makine · kg (silinmiş)")).to_be_checked()
        expect(weight_input(chest)).to_have_value("40")
        finish(page)
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")
        [session] = sessions(page)
        assert session["entries"][0]["equipmentId"] == "machine-chest-press-makine", session["entries"]

    return [
        ("Yükseltme yazılamazsa uygulama yine açılıyor; yazma düzelince yükseltilen program kaydediliyor",
         opens_when_upgrade_write_fails),
        ("Devam eden antrenmanda seçili eski makine yükseltmede silinmiyor, seçili kalıyor ve kayda giriyor",
         draft_keeps_machine),
    ]


# ---------------------------------------------------------------- Aynı anda iki pencere

INSTANCE_PAUSED = "Uygulama başka bir pencerede açık"


def instance_steps(run):
    def second_window_takes_over(page):
        page.goto(run.base_url + "/")
        open_day(page, "push", "Push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        log_sets(rope, "50", ["12"])
        expect(save_status(page)).to_have_text("Kaydedildi ✓")
        other = page.context.new_page()
        try:
            other.goto(run.base_url + "/")
            other.get_by_role("link", name="Devam et").click()
            other_rope = card(other, "Rope Pushdown")
            expect(reps(other_rope, 1)).to_have_value("12")
            # İlk pencere durdu: veriyi artık değiştiremez.
            expect(page.get_by_role("heading", level=1)).to_have_text(INSTANCE_PAUSED)
            expect(page.locator("[data-card]")).to_have_count(0)
            for width in (390, 320):  # duran pencerenin ekranı: taşma ve dokunma alanı
                page.set_viewport_size({"width": width, "height": PHONE["height"]})
                assert page.evaluate(OVERFLOW_SCRIPT)["page"] <= 0, page.evaluate(OVERFLOW_SCRIPT)
                assert page.evaluate(SMALL_TARGETS_SCRIPT) == [], page.evaluate(SMALL_TARGETS_SCRIPT)
            page.set_viewport_size(PHONE)
            reps(other_rope, 2).fill("11")
            expect(save_status(other)).to_have_text("Kaydedildi ✓")
            # İlk pencerede devam edilince ikincisi duruyor; ilk pencere ikincinin değerlerini görüyor.
            page.get_by_role("button", name="Burada devam et").click()
            expect(other.get_by_role("heading", level=1)).to_have_text(INSTANCE_PAUSED)
            expect(reps(card(page, "Rope Pushdown"), 2)).to_have_value("11")
            [session] = unfinished(page)
            draft = next(card for card in session["draft"]["cards"] if card["exerciseId"] == "rope-pushdown")
            assert draft["reps"] == ["12", "11", ""], draft
            page.screenshot(path=str(ARTIFACTS / "iki-pencere.png"))
            other.screenshot(path=str(ARTIFACTS / "iki-pencere-duran.png"))
        finally:
            other.close()

    return [
        ("İkinci pencere açılınca ilki duruyor; ilkinde devam edilince ikincisi duruyor, değerler karışmıyor",
         second_window_takes_over),
    ]


# ---------------------------------------------------------------- Tasarım: sekmeler, ana sayfa, telefon ekranı

# Görünür denetimlerden 44 px'ten küçük olanlar (paragraf içindeki metin bağlantıları hariç).
SMALL_TARGETS_SCRIPT = """
() => [...document.querySelectorAll('a, button, select, input:not([type=radio]), label.chip')]
  .filter((el) => el.getClientRects().length && !el.closest('p'))
  .map((el) => [el, el.getBoundingClientRect()])
  .filter(([, box]) => box.height < 44 || box.width < 44)
  .map(([el, box]) => `${el.outerHTML.slice(0, 80)} → ${Math.round(box.width)}×${Math.round(box.height)}`)
"""

# Sayfanın ve sekme çubuğunun yatay taşması (piksel; 0 ya da eksi değer taşma yok demek).
OVERFLOW_SCRIPT = """
() => {
  const tabs = document.querySelector('.tabs');
  return {
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tabs: tabs ? tabs.scrollWidth - tabs.clientWidth : 0,
  };
}
"""

# (adres, sekme, h1)
MAIN_SCREENS = [
    ("#/", "Ana Sayfa", "Antrenman Takibi"),
    ("#/gecmis", "Geçmiş", "Geçmiş"),
    ("#/ilerleme", "İlerleme", "İlerleme"),
    ("#/ayarlar", "Ayarlar", "Ayarlar"),
]


def current_tab(page):
    return page.locator("nav[aria-label='Ana gezinme'] [aria-current='page']")


def design_steps(run):
    def dark_theme_only(page):
        page.goto(run.base_url + "/")  # tarayıcı açık temada açılıyor (color_scheme="light")
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")
        background = page.evaluate("getComputedStyle(document.body).backgroundColor")
        assert background == "rgb(23, 25, 28)", background
        assert page.get_attribute("meta[name='theme-color']", "content") == "#17191c"

    def tabs_mark_open_screen(page):
        for _, tab, heading in MAIN_SCREENS:
            page.get_by_role("link", name=tab, exact=True).click()
            expect(page.get_by_role("heading", level=1)).to_have_text(heading)
            expect(current_tab(page)).to_have_count(1)
            expect(current_tab(page)).to_have_text(tab)
            expect(page.locator(".back")).to_have_count(0)
        page.goto(run.base_url + "/#/bilinmeyen")  # bilinmeyen adreste de ana sayfa açılır
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")
        expect(current_tab(page)).to_have_text("Ana Sayfa")

    def sub_screens_have_back_links(page):
        open_program(page)
        expect(page.locator(".tabs")).to_have_count(0)
        page.get_by_role("link", name="← Ana Sayfa").click()
        expect(current_tab(page)).to_have_text("Ana Sayfa")
        open_day(page, "push", "Push")
        expect(page.locator(".tabs")).to_have_count(0)
        expect(page.get_by_role("link", name="← Ana Sayfa")).to_be_visible()
        go_home(page)

    def next_card_shows_day_image(page):
        image = page.locator(".next img.day-art")
        expect(image).to_have_attribute("src", "icons/day-push.png")
        expect(image).to_have_attribute("alt", "")
        page.wait_for_function("() => document.querySelector('.next img.day-art').naturalWidth === 264")
        expect(page.locator(".days .day .icon")).to_have_count(5)  # her günün sağında ok

    def keyboard_focus_visible(page):
        page.goto(run.base_url + "/")
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")
        page.keyboard.press("Tab")
        focused = page.evaluate("""() => {
          const el = document.activeElement;
          const style = getComputedStyle(el);
          return { text: el.textContent, style: style.outlineStyle, color: style.outlineColor, width: style.outlineWidth };
        }""")
        assert focused == {"text": "Ana Sayfa", "style": "solid", "color": "rgb(240, 107, 41)", "width": "2px"}, focused

    def fits_phone_widths(page):
        for width in (390, 320):
            page.set_viewport_size({"width": width, "height": 844})
            for address, tab, heading in MAIN_SCREENS:
                page.goto(f"{run.base_url}/{address}")
                expect(page.get_by_role("heading", level=1)).to_have_text(heading)
                overflow = page.evaluate(OVERFLOW_SCRIPT)
                assert overflow["page"] <= 0 and overflow["tabs"] <= 0, f"{width} px, {tab}: yatay taşma {overflow}"
                small = page.evaluate(SMALL_TARGETS_SCRIPT)
                assert not small, f"{width} px, {tab}: 44 px'ten küçük dokunma alanı: {small}"
            if width == 320:
                page.goto(run.base_url + "/")
                expect(page.locator("#next-title")).to_have_text("Push")
                page.screenshot(path=str(ARTIFACTS / "asama11-ana-sayfa-320.png"), full_page=True)
        page.set_viewport_size(PHONE)
        page.goto(run.base_url + "/")
        expect(page.locator("#next-title")).to_have_text("Push")
        page.screenshot(path=str(ARTIFACTS / "asama11-ana-sayfa.png"), full_page=True)
        return "390 ve 320 px"

    def sub_screens_fit_phone_widths(page):
        # Veri: uzun adlı bir makine ve bitmiş bir Push antrenmanı.
        page.goto(run.base_url + "/#/antrenman/push")
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo makinesi uzun adlı bir istasyon 12", "kg")
        log_sets(rope, "40", ["12", "11", "10"])
        finish(page)
        expect(page.locator("#flash")).to_be_visible()
        session_id = sessions(page)[0]["id"]
        pull = next(day for day in stored_program(page)["days"] if day["id"] == "pull")
        rotation_item = next(item for item in pull["items"] if len(item["options"]) > 1)["id"]
        problems = []

        def check(label):
            overflow = page.evaluate(OVERFLOW_SCRIPT)
            small = page.evaluate(SMALL_TARGETS_SCRIPT)
            width = page.viewport_size["width"]
            if overflow["page"] > 0 or overflow["tabs"] > 0:
                problems.append(f"{width} px, {label}: yatay taşma {overflow}")
            if small:
                problems.append(f"{width} px, {label}: 44 px'ten küçük dokunma alanı {small}")

        for width in (320, 390):
            page.set_viewport_size({"width": width, "height": 844})
            page.goto(run.base_url + "/#/antrenman/push")
            rope = card(page, "Rope Pushdown")
            rope.get_by_role("button", name="Düzenle").click()
            expect(rope.locator(".machine-list li")).to_have_count(1)
            check("antrenman, makine listesi")
            rope.get_by_role("button", name="Bitti").click()
            card(page, "Cable Fly").get_by_role("button", name="+ Makine").click()
            check("antrenman, makine formu")
            card(page, "Cable Fly").get_by_role("button", name="Vazgeç").click()
            page.get_by_role("button", name="+ Hareket ekle").click()
            check("antrenman, hareket ekleme formu")
            page.get_by_role("button", name="Vazgeç").click()
            page.goto(f"{run.base_url}/#/gecmis/{session_id}")
            expect(page.locator(".entry")).to_have_count(1)
            check("geçmiş ayrıntısı")
            page.goto(f"{run.base_url}/#/gecmis/{session_id}/duzenle")
            expect(page.locator(".topbar h1")).to_contain_text("Push · ")
            check("geçmiş düzenleme")
            page.goto(run.base_url + "/#/gecmis")
            expect(page.locator(".history .day")).to_have_count(1)
            check("geçmiş listesi")
            page.goto(run.base_url + "/#/ilerleme/push/rope-pushdown")
            expect(page.locator(".readout-value")).to_be_visible()
            check("ilerleme grafiği")
            page.goto(run.base_url + "/#/program")
            page.get_by_role("button", name="+ Gün ekle").click()
            check("program, gün formu")
            page.goto(run.base_url + "/#/program/pull")
            expect(page.get_by_role("heading", level=1)).to_have_text("Pull")
            check("gün")
            page.goto(f"{run.base_url}/#/program/pull/{rotation_item}")
            page.get_by_role("button", name="Adı düzelt").first.click()
            check("satır, ad düzeltme")
            page.goto(run.base_url + "/#/antrenman/pull")
            expect(page.locator(".topbar h1")).to_have_text("Pull")
            check("antrenman, dönüşümlü satır")
        page.set_viewport_size(PHONE)
        assert not problems, "\n".join(problems)
        return "12 ekran durumu, 390 ve 320 px"

    def layout_rules(page):
        # Önceki adımda bugün bitirilen Push antrenmanı: ay başlığı ve tarih rozeti kayıttan gelir.
        page.goto(run.base_url + "/#/gecmis")
        month = page.evaluate("new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date())")
        expect(page.locator(".month-title")).to_have_text([month])
        row = page.locator(".history .day")
        expect(row.locator(".date-badge-day")).to_have_text(str(page.evaluate("new Date().getDate()")))
        expect(row.locator(".day-name")).to_have_text("Push")
        page.screenshot(path=str(ARTIFACTS / "asama11-gecmis.png"))

        # Silme ve sıfırlama: ana eylemden en az 24 px aşağıda ve tam genişlikte; ekleme düğmeleri tam genişlikte.
        content = page.locator("main").evaluate("(el) => el.clientWidth - 2 * parseFloat(getComputedStyle(el).paddingLeft)")

        def full_width(locator):
            width = locator.bounding_box()["width"]
            assert abs(width - content) < 1, f"{width} ≠ {content}"

        def below(upper, lower):
            gap = lower.bounding_box()["y"] - (upper.bounding_box()["y"] + upper.bounding_box()["height"])
            assert gap >= 24, f"aradaki boşluk {gap} px"
            full_width(lower)

        row.click()
        below(page.get_by_role("link", name="Düzenle"), page.get_by_role("button", name="Sil"))
        page.screenshot(path=str(ARTIFACTS / "asama11-gecmis-ayrinti.png"), full_page=True)
        page.goto(run.base_url + "/#/antrenman/push")
        full_width(page.get_by_role("button", name="+ Hareket ekle"))
        below(page.get_by_role("button", name="+ Hareket ekle"), page.get_by_role("button", name="Antrenmanı iptal et"))
        page.goto(run.base_url + "/#/program")
        full_width(page.get_by_role("button", name="+ Gün ekle"))
        page.goto(run.base_url + "/#/program/push")
        full_width(page.get_by_role("link", name="+ Satır ekle"))
        below(page.get_by_role("link", name="+ Satır ekle"), page.get_by_role("button", name="Günü sil"))
        program_rows(page).first.click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Satırı düzenle")
        below(page.locator("form[data-form='item']"), page.get_by_role("button", name="Satırı sil"))

        # Ayarlar: kart başlıklarında simge (yedek için indirme; bulut yok), başlık adı yazıdan.
        page.goto(run.base_url + "/#/ayarlar")
        expect(page.locator(".card-title .icon")).to_have_count(3)
        expect(page.get_by_role("heading", name="Yedek", exact=True)).to_be_visible()
        page.screenshot(path=str(ARTIFACTS / "asama11-ayarlar.png"), full_page=True)

    return [
        ("Yalnızca koyu tema: telefon açık temadayken de zemin antrasit", dark_theme_only),
        ("Sekmeler açık ekranı gösteriyor; bilinmeyen adreste Ana Sayfa seçili", tabs_mark_open_screen),
        ("Alt ekranlarda sekme yok, \"← Ana Sayfa\" var", sub_screens_have_back_links),
        ("Sıradaki kartında günün görseli; gün listesinde oklar", next_card_shows_day_image),
        ("Klavyeyle ilk odak sekmede ve odak halkası görünüyor", keyboard_focus_visible),
        ("Ana ekranlar 390 ve 320 px'te taşmıyor; dokunma alanları en az 44 px", fits_phone_widths),
        ("Alt ekranlar ve formlar da 390 ve 320 px'te taşmıyor; dokunma alanları en az 44 px", sub_screens_fit_phone_widths),
        ("Geçmiş ay başlığı ve tarih rozetiyle; silme düğmeleri ana eylemden ayrı ve tam genişlikte; Ayarlar simgeleri", layout_rules),
    ]


# ---------------------------------------------------------------- Uygulama gibi geçmiş ve kaydırma

def history_length(page):
    return page.evaluate("history.length")


def history_and_swipe_steps(run):
    def tabs_keep_history_short(page):
        page.goto(run.base_url + "/")
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")
        start = history_length(page)
        for tab in ["Geçmiş", "İlerleme", "Ayarlar", "Geçmiş", "İlerleme", "Ayarlar"]:
            page.get_by_role("link", name=tab, exact=True).click()
            expect(current_tab(page)).to_have_text(tab)
        assert history_length(page) == start + 1, f"{start} → {history_length(page)}"  # yalnızca Ana Sayfa'dan ilk geçiş
        page.go_back()  # telefonun geri hareketi: sekmedeyken Ana Sayfa'ya döner
        expect(current_tab(page)).to_have_text("Ana Sayfa")
        page.get_by_role("link", name="İlerleme", exact=True).click()
        page.get_by_role("link", name="Ana Sayfa", exact=True).click()  # Ana Sayfa sekmesi geri gider
        expect(current_tab(page)).to_have_text("Ana Sayfa")
        assert history_length(page) == start + 1, f"{start} → {history_length(page)}"
        return f"6 sekme değişiminden sonra {start + 1} kayıt"

    def back_links_go_back(page):
        open_program(page)
        page.locator(".program-list .program-link").first.click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Push")
        program_rows(page).first.click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Satırı düzenle")
        deep = history_length(page)
        page.get_by_role("link", name="← Push").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Push")
        page.get_by_role("link", name="← Program").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Program")
        page.get_by_role("link", name="← Ana Sayfa").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")
        assert history_length(page) == deep, f"{deep} → {history_length(page)}"
        page.go_forward()  # "←" gerçekten geri gitti: ileride Program duruyor
        expect(page.get_by_role("heading", level=1)).to_have_text("Program")
        page.get_by_role("link", name="← Ana Sayfa").click()
        expect(page.get_by_role("heading", level=1)).to_have_text("Antrenman Takibi")

    def finish_returns_back(page):
        open_day(page, "push", "Push")
        before = history_length(page)
        rope = card(page, "Rope Pushdown")
        add_machine(rope, "Kablo", "kg")
        log_sets(rope, "40", ["12"])
        finish(page)
        expect(page.locator("#flash")).to_have_text("Push antrenmanı kaydedildi ✓")
        expect(current_tab(page)).to_have_text("Ana Sayfa")
        assert history_length(page) == before, f"{before} → {history_length(page)}"

    def swipe_switches_tabs(page):
        cdp = page.context.new_cdp_session(page)

        def drag(x0, x1, y0=420, y1=None):  # Chrome'a gerçek parmak hareketi gönderilir; parmak ekranda kalır
            y1 = y0 if y1 is None else y1
            points = [{"x": x0 + (x1 - x0) * step / 6, "y": y0 + (y1 - y0) * step / 6} for step in range(7)]
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [points[0]]})
            for point in points[1:]:
                cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [point]})

        def lift(pause=0):  # parmak kalkar; pause: önce parmak bir süre durur (fırlatma sayılmaz)
            page.wait_for_timeout(pause)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

        def swipe(x0, x1, y0=420, y1=None):
            drag(x0, x1, y0, y1)
            lift()

        def stays(tab):
            page.wait_for_timeout(400)
            expect(current_tab(page)).to_have_text(tab)

        def content_x():  # içeriğin (başlık ve sekmeler hariç) yatay kayması
            return page.evaluate(
                "new DOMMatrix(getComputedStyle(document.querySelector('#app > div > :not(.app-head)')).transform).m41"
            )

        def indicator_x():
            return page.evaluate("new DOMMatrix(document.querySelector('.tab-indicator').style.transform).m41")

        start = history_length(page)

        # Sürüklerken içerik ve sekme çizgisi parmağı izler; başlık yerinde kalır; az sürükleyince yerine döner.
        home_x = page.evaluate("document.querySelector('.tabs [aria-current]').offsetLeft")
        drag(300, 240)
        assert -61 < content_x() < -59, content_x()
        expect(page.locator(".tabs.moving .tab-indicator")).to_be_visible()
        assert indicator_x() > home_x, (indicator_x(), home_x)  # Geçmiş'e doğru yol aldı
        assert page.evaluate("getComputedStyle(document.querySelector('.app-head')).transform") == "none"
        lift(pause=200)
        stays("Ana Sayfa")
        assert content_x() == 0, content_x()
        expect(page.locator(".tabs.moving")).to_have_count(0)

        # Yatay harekette sayfa dikey kaymaz; dikey harekette olağan kayar ve sekme değişmez.
        page.set_viewport_size({"width": 390, "height": 560})
        drag(300, 230, 420, 370)
        assert page.evaluate("scrollY") == 0, page.evaluate("scrollY")
        lift(pause=200)
        stays("Ana Sayfa")
        drag(200, 205, 450, 250)
        lift()
        stays("Ana Sayfa")
        assert page.evaluate("scrollY") > 0, "dikey hareket sayfayı kaydırmalı"
        page.evaluate("scrollTo(0, 0)")
        page.set_viewport_size(PHONE)

        # Uçta (Ana Sayfa'da sağa) içerik parmağın gerisinde kalır, bırakınca yerine döner.
        drag(100, 220)
        assert 30 < content_x() < 40, content_x()
        lift()
        stays("Ana Sayfa")
        assert content_x() == 0, content_x()

        # Sekmeye dokununca çizgi eski sekmeden yenisine kayar (kayma süresi test için uzatıldı).
        slow = page.add_style_tag(content=":root { --duration-slide: 1500ms; }")
        page.get_by_role("link", name="Geçmiş", exact=True).click()
        expect(current_tab(page)).to_have_text("Geçmiş")
        expect(page.locator(".tabs.moving .tab-indicator.animate")).to_be_visible()
        slow.evaluate("(element) => element.remove()")
        expect(page.locator(".tabs.moving")).to_have_count(0, timeout=3000)

        # "Hareketi azalt" açıkken içerik sürüklenmez; bırakınca doğrudan geçer.
        page.emulate_media(reduced_motion="reduce")
        drag(300, 150)
        assert content_x() == 0, content_x()
        lift()
        expect(current_tab(page)).to_have_text("İlerleme")
        page.emulate_media(reduced_motion="no-preference")
        page.get_by_role("link", name="Ana Sayfa", exact=True).click()
        expect(current_tab(page)).to_have_text("Ana Sayfa")
        for tab in ["Geçmiş", "İlerleme", "Ayarlar"]:
            swipe(300, 100)  # parmak sola: sıradaki sekme
            expect(current_tab(page)).to_have_text(tab)
        swipe(300, 100)
        stays("Ayarlar")  # sonda bir şey olmaz
        swipe(100, 300)  # parmak sağa: önceki sekme
        expect(current_tab(page)).to_have_text("İlerleme")
        swipe(8, 250)
        stays("İlerleme")  # ekranın kenarından başlayan kaydırma telefonundur
        swipe(300, 200, 300, 500)
        stays("İlerleme")  # çoğunlukla dikey: liste kaydırılıyor, sekme değişmez
        for tab in ["Geçmiş", "Ana Sayfa"]:
            swipe(100, 300)
            expect(current_tab(page)).to_have_text(tab)
        swipe(100, 300)
        stays("Ana Sayfa")
        assert history_length(page) <= start + 1, f"{start} → {history_length(page)}"
        assert page.evaluate("getComputedStyle(document.documentElement).overscrollBehaviorX") == "none"
        open_program(page)
        swipe(300, 100)
        page.wait_for_timeout(300)
        expect(page.get_by_role("heading", level=1)).to_have_text("Program")  # alt ekranda kaydırma yok

    return [
        ("Sekmeler arasında gidip gelmek geçmişi büyütmüyor; sekmedeyken geri hareketi Ana Sayfa'ya dönüyor", tabs_keep_history_short),
        ("\"←\" bağlantıları gerçekten geri gidiyor; geçmiş büyümüyor", back_links_go_back),
        ("'Bitir' Ana Sayfa'ya geri dönüyor; geçmiş büyümüyor", finish_returns_back),
        ("Parmakla kaydırma: içerik ve sekme çizgisi parmağı izliyor, az sürükleyince yerine dönüyor, uçta esniyor; "
         "yatay harekette sayfa dikey kaymıyor; kenardan, dikey ve alt ekranda sekme değişmiyor; dokununca çizgi kayıyor", swipe_switches_tabs),
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
            run.flow("Tasarım: sekmeler, ana sayfa, telefon ekranı", design_steps(run))
            run.flow("Uygulama gibi geçmiş ve kaydırma", history_and_swipe_steps(run), has_touch=True)
            run.flow("Push antrenmanı", push_workout_steps(run), init_script=FAIL_WRITES_SCRIPT)
            run.flow("Otomatik kaydetme ve devam eden antrenman", autosave_steps(run), init_script=FAIL_WRITES_SCRIPT)
            run.flow("Bitir ve İptal sürerken ekrandan çıkış", ending_while_leaving_steps(run),
                     init_script=FAIL_WRITES_LATER_SCRIPT)
            run.flow("IndexedDB bağlantısı kapanınca", connection_steps(run), init_script=CONNECTION_SCRIPT)
            run.flow("Yedekleme", backup_steps(run), init_script=FAIL_WRITES_SCRIPT)
            run.flow("Makine silme ve ilerleme sayacı", machines_and_counter_steps(run))
            run.flow("Dönüşümlü hareket önerisi", rotation_steps(run))
            run.flow("Geçmiş ve düzeltme", history_steps(run))
            run.flow("İlerleme grafikleri", progress_steps(run))
            run.flow("Program düzenleyici", program_editor_steps(run))
            run.flow("Makine yönetimi ve hareket ekleme", machine_management_steps(run))
            run.flow("İnternetsiz çalışma", offline_steps(run))
            run.flow("Yeni sürüm ve güncelleme", update_steps(copy_url, app_copy), init_script=FAIL_WRITES_SCRIPT)
            run.flow("Günler ayrı, makineler harekete ait", day_separation_steps(run))
            run.flow("Hedef kopyası", target_copy_steps(run))
            run.flow("Aşama 1 verisinden yükseltme", upgrade_steps(run))
            run.flow("Aşama 2 verisinden yükseltme", phase2_upgrade_steps(run))
            run.flow("Yükseltmede yazma hatası ve devam eden antrenman", upgrade_resilience_steps(run),
                     init_script=FAIL_WRITES_ON_OPEN_SCRIPT)
            run.flow("Aynı anda iki pencere", instance_steps(run))
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
