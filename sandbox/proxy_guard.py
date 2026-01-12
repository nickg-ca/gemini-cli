import re
import os
from mitmproxy import http
from mitmproxy import ctx

class ProxyGuard:
    def __init__(self):
        # Whitelist: Block all hosts except essential dev tools
        self.whitelist = [
            "github.com",
            "api.github.com",
            "pypi.org",
            "files.pythonhosted.org",
            "googleapis.com",
            "generativelanguage.googleapis.com",
            "vscode-update.azurewebsites.net",
            "registry.npmjs.org",
        ]

        # DLP Regex Patterns
        self.dlp_patterns = [
            re.compile(rb"BEGIN OPENSSH PRIVATE KEY"),
            re.compile(rb"BEGIN RSA PRIVATE KEY"),
            re.compile(rb"AKIA[0-9A-Z]{16}"), # AWS Access Key ID
            re.compile(rb"eyJ[a-zA-Z0-9_-]+"), # JWT (basic check)
        ]

        self.max_payload_size = 1024 * 1024 # 1MB

        # Optional: Inject Gemini API Key if present in environment
        # This allows the agent to be authenticated without holding the key itself.
        self.gemini_api_key = os.environ.get("GEMINI_API_KEY")

    def request(self, flow: http.HTTPFlow):
        # 1. Whitelist Check
        host = flow.request.pretty_host
        allowed = False
        for w in self.whitelist:
            if host == w or host.endswith("." + w):
                allowed = True
                break

        if not allowed:
            ctx.log.warn(f"Blocked host: {host}")
            flow.response = http.Response.make(
                403,
                b"Access Denied: Host not whitelisted.",
                {"Content-Type": "text/plain"}
            )
            return

        # 2. Payload size check
        if len(flow.request.content) > self.max_payload_size:
             ctx.log.warn(f"Blocked upload: {len(flow.request.content)} bytes")
             flow.response = http.Response.make(
                413,
                b"Request Entity Too Large: Upload limit exceeded.",
                 {"Content-Type": "text/plain"}
             )
             return

        # 3. DLP Check on POST/PUT
        if flow.request.method in ["POST", "PUT"]:
            for pattern in self.dlp_patterns:
                if pattern.search(flow.request.content):
                    # We might want to allow the API Key if it's being sent to Gemini?
                    # But the DLP check is for EXFILTRATION.
                    # If we are sending TO Google, it's probably fine?
                    # But we want to prevent sending secrets TO random places.
                    # Since we are whitelisting, maybe it's less critical, but still good practice.
                    # For now, we block it.
                    ctx.log.warn(f"DLP Alert: Sensitive data detected in {host}")
                    flow.response = http.Response.make(
                        403,
                        b"DLP Violation: Sensitive data detected.",
                        {"Content-Type": "text/plain"}
                    )
                    return

        # 4. Inject Gemini API Key (Optional Feature)
        if self.gemini_api_key and "generativelanguage.googleapis.com" in host:
             # Check if key is already there? Or just overwrite/append?
             # Usually passed as query param ?key=... or header x-goog-api-key
             if not flow.request.query.get("key") and "x-goog-api-key" not in flow.request.headers:
                 ctx.log.info("Injecting Gemini API Key")
                 flow.request.query["key"] = self.gemini_api_key

addons = [
    ProxyGuard()
]
