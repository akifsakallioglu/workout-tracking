"""Simgeleri SVG'den PNG'ye çevirir (kurulu Chrome ile).

Çalıştırma (proje klasöründe):
    .venv\\Scripts\\python tools\\render_icons.py
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

ICONS = Path(__file__).resolve().parent.parent / "icons"

# (kaynak SVG, hedef PNG, boyut, saydam arka plan)
TARGETS = [
    ("icon.svg", "icon-192.png", 192, True),
    ("icon.svg", "icon-512.png", 512, True),
    ("icon-maskable.svg", "icon-maskable-512.png", 512, False),
    ("icon-maskable.svg", "apple-touch-icon.png", 180, False),
]


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        for source, target, size, transparent in TARGETS:
            page = browser.new_page(viewport={"width": size, "height": size})
            svg = (ICONS / source).read_text(encoding="utf-8")
            page.set_content(
                "<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>" + svg
            )
            page.screenshot(path=str(ICONS / target), omit_background=transparent)
            page.close()
            print(f"{target} ({size}×{size})")
        browser.close()


if __name__ == "__main__":
    main()
