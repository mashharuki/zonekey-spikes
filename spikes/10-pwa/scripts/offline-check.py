"""
spike 10: PWA のオフライン確認（Chrome + Playwright）。DevTools の「Offline」と同じネットワーク条件のエミュレーションを使う。
  python3 scripts/offline-check.py <dist のパス> <samples-qr のパス> <結果 JSON の出力先> [Chrome の実行ファイル]
- dist をこのスクリプト内の小さな HTTP サーバー（127.0.0.1、圧縮なし）で配り、サーバー側で「何を何バイト送ったか」を段階ごとに記録する
- 段階: 1 初回訪問（SW の事前保存を含む）/ 2 2 回目の訪問 / 3 検証画面を開く / 4 オフラインで再読み込み→検証
- 比較用に、Service Worker を使わない場合の「検証画面を開いたときに追加で読み込む量」も測る
"""
import gzip, json, os, sys, tempfile, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

DIST, QR_DIR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
CHROME = sys.argv[4] if len(sys.argv) > 4 else None
LOG: list[dict] = []
PHASE = {"name": "-"}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a):  # 標準のログは出さない
        pass

    def do_GET(self):
        path = self.translate_path(self.path)
        size = os.path.getsize(path) if os.path.isfile(path) else (os.path.getsize(os.path.join(DIST, "index.html")) if not os.path.splitext(self.path.split("?")[0])[1] else 0)
        LOG.append({"phase": PHASE["name"], "path": self.path, "bytes": size, "sw": self.headers.get("Service-Worker") is not None})
        if not os.path.exists(path) and not os.path.splitext(self.path.split("?")[0])[1]:
            self.path = "/index.html"  # SPA のフォールバック
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")  # HTTP キャッシュで数え漏れないように
        super().end_headers()


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=DIST))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_address[1]}"
result: dict = {"base": BASE}


def phase(name):
    PHASE["name"] = name


def summarize(name):
    rows = [r for r in LOG if r["phase"] == name]
    return {"requests": len(rows), "bytes": sum(r["bytes"] for r in rows), "files": [f'{r["path"]} {r["bytes"]}' for r in rows]}


