import http.server
import socketserver
import signal
import sys
import socket

PORT = 8000

def get_local_ip():
    """
    Tries to find the local IP address of the machine.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1' # Fallback to localhost
    finally:
        s.close()
    return IP

class SecureMimeServerHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.mjs': 'application/javascript',
        '.wasm': 'application/wasm',
    }

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

with socketserver.TCPServer(("", PORT), SecureMimeServerHandler) as httpd:
    def signal_handler(sig, frame):
        print("\n👋 Ctrl+C received, shutting down the server...")
        httpd.server_close()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)

    # --- NEW: Get and display network IP ---
    host_ip = get_local_ip()
    
    print("✅ Secure server started!")
    print("🚀 Press Ctrl+C to stop the server.")
    print("\n--- To access the app ---")
    print(f"  > On this computer:  http://localhost:{PORT}/tts_app.html")
    print(f"  > On other devices in your network: http://{host_ip}:{PORT}/tts_app.html")
    print("-------------------------")

    httpd.serve_forever()