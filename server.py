import os
import json
import socket
import time
import re
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = int(os.environ.get('PORT', 5177))
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'promptxadmin')
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

# Default initial state templates
DEFAULTS = {
    'event': {
        'stage': 'WAITING',
        'scenario': '',
        'scenarioRevealed': False,
        'joiningCode': 'PROMPTX2026',
        'timer': {'duration': 1800, 'remaining': 1800, 'isRunning': False},
        'config': {'maxGenerations': 5, 'allowRegen': True, 'maxPromptLength': 2000, 'maxStoryLength': 5000},
        'leaderboardRevealed': False
    },
    'participants': {},
    'prompts': {},
    'stories': {},
    'twists': [],
    'submissions': {},
    'judging': {}
}

def init_data():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR, exist_ok=True)
    for key, val in DEFAULTS.items():
        file_path = os.path.join(DATA_DIR, f"{key}.json")
        if not os.path.exists(file_path):
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(val, f, indent=2)

def read_json(key):
    file_path = os.path.join(DATA_DIR, f"{key}.json")
    try:
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"[Python DataManager] Error reading {key}.json:", e)
    return DEFAULTS.get(key, {})

def write_json(key, data):
    file_path = os.path.join(DATA_DIR, f"{key}.json")
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        print(f"[Python DataManager] Error writing {key}.json:", e)
        return False

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "192.168.x.x"

init_data()

class PromptXRequestHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/health'):
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = {'status': 'ok', 'event': read_json('event')}
            self.wfile.write(json.dumps(response).encode('utf-8'))
            return
        
        if self.path.startswith('/api/state'):
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            state = {
                'event': read_json('event'),
                'participants': read_json('participants'),
                'prompts': read_json('prompts'),
                'stories': read_json('stories'),
                'twists': read_json('twists'),
                'submissions': read_json('submissions'),
                'judging': read_json('judging')
            }
            self.wfile.write(json.dumps(state).encode('utf-8'))
            return

        return super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            payload = json.loads(body_bytes.decode('utf-8'))
        except Exception:
            payload = {}

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        if self.path == '/api/join':
            name = payload.get('name', '').strip()
            code = payload.get('code', '').strip()
            event = read_json('event')
            if code != event.get('joiningCode', 'PROMPTX2026'):
                self.wfile.write(json.dumps({'success': False, 'message': 'Invalid joining code'}).encode('utf-8'))
                return
            
            p_id = f"p_{re.sub(r'[^a-z0-9]', '_', name.lower())}"
            participants = read_json('participants')
            participants[p_id] = {
                'id': p_id,
                'name': name,
                'status': 'idle',
                'locked': False,
                'lastActivity': time.strftime('%Y-%m-%dT%H:%M:%SZ')
            }
            write_json('participants', participants)
            self.wfile.write(json.dumps({'success': True, 'participant': participants[p_id]}).encode('utf-8'))
            return

        self.wfile.write(json.dumps({'success': True}).encode('utf-8'))

def run_server():
    local_ip = get_local_ip()
    print("\n==================================================")
    print("PROMPTX PYTHON SERVER STARTED SUCCESSFULLY")
    print("==================================================")
    print(f"LOCAL ACCESS:   http://localhost:{PORT}")
    print(f"NETWORK ACCESS: http://{local_ip}:{PORT}")
    print("--------------------------------------------------")
    print(f"Admin Password: {ADMIN_PASSWORD}")
    print("==================================================\n")
    
    server_address = ('0.0.0.0', PORT)
    httpd = HTTPServer(server_address, PromptXRequestHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping PROMPTX Python server...")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