def verdict_after(page, action):
    action()
    res = page.get_by_test_id("result")
    expect(res).to_be_visible(timeout=15000)
    return {"verdict": page.get_by_test_id("verdict").inner_text(), "confirmed": res.get_attribute("data-confirmed"), "text": res.inner_text()[:400]}


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else p.chromium.launch()
    result["browser"] = browser.version

    # ── 比較: Service Worker なしで、検証画面を開いたときに追加で読み込む量
    ctx0 = browser.new_context(service_workers="block")
    pg0 = ctx0.new_page()
    phase("noSW:home")
    pg0.goto(BASE + "/")
    pg0.wait_for_load_state("networkidle")
    phase("noSW:openVerify")
    pg0.get_by_test_id("open-verify").click()
    expect(pg0.get_by_test_id("file")).to_be_attached()
    pg0.wait_for_load_state("networkidle")
    phase("-")
    result["noSW"] = {"home": summarize("noSW:home"), "openVerify": summarize("noSW:openVerify")}
    ctx0.close()

    # ── 本番どおり: Service Worker あり。通常のプロファイル（シークレットではない）で開き、インストール可否も問い合わせる
    launch = {"executable_path": CHROME, "args": ["--no-sandbox"]} if CHROME else {}
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=True, service_workers="allow", **launch)
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    phase("1:firstVisit")
    page.goto(BASE + "/")
    expect(page.get_by_test_id("sw")).to_have_text("オフライン可", timeout=30000)  # 事前保存が終わった
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)
    perf = page.evaluate("performance.getEntriesByType('resource').map(e => ({name: e.name.replace(location.origin, ''), decoded: e.decodedBodySize}))")
    nav = page.evaluate("performance.getEntriesByType('navigation').map(e => e.decodedBodySize)[0]")
    result["installability"] = cdp.send("Page.getInstallabilityErrors")
    result["manifest"] = cdp.send("Page.getAppManifest").get("errors")
    result["swController"] = page.evaluate("!!navigator.serviceWorker.controller")
    result["cacheNames"] = page.evaluate("caches.keys()")
    result["precached"] = page.evaluate("(async () => { const out = []; for (const n of await caches.keys()) { const c = await caches.open(n); for (const r of await c.keys()) out.push(r.url.replace(location.origin, '')); } return out; })()")
    result["firstVisit"] = {**summarize("1:firstVisit"), "pageResources": perf, "documentBytes": nav}

    phase("2:secondVisit")
    page.reload()
    page.wait_for_load_state("networkidle")
    result["secondVisit"] = summarize("2:secondVisit")

    phase("3:openVerifyWithSW")
    page.get_by_test_id("open-verify").click()
    expect(page.get_by_test_id("file")).to_be_attached()
    page.wait_for_load_state("networkidle")
    result["openVerifyWithSW"] = summarize("3:openVerifyWithSW")

    # ── オフライン（DevTools の Offline と同じ）にして、再読み込みから検証完了まで
    phase("4:offline")
    ctx.set_offline(True)
    page.goto(BASE + "/")  # トップから開き直す（再読み込み相当）
    page.reload()
    # 画面の「オンライン/オフライン」表示（navigator.onLine）は目印なので判定には使わず、値を記録する
    expect(page.get_by_test_id("sw")).to_have_text("オフライン可")
    off_label = {"netLabel": page.get_by_test_id("net").inner_text(), "navigatorOnLine": page.evaluate("navigator.onLine")}
    page.get_by_test_id("open-verify").click()
    expect(page.get_by_test_id("file")).to_be_attached(timeout=10000)
    off: dict = {**off_label}
    for name in ["confirmed", "tampered", "no-signatures"]:
        off[f"file:{name}.bin"] = verdict_after(page, lambda n=name: page.get_by_test_id("file").set_input_files(os.path.join(DIST, "samples", f"{n}.bin")))
        off[f"qrImage:{name}.png"] = verdict_after(page, lambda n=name: page.get_by_test_id("file").set_input_files(os.path.join(QR_DIR, f"{n}.png")))
        off[f"sampleButton:{name}"] = verdict_after(page, lambda n=name: page.get_by_test_id(f"sample-{n}").click())
    page.screenshot(path=os.path.join(os.path.dirname(OUT), "offline-no-signatures.png"), full_page=True)
    page.get_by_test_id("sample-confirmed").click()
    expect(page.get_by_test_id("verdict")).to_have_text("確定済み")
    page.screenshot(path=os.path.join(os.path.dirname(OUT), "offline-confirmed.png"), full_page=True)
    page.get_by_test_id("sample-tampered").click()
    expect(page.get_by_test_id("result")).to_have_attribute("data-confirmed", "false")
    page.screenshot(path=os.path.join(os.path.dirname(OUT), "offline-tampered.png"), full_page=True)
    # iPhone の幅（390×844）での見え方
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_test_id("sample-confirmed").click()
    expect(page.get_by_test_id("verdict")).to_have_text("確定済み")
    page.screenshot(path=os.path.join(os.path.dirname(OUT), "offline-confirmed-390.png"), full_page=True)
    # NetworkOnly: オフラインでは Privy・XRPL・API への fetch はキャッシュから返らず失敗する
    off["networkOnly"] = page.evaluate("""async () => {
      const t = async (u) => { try { const r = await fetch(u); return `status ${r.status}`; } catch (e) { return `失敗: ${e.message}`; } };
      return { privy: await t('https://auth.privy.io/api/v1/apps/x'), xrpl: await t('https://s.altnet.rippletest.net:51234/'), api: await t('/api/receipts') };
    }""")
    result["offline"] = {**off, "server": summarize("4:offline")}
    ctx.set_offline(False)
    ctx.close()
    browser.close()

server.shutdown()
# 配信時に圧縮された場合の目安（gzip -9）
sizes = {}
for root, _, files in os.walk(DIST):
    for f in files:
        full = os.path.join(root, f)
        raw = open(full, "rb").read()
        sizes[os.path.relpath(full, DIST)] = {"raw": len(raw), "gzip": len(gzip.compress(raw, 9))}
result["fileSizes"] = sizes
json.dump(result, open(OUT, "w"), ensure_ascii=False, indent=2)
print(json.dumps({k: v for k, v in result.items() if k not in ("fileSizes",)}, ensure_ascii=False, indent=1)[:6000])
