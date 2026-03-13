#!/usr/bin/env python3
"""静的ファイル配信 + schedule.json REST API サーバー"""

import datetime
import json
import os
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

try:
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import Flow
    from googleapiclient.discovery import build
    GCAL_AVAILABLE = True
except ImportError:
    GCAL_AVAILABLE = False

SCHEDULE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schedule.json")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLIENT_SECRET_PATH = os.path.join(BASE_DIR, "client_secret.json")
TOKEN_PATH = os.path.join(BASE_DIR, "token.json")
CODE_VERIFIER_PATH = os.path.join(BASE_DIR, ".code_verifier")
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
REDIRECT_URI = "http://localhost:8000/api/gcal/callback"


class ScheduleHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/schedule":
            self._send_schedule()
        elif self.path == "/api/gcal/auth":
            self._gcal_auth()
        elif self.path.startswith("/api/gcal/callback"):
            self._gcal_callback()
        elif self.path == "/api/gcal":
            self._send_gcal_events()
        else:
            super().do_GET()

    def do_PUT(self):
        if self.path == "/api/schedule":
            self._save_schedule()
        else:
            self.send_error(404)

    # ---- Response helpers ----

    def _send_json(self, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json_error(self, code, msg):
        body = json.dumps({"error": msg}, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html_message(self, title, body_html):
        html = f"<html><head><title>{title}</title></head><body>{body_html}</body></html>"
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    # ---- Schedule ----

    def _send_schedule(self):
        try:
            with open(SCHEDULE_PATH, "r", encoding="utf-8") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(data.encode("utf-8"))
        except FileNotFoundError:
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"events":[],"categories":{}}')

    def _save_schedule(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        try:
            data = json.loads(body)
            with open(SCHEDULE_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))
        except (json.JSONDecodeError, ValueError) as e:
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

    # ---- Google Calendar ----

    def _get_gcal_credentials(self):
        if not GCAL_AVAILABLE:
            return None
        if not os.path.exists(TOKEN_PATH):
            return None
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
            if creds and creds.expired and creds.refresh_token:
                from google.auth.transport.requests import Request
                creds.refresh(Request())
                with open(TOKEN_PATH, "w") as f:
                    f.write(creds.to_json())
            return creds if creds and creds.valid else None
        except Exception:
            return None

    def _gcal_auth(self):
        if not GCAL_AVAILABLE:
            self._send_json_error(503, "Google API ライブラリがインストールされていません")
            return
        if not os.path.exists(CLIENT_SECRET_PATH):
            self._send_json_error(503, "client_secret.json が見つかりません")
            return
        try:
            flow = Flow.from_client_secrets_file(
                CLIENT_SECRET_PATH,
                scopes=SCOPES,
                redirect_uri=REDIRECT_URI,
            )
            auth_url, _ = flow.authorization_url(
                access_type="offline",
                prompt="consent",
            )
            if flow.code_verifier:
                with open(CODE_VERIFIER_PATH, "w") as f:
                    f.write(flow.code_verifier)
            self.send_response(302)
            self.send_header("Location", auth_url)
            self.end_headers()
        except Exception as e:
            self._send_json_error(500, str(e))

    def _gcal_callback(self):
        if not GCAL_AVAILABLE:
            self._send_html_message("エラー", "<p>Google API ライブラリがインストールされていません</p>")
            return
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        code_list = params.get("code")
        if not code_list:
            self._send_html_message("エラー", "<p>認証コードが見つかりません</p>")
            return
        try:
            code_verifier = None
            if os.path.exists(CODE_VERIFIER_PATH):
                with open(CODE_VERIFIER_PATH, "r") as f:
                    code_verifier = f.read().strip()
                os.remove(CODE_VERIFIER_PATH)
            flow = Flow.from_client_secrets_file(
                CLIENT_SECRET_PATH,
                scopes=SCOPES,
                redirect_uri=REDIRECT_URI,
            )
            if code_verifier:
                flow.code_verifier = code_verifier
            flow.fetch_token(code=code_list[0])
            creds = flow.credentials
            with open(TOKEN_PATH, "w") as f:
                f.write(creds.to_json())
            self.send_response(302)
            self.send_header("Location", "/")
            self.end_headers()
        except Exception as e:
            self._send_html_message("エラー", f"<p>認証に失敗しました: {e}</p>")

    def _send_gcal_events(self):
        if not GCAL_AVAILABLE:
            self._send_json_error(503, "Google API ライブラリがインストールされていません")
            return
        creds = self._get_gcal_credentials()
        if creds is None:
            self._send_json_error(401, "認証が必要です")
            return
        try:
            service = build("calendar", "v3", credentials=creds)
            now = datetime.datetime.utcnow()
            time_min = (now - datetime.timedelta(days=90)).isoformat() + "Z"
            time_max = (now + datetime.timedelta(days=90)).isoformat() + "Z"
            result = service.events().list(
                calendarId="primary",
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
                maxResults=500,
            ).execute()
            items = result.get("items", [])
            events = []
            for item in items:
                events.extend(self._convert_gcal_event(item))
            self._send_json({"events": events})
        except Exception as e:
            self._send_json_error(500, str(e))

    def _convert_gcal_event(self, item):
        gcal_id = item.get("id", "")
        title = item.get("summary", "(タイトルなし)")
        start = item.get("start", {})
        end = item.get("end", {})
        note = item.get("description", "")

        if "date" in start:
            # 終日イベント（end.date は exclusive なので前日まで展開）
            start_date = datetime.date.fromisoformat(start["date"])
            end_date = datetime.date.fromisoformat(end["date"])
            results = []
            current = start_date
            while current < end_date:
                results.append({
                    "id": f"gcal_{gcal_id}_{current.isoformat()}",
                    "title": title,
                    "date": current.isoformat(),
                    "startTime": "00:00",
                    "endTime": "23:59",
                    "category": "google",
                    "note": note,
                    "source": "gcal",
                })
                current += datetime.timedelta(days=1)
            return results
        else:
            # 時刻付きイベント
            dt_start = datetime.datetime.fromisoformat(start["dateTime"])
            dt_end = datetime.datetime.fromisoformat(end["dateTime"])
            return [{
                "id": f"gcal_{gcal_id}",
                "title": title,
                "date": dt_start.strftime("%Y-%m-%d"),
                "startTime": dt_start.strftime("%H:%M"),
                "endTime": dt_end.strftime("%H:%M"),
                "category": "google",
                "note": note,
                "source": "gcal",
            }]


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = 8000
    server = HTTPServer(("", port), ScheduleHandler)
    print(f"サーバー起動: http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを停止しました")
        server.server_close()
