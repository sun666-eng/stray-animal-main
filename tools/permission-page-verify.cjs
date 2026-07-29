const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext();
  const login = await ctx.request.post("http://127.0.0.1:9999/api/user/login", {
    data: { username: "admin", password: "admin" },
    headers: { "Content-Type": "application/json" },
  });
  console.log("login", (await login.json()).code);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("console:" + m.text());
  });
  await page.goto("http://127.0.0.1:9999/page/end/permission.html", {
    waitUntil: "networkidle",
    timeout: 45000,
  });
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => ({
    loadingShown: document.body.innerText.includes("正在读取权限"),
    rows: document.querySelectorAll(".admin-record-table tbody tr").length,
    loadError: document.querySelector(".admin-status.is-error")?.textContent || "",
    title: document.title,
    authHidden: !!document.getElementById("authWait")?.hidden,
  }));
  console.log(JSON.stringify(st, null, 2));
  console.log("errs", errs.slice(0, 8));
  await page.screenshot({
    path: "output/system-audit/screenshots/permission-page-fixed.png",
    fullPage: true,
  });
  await b.close();
  if (st.rows < 1) process.exit(2);
  if (st.loadingShown && st.rows < 1) process.exit(3);
  console.log("PASS");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
