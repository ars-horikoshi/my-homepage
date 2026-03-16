#!/usr/bin/env python3
"""静的ファイル配信 + schedule.json REST API サーバー"""

import datetime
import email as email_lib
import http.cookies
import imaplib
import json
import os
import secrets
import urllib.parse
from email.header import decode_header
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
GMAIL_TOKEN_PATH = os.path.join(BASE_DIR, "gmail_token.json")
GMAIL_REDIRECT_URI = "http://localhost:8000/api/gmail/callback"
GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
GMAIL_STATE_PATH = os.path.join(BASE_DIR, ".gmail_state")
CODE_VERIFIER_PATH = os.path.join(BASE_DIR, ".code_verifier")
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
REDIRECT_URI = "http://localhost:8000/api/gcal/callback"
AUTH_REDIRECT_URI = "http://localhost:8000/api/auth/callback"
AUTH_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email"]
ALLOWED_EMAIL = "t-horikoshi@ar-system.co.jp"
AUTH_STATE_PATH = os.path.join(BASE_DIR, ".auth_state")
AUTH_CODE_VERIFIER_PATH = os.path.join(BASE_DIR, ".auth_code_verifier")
AUTH_AVAILABLE = GCAL_AVAILABLE and os.path.exists(CLIENT_SECRET_PATH)

# メモリ内セッションストア: token -> True
_sessions: dict[str, bool] = {}


