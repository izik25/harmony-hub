import { chromium } from "playwright";

const BASE = "http://localhost:8080";

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

const rpcCalls = [];
page.on("response", async (res) => {
  const url = res.url();
  if (url.includes("/_serverFn/")) {
    let bodyPreview = "";
    try {
      const buf = await res.body();
      bodyPreview = buf.toString("utf8").slice(0, 500);
    } catch (e) {
      bodyPreview = "(no body: " + e.message + ")";
    }
    rpcCalls.push({ url, status: res.status(), bodyPreview });
  }
});

try {
  console.log("== nav login ==");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passInput = page.locator('input[type="password"]').first();
  await emailInput.fill("kai@demo.sona");
  await passInput.fill("demo1234");
  await page.locator('button[type="submit"]').first().click();

  await page.waitForTimeout(2500);
  const errText = await page.locator("form p").allTextContents().catch(() => []);
  console.log("form messages:", errText);
  console.log("post-login url:", page.url());
  if (page.url().includes("/login")) {
    console.log("LOGIN DID NOT SUCCEED — aborting rest of script");
    await page.screenshot({ path: "__diag_login_fail.png", fullPage: true });
    await browser.close();
    process.exit(0);
  }

  console.log("== nav upload ==");
  await page.goto(`${BASE}/upload`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(1000);

  const titleInput = page.locator('input[placeholder]').first();
  if (await titleInput.count()) {
    await titleInput.fill("Diagnostic Test Song");
  }

  console.log("== click generate cover ==");
  const genBtn = page.getByRole("button", { name: /generate|regenerate/i }).first();
  await genBtn.waitFor({ timeout: 10000 });
  await genBtn.click();

  console.log("waiting up to 45s for the request to resolve...");
  await page.waitForTimeout(45000);

  console.log("== RPC calls seen ==");
  for (const c of rpcCalls) {
    console.log(JSON.stringify(c, null, 2));
  }

  console.log("== console errors ==");
  for (const e of consoleErrors) console.log(e);

  await page.screenshot({ path: "__diag_upload.png", fullPage: true });
  console.log("screenshot saved");
} catch (err) {
  console.log("SCRIPT ERROR:", err.stack || err.message);
  await page.screenshot({ path: "__diag_error.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
