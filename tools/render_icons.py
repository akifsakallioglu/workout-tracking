"""Uygulama simgelerini icons/icon-source.png'den üretir (kurulu Chrome ile).

Çalıştırma (proje klasöründe):
    .venv\\Scripts\\python tools\\render_icons.py

Kaynak görsel kare olmalı ve zemini kenarlara kadar dolu olmalı; çizim ortadaki %80'lik alanda
durmalı (Android ve iPhone köşeleri kendisi keser).
"""
import base64
from pathlib import Path

from playwright.sync_api import sync_playwright

ICONS = Path(__file__).resolve().parent.parent / "icons"
SOURCE = ICONS / "icon-source.png"

# (hedef PNG, boyut, köşeler yuvarlatılıp saydam mı)
TARGETS = [
    ("icon-192.png", 192, True),
    ("icon-512.png", 512, True),
    ("icon-maskable-512.png", 512, False),
    ("apple-touch-icon.png", 180, False),
]


def main():
    image = "data:image/png;base64," + base64.b64encode(SOURCE.read_bytes()).decode("ascii")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        for target, size, rounded in TARGETS:
            page = browser.new_page(viewport={"width": size, "height": size})
            radius = "22%" if rounded else "0"
            page.set_content(
                "<style>html,body{margin:0;background:transparent}"
                f"img{{display:block;width:100vw;height:100vh;border-radius:{radius}}}</style>"
                f'<img src="{image}" alt="">'
            )
            page.wait_for_function("document.querySelector('img').complete")
            page.screenshot(path=str(ICONS / target), omit_background=rounded)
            page.close()
            print(f"{target} ({size}×{size})")
        browser.close()


if __name__ == "__main__":
    main()
