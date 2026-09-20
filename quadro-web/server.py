#!/usr/bin/env python3
"""
Servidor estático simples para testar a interface localmente.

Diferente de `python3 -m http.server`, este servidor entende que
qualquer caminho no formato /q/{token} deve carregar index.html
(o roteamento real do token acontece no navegador, via app.js).
Isso simula o que um servidor real faria com uma rota como
GET /q/{frame_token}.

Uso:
    python3 server.py 8080

Depois acesse:
    http://localhost:8080/q/demo-frame
"""

import re
import sys
from http.server import SimpleHTTPRequestHandler, HTTPServer

# Casa SOMENTE /q/{token} (um único segmento, sem sub-caminho).
# Assim, /q/demo-frame vira index.html, mas /style.css e /app.js
# (pedidos com caminho absoluto pelo navegador) continuam servindo
# os arquivos reais em vez de serem engolidos por essa regra.
FRAME_ROUTE = re.compile(r"^/q/[^/]+/?$")


class FrameRoutingHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path_only = self.path.split("?")[0]
        if FRAME_ROUTE.match(path_only):
            self.path = "/index.html"
        return super().do_GET()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(("localhost", port), FrameRoutingHandler)
    print(f"Servindo em http://localhost:{port}")
    print(f"Teste em   http://localhost:{port}/q/demo-frame  (senha: 1234)")
    server.serve_forever()


if __name__ == "__main__":
    main()
