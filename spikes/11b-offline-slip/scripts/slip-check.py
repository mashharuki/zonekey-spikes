"""
spike 11b: オフラインの伝票の確認（Chrome + Playwright）。DevTools の「Offline」と同じネットワーク条件のエミュレーションを使う。
  python3 scripts/slip-check.py <dist> <出力ディレクトリ> [Chrome の実行ファイル]
世帯・お店A・お店B（と改ざん用の別の世帯、Ed25519 用の世帯とお店C）を別々のブラウザの保存領域で開き、
オフラインで伝票の作成・QR の読み取り・お店の確認・改ざん・二重払いを試す。お店が書き出した伝票は精算スクリプトに渡す。
"""
import json, os, sys, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

DIST, OUT = sys.argv[1], sys.argv[2]
CHROME = sys.argv[3] if len(sys.argv) > 3 else None
os.makedirs(OUT, exist_ok=True)
LOG: list[dict] = []
PHASE = {"name": "-"}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        LOG.append({"phase": PHASE["name"], "path": self.path, "swUpdate": self.headers.get("Service-Worker") == "script"})
        return super().do_GET()


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=DIST))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_address[1]}"
R: dict = {"base": BASE}
p_ = lambda name: os.path.join(OUT, name)


def write(name, data: bytes):
    with open(p_(name), "wb") as f:
        f.write(data)
    return p_(name)


def open_page(browser, route):
    ctx = browser.new_context(service_workers="allow", viewport={"width": 900, "height": 1200})
    page = ctx.new_page()
    page.goto(f"{BASE}/#/{route}")
    expect(page.get_by_test_id("sw")).to_have_text("オフライン可", timeout=30000)
    page.reload()  # Service Worker の制御下で開き直す
    return ctx, page


def shop_receive(page, file_path):
    page.get_by_test_id("slip-file").set_input_files(file_path)
    res = page.get_by_test_id("shop-result")
    expect(res).to_be_visible()
    page.wait_for_timeout(300)
    return {"verdict": page.get_by_test_id("shop-verdict").inner_text(), "ok": res.get_attribute("data-ok"), "text": res.inner_text()[:500]}