class ScheduleHandler(SimpleHTTPRequestHandler):
    # ---- Auth helpers ----

    def _get_session_token(self):
        cookie_header = self.headers.get("Cookie", "")
        if not cookie_header:
            return None
        jar = http.cookies.SimpleCookie()
        jar.load(cookie_header)
        morsel = jar.get("session")
        return morsel.value if morsel else None

    def _is_authenticated(self):
        if not AUTH_AVAILABLE:
            return True  # client_secret.json がない場合は認証スキップ
        token = self._get_session_token()
        return token is not None and _sessions.get(token, False)

    def _require_auth(self):
        """未認証なら True を返しレスポンスを送信済み、認証済みなら False を返す"""
        if self._is_authenticated():
            return False
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/"):
            self._send_json_error(401, "Unauthorized")
        else:
            self.send_response(302)
            self.send_header("Location", "/login.html")
            self.end_headers()
        return True

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        # ログインページと認証 API は認証不要
        if path in ("/login", "/login.html", "/api/auth/login", "/api/auth/callback"):
            if path == "/api/auth/login":
                self._auth_login()
            elif path == "/api/auth/callback":
                self._auth_callback()
            else:
                super().do_GET()
            return
        if self._require_auth():
            return

        if self.path == "/api/schedule":
            self._send_schedule()
        elif self.path == "/api/gcal/auth":
            self._gcal_auth()
        elif self.path.startswith("/api/gcal/callback"):
            self._gcal_callback()
        elif self.path == "/api/gcal":
            self._send_gcal_events()
        elif self.path == "/api/mail":
            self._send_mail_list()
        elif self.path == "/api/gmail/auth":
            self._gmail_auth()
        elif self.path.startswith("/api/gmail/callback"):
            self._gmail_callback()
        elif self.path == "/api/gmail":
            self._send_gmail_messages()
        else:
            super().do_GET()

    def do_PUT(self):
        if self._require_auth():
            return
        if self.path == "/api/schedule":
            self._save_schedule()
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/api/logout":
            self._handle_logout()
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

    # ---- Google Auth Login / Logout ----

    def _auth_login(self):
        if not GCAL_AVAILABLE:
            self._send_json_error(503, "Google API ライブラリがインストールされていません")
            return
        if not os.path.exists(CLIENT_SECRET_PATH):
            self._send_json_error(503, "client_secret.json が見つかりません")
            return
        try:
            flow = Flow.from_client_secrets_file(
                CLIENT_SECRET_PATH,
                scopes=AUTH_SCOPES,
                redirect_uri=AUTH_REDIRECT_URI,
            )
            state = secrets.token_hex(16)
            auth_url, _ = flow.authorization_url(
                access_type="online",
                prompt="select_account",
                state=state,
            )
            with open(AUTH_STATE_PATH, "w") as f:
                f.write(state)
            if flow.code_verifier:
                with open(AUTH_CODE_VERIFIER_PATH, "w") as f:
                    f.write(flow.code_verifier)
            self.send_response(302)
            self.send_header("Location", auth_url)
            self.end_headers()
        except Exception as e:
            self._send_json_error(500, str(e))

    def _auth_callback(self):
        if not GCAL_AVAILABLE:
            self._send_html_message("エラー", "<p>Google API ライブラリがインストールされていません</p>")
            return
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        error = params.get("error")
        if error:
            self.send_response(302)
            self.send_header("Location", "/login.html?error=cancelled")
            self.end_headers()
            return

        code_list = params.get("code")
        state_list = params.get("state")
        if not code_list or not state_list:
            self.send_response(302)
            self.send_header("Location", "/login.html?error=invalid_state")
            self.end_headers()
            return

        # state 検証
        saved_state = ""
        if os.path.exists(AUTH_STATE_PATH):
            with open(AUTH_STATE_PATH) as f:
                saved_state = f.read().strip()
            os.remove(AUTH_STATE_PATH)
        if state_list[0] != saved_state:
            self.send_response(302)
            self.send_header("Location", "/login.html?error=invalid_state")
            self.end_headers()
            return

        try:
            code_verifier = None
            if os.path.exists(AUTH_CODE_VERIFIER_PATH):
                with open(AUTH_CODE_VERIFIER_PATH) as f:
                    code_verifier = f.read().strip()
                os.remove(AUTH_CODE_VERIFIER_PATH)

            flow = Flow.from_client_secrets_file(
                CLIENT_SECRET_PATH,
                scopes=AUTH_SCOPES,
                redirect_uri=AUTH_REDIRECT_URI,
            )
            if code_verifier:
                flow.code_verifier = code_verifier
            flow.fetch_token(code=code_list[0])
            creds = flow.credentials

            import urllib.request
            req = urllib.request.Request(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {creds.token}"},
            )
            with urllib.request.urlopen(req) as resp:
                user_info = json.loads(resp.read())

            if user_info.get("email") != ALLOWED_EMAIL:
                self.send_response(302)
                self.send_header("Location", "/login.html?error=unauthorized")
                self.end_headers()
                return

            token = secrets.token_hex(32)
            _sessions[token] = True
            self.send_response(302)
            self.send_header("Location", "/")
            self.send_header(
                "Set-Cookie",
                f"session={token}; HttpOnly; SameSite=Lax; Max-Age=604800; Path=/"
            )
            self.end_headers()
        except Exception as e:
            self.send_response(302)
            self.send_header("Location", f"/login.html?error=token_failed")
            self.end_headers()

    def _handle_logout(self):
        token = self._get_session_token()
        if token and token in _sessions:
            del _sessions[token]
        resp_body = json.dumps({"ok": True}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(resp_body)))
        self.send_header(
            "Set-Cookie",
            "session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/"
        )
        self.end_headers()
        self.wfile.write(resp_body)

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


    # ---- Gmail ----

    def _get_gmail_credentials(self):
        if not GCAL_AVAILABLE:
            return None
        if not os.path.exists(GMAIL_TOKEN_PATH):
            return None
        try:
            creds = Credentials.from_authorized_user_file(GMAIL_TOKEN_PATH, GMAIL_SCOPES)
            if creds and creds.expired and creds.refresh_token:
                from google.auth.transport.requests import Request
                creds.refresh(Request())
                with open(GMAIL_TOKEN_PATH, "w") as f:
                    f.write(creds.to_json())
            return creds if creds and creds.valid else None
        except Exception:
            return None

    def _gmail_auth(self):
        if not GCAL_AVAILABLE:
            self._send_json_error(503, "Google API ライブラリがインストールされていません")
            return
        if not os.path.exists(CLIENT_SECRET_PATH):
            self._send_json_error(503, "client_secret.json が見つかりません")
            return
        try:
            flow = Flow.from_client_secrets_file(
                CLIENT_SECRET_PATH,
                scopes=GMAIL_SCOPES,
                redirect_uri=GMAIL_REDIRECT_URI,
            )
            state = secrets.token_hex(16)
            auth_url, _ = flow.authorization_url(
                access_type="offline",
                prompt="consent",
                state=state,
            )
            with open(GMAIL_STATE_PATH, "w") as f:
                f.write(state)
            self.send_response(302)
            self.send_header("Location", auth_url)
            self.end_headers()
        except Exception as e:
            self._send_json_error(500, str(e))

    def _gmail_callback(self):
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
            flow = Flow.from_client_secrets_file(
                CLIENT_SECRET_PATH,
                scopes=GMAIL_SCOPES,
                redirect_uri=GMAIL_REDIRECT_URI,
            )
            flow.fetch_token(code=code_list[0])
            with open(GMAIL_TOKEN_PATH, "w") as f:
                f.write(flow.credentials.to_json())
            self.send_response(302)
            self.send_header("Location", "/")
            self.end_headers()
        except Exception as e:
            self._send_html_message("エラー", f"<p>認証に失敗しました: {e}</p>")

    def _send_gmail_messages(self):
        if not GCAL_AVAILABLE:
            self._send_json_error(503, "Google API ライブラリがインストールされていません")
            return
        creds = self._get_gmail_credentials()
        if creds is None:
            self._send_json_error(401, "認証が必要です")
            return
        try:
            import urllib.request as ureq
            today = datetime.date.today()
            date_query = today.strftime("%Y/%m/%d")
            token = creds.token

            # メッセージ一覧取得
            list_url = (
                f"https://gmail.googleapis.com/gmail/v1/users/me/messages"
                f"?q=after:{date_query}&maxResults=50"
            )
            req = ureq.Request(list_url, headers={"Authorization": f"Bearer {token}"})
            with ureq.urlopen(req) as resp:
                list_data = json.loads(resp.read())

            messages = list_data.get("messages", [])
            emails = []
            for msg_ref in messages:
                msg_id = msg_ref["id"]
                msg_url = (
                    f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
                    f"?format=full"
                )
                req2 = ureq.Request(msg_url, headers={"Authorization": f"Bearer {token}"})
                with ureq.urlopen(req2) as resp2:
                    msg = json.loads(resp2.read())
                emails.append(_parse_gmail_message(msg))

            emails.sort(key=lambda e: e.get("date", ""))
            self._send_json({"emails": emails})
        except Exception as e:
            self._send_json_error(500, str(e))

    # ---- Mail ----

    def _send_mail_list(self):
        host = os.environ.get("MAIL_HOST", "")
        port = int(os.environ.get("MAIL_PORT", "993"))
        user = os.environ.get("MAIL_USER", "t-horikoshi@ar-system.co.jp")
        password = os.environ.get("MAIL_PASSWORD", "")

        if not host or not password:
            self._send_json_error(
                503,
                "メールサーバーが未設定です (MAIL_HOST, MAIL_PASSWORD 環境変数を設定してください)"
            )
            return

        try:
            if port == 993:
                mail = imaplib.IMAP4_SSL(host, port)
            else:
                mail = imaplib.IMAP4(host, port)

            mail.login(user, password)
            mail.select("INBOX")

            today = datetime.date.today()
            date_str = today.strftime("%d-%b-%Y")
            _, nums_data = mail.search(None, f"SINCE {date_str}")
            msg_nums = nums_data[0].split() if nums_data[0] else []
            # 最大50件
            msg_nums = msg_nums[-50:]

            emails = []
            if msg_nums:
                num_str = b",".join(msg_nums).decode()
                _, data = mail.fetch(num_str, "(FLAGS RFC822)")
                for item in data:
                    if not isinstance(item, tuple) or len(item) < 2:
                        continue
                    meta = item[0].decode("utf-8", errors="replace") if isinstance(item[0], bytes) else ""
                    raw_bytes = item[1] if isinstance(item[1], bytes) else b""
                    if not raw_bytes:
                        continue
                    is_seen = "\\Seen" in meta
                    msg = email_lib.message_from_bytes(raw_bytes)
                    from_addr = _decode_header_str(msg.get("From", ""))
                    subject = _decode_header_str(msg.get("Subject", ""))
                    date_header = msg.get("Date", "")
                    body = _get_mail_body(msg)
                    emails.append({
                        "from": from_addr,
                        "subject": subject,
                        "date": date_header,
                        "body": body[:2000],
                        "unread": not is_seen,
                    })

            mail.logout()
            self._send_json({"emails": emails})
        except Exception as e:
            self._send_json_error(500, str(e))


