"""Ana sayfadaki gün görsellerini üretir (kurulu Chrome ile).

Çalıştırma (proje klasöründe):
    .venv\\Scripts\\python tools\\render_day_images.py

Kaynaklar .claude/skills/workout-ui/references/<gün>.png: kullanıcının seçtiği, zemini saydam
görseller (1254 px). Çıktılar icons/day-<gün>.png: kartta 88 px gösterilir; telefon ekranlarında
net dursun diye 3 katı (264 px) üretilir. Kaynaklar uygulamaya konmaz; her biri 150–540 KB'tır.
Yeni bir gün görseli eklenirse sw.js FILES listesine de yazılır.
"""
import base64
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / ".claude" / "skills" / "workout-ui" / "references"
ICONS = ROOT / "icons"
DAYS = ["push", "pull", "legs", "upper", "lower"]  # başlangıç programındaki gün kimlikleri
SIZE = 264


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": SIZE, "height": SIZE})
        for day in DAYS:
            image = "data:image/png;base64," + base64.b64encode((SOURCES / f"{day}.png").read_bytes()).decode("ascii")
            page.set_content(
                "<style>html,body{margin:0;background:transparent}"
                "img{display:block;width:100vw;height:100vh}</style>"
                f'<img src="{image}" alt="">'
            )
            page.wait_for_function("document.querySelector('img').complete")
            target = ICONS / f"day-{day}.png"
            page.screenshot(path=str(target), omit_background=True)  # saydam zemin korunur
            print(f"{target.name} ({SIZE}×{SIZE}, {target.stat().st_size // 1024} KB)")
        browser.close()


if __name__ == "__main__":
    main()
