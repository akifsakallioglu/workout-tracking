"""Geliştirme sunucusu.

Kullanım (proje klasöründe):
    python serve.py          # yalnızca bu bilgisayar: http://127.0.0.1:8000
    python serve.py --lan    # aynı Wi-Fi'deki telefon da açabilir
    python serve.py 9000     # başka bir port

`python -m http.server` yerine bu dosyanın kullanılma nedenleri:
- Dosyalar önbelleğe alınmaz; kod değişince sayfayı yenilemek yeter.
- .js ve .webmanifest dosyaları her Windows'ta doğru türle sunulur.
- Adı nokta ile başlayan klasör ve dosyalar (.git, .venv) sunulmaz.
- Varsayılan olarak yalnızca bu bilgisayardan erişilir.
"""
import functools
import http.server
import socket
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
    }

    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        if any(part.startswith(".") for part in path.split("/") if part):
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class QuietHandler(Handler):
    def log_message(self, format, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # Tarayıcı bağlantıyı erken kapatırsa (sekme kapandı vb.) uzun hata çıktısı basma.
        if isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def make_server(host="127.0.0.1", port=8000, quiet=False, directory=ROOT):
    handler_class = QuietHandler if quiet else Handler
    handler = functools.partial(handler_class, directory=str(directory))
    return Server((host, port), handler)


def lan_ip():
    # UDP soketi bağlanınca paket gönderilmez; yalnızca yerel ağ adresini öğrenmek için kullanılır.
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("10.255.255.255", 1))
        return sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    lan = "--lan" in argv
    ports = [arg for arg in argv if arg.isdigit()]
    port = int(ports[0]) if ports else 8000
    server = make_server("0.0.0.0" if lan else "127.0.0.1", port)
    print(f"Sunucu çalışıyor: http://127.0.0.1:{port}")
    if lan:
        ip = lan_ip()
        if ip:
            print(f"Telefondan (aynı Wi-Fi): http://{ip}:{port}")
    print("Durdurmak için Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSunucu durduruldu.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main(sys.argv[1:])