def _parse_gmail_message(msg):
    headers = msg.get("payload", {}).get("headers", [])
    def get_header(name):
        return next((h["value"] for h in headers if h["name"].lower() == name.lower()), "")
    return {
        "id": msg.get("id", ""),
        "from": get_header("From"),
        "subject": get_header("Subject"),
        "date": get_header("Date"),
        "body": _extract_gmail_body(msg.get("payload", {}))[:2000],
        "unread": "UNREAD" in msg.get("labelIds", []),
    }


def _extract_gmail_body(payload):
    import base64
    mime = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data", "")

    if body_data:
        try:
            text = base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace")
            if mime == "text/plain":
                return text
            if mime == "text/html":
                return _strip_html(text)
        except Exception:
            pass

    parts = payload.get("parts", [])
    for part in parts:
        if part.get("mimeType") == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                try:
                    return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
                except Exception:
                    pass
    for part in parts:
        if part.get("mimeType") == "text/html":
            data = part.get("body", {}).get("data", "")
            if data:
                try:
                    return _strip_html(base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace"))
                except Exception:
                    pass
    for part in parts:
        if part.get("mimeType", "").startswith("multipart/"):
            text = _extract_gmail_body(part)
            if text:
                return text
    return ""


def _strip_html(html):
    import re
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<[^>]+>", " ", html)
    html = html.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&nbsp;", " ")
    html = re.sub(r" +", " ", html)
    html = re.sub(r"\n{3,}", "\n\n", html)
    return html.strip()


def _decode_header_str(s):
    if not s:
        return ""
    parts = []
    for decoded, charset in decode_header(s):
        if isinstance(decoded, bytes):
            parts.append(decoded.decode(charset or "utf-8", errors="replace"))
        else:
            parts.append(decoded)
    return "".join(parts)


def _get_mail_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if (part.get_content_type() == "text/plain"
                    and part.get_content_disposition() != "attachment"):
                try:
                    charset = part.get_content_charset() or "utf-8"
                    return part.get_payload(decode=True).decode(charset, errors="replace")
                except Exception:
                    pass
        for part in msg.walk():
            if ("text" in part.get_content_type()
                    and part.get_content_disposition() != "attachment"):
                try:
                    charset = part.get_content_charset() or "utf-8"
                    return part.get_payload(decode=True).decode(charset, errors="replace")
                except Exception:
                    pass
    else:
        try:
            charset = msg.get_content_charset() or "utf-8"
            return msg.get_payload(decode=True).decode(charset, errors="replace")
        except Exception:
            pass
    return ""


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