def make_slip(page, shop_id, amount, name):
    page.get_by_test_id("shop-id").fill(shop_id)
    page.get_by_test_id("amount").fill(amount)
    page.get_by_test_id("make-slip").click()
    expect(page.get_by_test_id("slip-qr")).to_be_visible()
    page.wait_for_timeout(300)
    info = page.get_by_test_id("slip-info").inner_text()
    slip_hex = page.get_by_test_id("slip-hex").input_value()
    png = p_(f"{name}.png")
    page.get_by_test_id("slip-qr").screenshot(path=png)
    return {"info": info, "hex": slip_hex, "png": png}


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else pw.chromium.launch()
    R["browser"] = f"Chrome {browser.version}（headless、{os.uname().sysname} {os.uname().machine}）"

    # ── オンライン: 鍵を作る・Check 一覧を渡す ─────────────────────────
    PHASE["name"] = "online"
    hctx, hp = open_page(browser, "household")
    hp.get_by_test_id("create-keys").click()
    expect(hp.get_by_test_id("invoice-id")).to_be_visible()
    R["invoiceId"] = hp.get_by_test_id("invoice-id").inner_text()
    hp.get_by_test_id("try-export").click()
    R["exportBeforeReload"] = hp.get_by_test_id("export-result").inner_text()
    hp.reload()  # IndexedDB から読み直しても取り出せないままか
    hp.get_by_test_id("try-export").click()
    R["exportAfterReload"] = hp.get_by_test_id("export-result").inner_text()
    checks_path = write("checks.json", hp.get_by_test_id("checks-json").input_value().encode())
    R["checks"] = json.loads(open(checks_path).read())

    shops = {}
    for name in ["A", "B"]:
        ctx, pg = open_page(browser, "shop")
        pg.get_by_test_id("checks-file").set_input_files(checks_path)
        expect(pg.get_by_test_id("checks-count")).to_have_text("取り込み済み: 1 件")
        shops[name] = {"ctx": ctx, "page": pg, "id": pg.get_by_test_id("shop-self-id").inner_text()}
    # 改ざん用の別の世帯（別の鍵）
    h2ctx, h2 = open_page(browser, "household")
    h2.get_by_test_id("create-keys").click()
    expect(h2.get_by_test_id("invoice-id")).to_be_visible()

    # ── オフラインにして、すべてのページを開き直す ─────────────────────
    PHASE["name"] = "offline"
    requests_offline: list[str] = []
    for c in [hctx, h2ctx, *[s["ctx"] for s in shops.values()]]:
        c.set_offline(True)
        c.on("request", lambda r: requests_offline.append(r.url) if not r.url.startswith(BASE) else None)
    for pg in [hp, h2, *[s["page"] for s in shops.values()]]:
        pg.reload()
        expect(pg.get_by_test_id("sw")).to_have_text("オフライン可")
    A, B = shops["A"], shops["B"]

    # 確認 2: 伝票の作成（世帯）→ QR の画像をお店 A が読む
    s1 = make_slip(hp, A["id"], "0.2", "slip1-to-A")
    R["slip1"] = {"info": s1["info"], "bytes": len(s1["hex"]) // 2}
    R["A_receive_slip1_qr"] = shop_receive(A["page"], s1["png"])

    # 確認 3: 改ざん（お店 A に .bin で見せる）
    raw = bytes.fromhex(s1["hex"])
    slip, sig, pub = raw[:79], raw[79:143], raw[143:]
    flip = bytearray(slip); flip[58] ^= 0x01  # 合計額（UInt64、51〜58 バイト目）の最下位ビット
    R["tamper_total_1bit"] = shop_receive(A["page"], write("tamper-total.bin", bytes(flip) + sig + pub))
    other_sig = h2.evaluate("""async (slipHex) => {
      const k = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, false, ['sign']);
      const b = Uint8Array.from(slipHex.match(/../g), x => parseInt(x, 16));
      const s = new Uint8Array(await crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, k.privateKey, b));
      return Array.from(s, x => x.toString(16).padStart(2,'0')).join('');
    }""", slip.hex())
    R["tamper_other_key_signature"] = shop_receive(A["page"], write("tamper-otherkey.bin", slip + bytes.fromhex(other_sig) + pub))
    # InvoiceID と合わない公開鍵: 別の世帯が自分の鍵で正しく署名した伝票（お店 A 宛て・同じ CheckID）
    sx = make_slip(h2, A["id"], "0.1", "slip-wrongkey")
    R["tamper_pubkey_not_invoiceid"] = shop_receive(A["page"], sx["png"])
    R["replay_same_slip_to_A"] = shop_receive(A["page"], s1["png"])
    R["slip_for_A_shown_to_B"] = shop_receive(B["page"], s1["png"])

    # 確認 4: 二重払い。番号を戻して、同じ番号 1・違う額の伝票をお店 B に出す
    hp.get_by_test_id("rewind-0").click()
    expect(hp.get_by_test_id("seq")).to_have_text("0")
    s2 = make_slip(hp, B["id"], "0.4", "slip1dup-to-B")
    R["slip1dup"] = {"info": s2["info"]}
    R["B_receive_slip1dup_offline"] = shop_receive(B["page"], s2["png"])
    s3 = make_slip(hp, B["id"], "0.1", "slip2-to-B")
    R["B_receive_slip2"] = shop_receive(B["page"], s3["png"])
    hp.get_by_test_id("amount").fill("0.1")
    hp.get_by_test_id("make-slip").click()
    R["household_refuses_over_sendmax"] = hp.get_by_test_id("household-msg").inner_text()

    # 確認 5: 計測（署名・確認の時間。それぞれ 50 回）
    R["timing"] = hp.evaluate("""async () => {
      const out = {};
      for (const [name, gen, sp] of [["ECDSA-P256", {name:'ECDSA', namedCurve:'P-256'}, {name:'ECDSA', hash:'SHA-256'}], ["Ed25519", {name:'Ed25519'}, {name:'Ed25519'}]]) {
        try {
          const k = await crypto.subtle.generateKey(gen, false, ['sign','verify']);
          const data = crypto.getRandomValues(new Uint8Array(79));
          let t = performance.now(); let sig;
          for (let i = 0; i < 50; i++) sig = await crypto.subtle.sign(sp, k.privateKey, data);
          const signMs = (performance.now() - t) / 50;
          t = performance.now();
          for (let i = 0; i < 50; i++) await crypto.subtle.verify(sp, k.publicKey, sig, data);
          out[name] = { signMsAvg: Math.round(signMs * 1000) / 1000, verifyMsAvg: Math.round((performance.now() - t) / 50 * 1000) / 1000, signatureBytes: sig.byteLength };
        } catch (e) { out[name] = { error: String(e) }; }
      }
      out.userAgent = navigator.userAgent;
      return out;
    }""")
    hp.screenshot(path=p_("household-offline.png"), full_page=True)
    A["page"].get_by_test_id("slip-file").set_input_files(s1["png"])  # 最後の表示を「不一致（再提示）」にしないよう、受け付けの画面を残す
    page_b = B["page"]
    shop_receive(page_b, s3["png"])  # B に同じ伝票をもう一度 → 不一致（d）の画面
    page_b.screenshot(path=p_("shopB-offline.png"), full_page=True)

    # 確認 6（任意）: Ed25519
    PHASE["name"] = "online-ed"
    e_ctx, ep = open_page(browser, "household")
    ep.get_by_test_id("alg").select_option("Ed25519")
    ep.get_by_test_id("create-keys").click()
    expect(ep.get_by_test_id("invoice-id")).to_be_visible()
    ed_checks = write("checks-ed25519.json", ep.get_by_test_id("checks-json").input_value().encode())
    c_ctx, cp = open_page(browser, "shop")
    cp.get_by_test_id("checks-file").set_input_files(ed_checks)
    expect(cp.get_by_test_id("checks-count")).to_have_text("取り込み済み: 1 件")
    c_id = cp.get_by_test_id("shop-self-id").inner_text()
    PHASE["name"] = "offline-ed"
    for c in [e_ctx, c_ctx]:
        c.set_offline(True)
        c.on("request", lambda r: requests_offline.append(r.url) if not r.url.startswith(BASE) else None)
    se = make_slip(ep, c_id, "0.3", "slip-ed25519")
    R["ed25519"] = {"info": se["info"], "bytes": len(se["hex"]) // 2, "shopC": shop_receive(cp, se["png"])}

    # 精算スクリプト用に、お店の伝票を書き出す
    for name, s in shops.items():
        write(f"slips-{name}.json", s["page"].get_by_test_id("slips-json").input_value().encode())
    R["server_requests_by_phase"] = {ph: [l["path"] for l in LOG if l["phase"] == ph] for ph in dict.fromkeys(l["phase"] for l in LOG)}
    R["offline_server_requests"] = [{"path": l["path"], "serviceWorkerScriptUpdate": l["swUpdate"]} for l in LOG if l["phase"].startswith("offline")]
    R["offline_external_requests"] = requests_offline
    browser.close()
server.shutdown()
json.dump(R, open(p_("slip-check.json"), "w"), ensure_ascii=False, indent=2)
print(json.dumps({k: v for k, v in R.items() if k not in ("checks",)}, ensure_ascii=False, indent=1)[:9000])
