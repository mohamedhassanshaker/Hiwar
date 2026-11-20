import { expect, test, type Page } from "@playwright/test";

import { baseUrl, closeContexts, signUpOwner, type Account } from "../support/accounts";
import { addFaq, createAgent, createLiveDeployment, openConversation, openWidget, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

/** A valid one-page PDF with no text layer, as a scanner produces. */
function scannedPdf(): Buffer {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

async function addDialog(page: Page) {
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "Add a source" }).click();
  return page.getByRole("dialog", { name: "Add a source" });
}
function row(page: Page, name: string) {
  return page.getByRole("row").filter({ hasText: name });
}
function stat(page: Page, label: string) {
  return page.locator(".card").filter({ has: page.locator(".over", { hasText: label }) });
}
async function waitStatus(page: Page, name: string, status: string): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(row(page, name).locator(".stt")).toHaveText(status, { timeout: 1000 });
  }).toPass({ timeout: 90_000 });
}

test.describe("KNO-001 Knowledge sources and ingestion", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;

  test.beforeAll(async ({ browser }) => {
    owner = await signUpOwner(browser);
  });

  test("AC-KNO-001-01: Upload files offers drag and drop or browse with the type and size hint", async () => {
    const dialog = await addDialog(owner.page);
    await expect(dialog.getByRole("group", { name: "Source type" }).getByRole("button", { name: "Upload files" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByText("Drop files here or browse")).toBeVisible();
    await expect(dialog.getByText("PDF, DOCX, TXT, MD or CSV. Up to 25 MB each.")).toBeVisible();
  });

  test("AC-KNO-001-02: a 30 MB PDF or an .exe file is refused with the reason and no row is created", async () => {
    const { page } = owner;
    for (const file of [
      { name: "Huge menu.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(30 * 1024 * 1024, 32), reason: /larger than 25 MB/ },
      { name: "setup.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ fake"), reason: /PDF, DOCX, TXT, MD or CSV|not supported|type/i },
    ]) {
      const dialog = await addDialog(page);
      await dialog.locator("input[type=file]").setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
      await dialog.getByRole("button", { name: "Add and prepare" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(file.reason);
      await page.reload();
      await expect(row(page, file.name)).toHaveCount(0);
    }
  });

  test("AC-KNO-001-03: Website mode asks for the address, crawl depth (2 levels by default) and domains to stay on", async () => {
    const dialog = await addDialog(owner.page);
    await dialog.getByRole("button", { name: "Website" }).click();
    await expect(dialog.getByLabel("Website address")).toBeVisible();
    await expect(dialog.getByLabel("Crawl depth").locator("option")).toHaveText(["1 level", "2 levels", "3 levels"]);
    await expect(dialog.getByLabel("Crawl depth")).toHaveValue("2");
    await expect(dialog.getByLabel("Stay on these domains")).toBeVisible();
  });

  test("AC-KNO-001-04, -05: an FAQ entry appears as type FAQ, is prepared to Ready with its chunk count; Cancel and Close add nothing", async () => {
    const { page } = owner;
    for (const leave of ["Cancel", "Close"]) {
      const dialog = await addDialog(page);
      await dialog.getByRole("button", { name: "FAQ entry" }).click();
      await dialog.getByLabel("Question").fill(`Left with ${leave}?`);
      await dialog.getByLabel("Answer").fill("This should not be added.");
      await dialog.getByRole("button", { name: leave }).first().click();
      await expect(dialog).toBeHidden();
      await expect(row(page, `Left with ${leave}?`)).toHaveCount(0);
    }
    const dialog = await addDialog(page);
    await dialog.getByRole("button", { name: "FAQ entry" }).click();
    await dialog.getByLabel("Question").fill("Do you deliver to Sharjah?");
    await dialog.getByLabel("Answer").fill("Yes. We deliver to Sharjah until midnight on weekdays.");
    await dialog.getByRole("button", { name: "Add and prepare" }).click();
    await expect(dialog).toBeHidden();
    const faq = row(page, "Do you deliver to Sharjah?");
    await expect(faq.getByRole("cell").nth(1)).toHaveText("FAQ");
    await expect(faq.locator(".stt")).toHaveText(/Queued|Processing|Ready/);
    await waitStatus(page, "Do you deliver to Sharjah?", "Ready");
    await expect(faq.getByRole("cell").nth(3)).not.toHaveText("0");
  });

  test("AC-KNO-001-06: a scanned PDF fails with the reason and offers Retry", async () => {
    const { page } = owner;
    const dialog = await addDialog(page);
    await dialog.locator("input[type=file]").setInputFiles({ name: "Old price list.pdf", mimeType: "application/pdf", buffer: scannedPdf() });
    await dialog.getByRole("button", { name: "Add and prepare" }).click();
    // The dialog closes once the upload is accepted; reloading earlier would abort it.
    await expect(dialog).toBeHidden();
    await waitStatus(page, "Old price list.pdf", "Failed");
    await expect(row(page, "Old price list.pdf")).toContainText("The PDF is a scan with no readable text. Upload a text version.");
    await expect(row(page, "Old price list.pdf").getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("AC-KNO-001-07: Re-crawl moves a website source to Processing and back to Ready", async () => {
    const { page } = owner;
    const dialog = await addDialog(page);
    await dialog.getByRole("button", { name: "Website" }).click();
    await dialog.getByLabel("Website address").fill(`${baseUrl}/pricing`);
    await dialog.getByLabel("Crawl depth").selectOption({ label: "1 level" });
    await dialog.getByRole("button", { name: "Add and prepare" }).click();
    const name = new URL(baseUrl).host;
    await waitStatus(page, name, "Ready");
    const chunks = await row(page, name).getByRole("cell").nth(3).textContent();
    await row(page, name).getByRole("button", { name: "Re-crawl" }).click();
    await expect(row(page, name).locator(".stt")).toHaveText(/Queued|Processing/);
    await waitStatus(page, name, "Ready");
    await expect(row(page, name).getByRole("cell").nth(3)).toHaveText(chunks!);
  });

  test("AC-KNO-001-08, -10: Disable takes a source out of retrieval and the searchable count; Enable restores it; the stats follow", async () => {
    const { page } = owner;
    const agent = await createAgent(page, "Layla");
    await page.goto("/knowledge");
    const name = "Do you deliver to Sharjah?";
    const chunks = Number(await row(page, name).getByRole("cell").nth(3).textContent());
    const searchable = Number(await stat(page, "Chunks searchable").locator(".num").textContent());
    const ready = Number(await stat(page, "Sources ready").locator(".num").textContent());
    await expect(stat(page, "Storage used")).toContainText("of 5 GB");
    await expect(stat(page, "Sources ready")).toContainText(/of \d+ sources/);

    await page.getByRole("button", { name: `Disable ${name}` }).click();
    await expect(row(page, name).locator(".stt")).toHaveText("Disabled");
    await expect(stat(page, "Chunks searchable").locator(".num")).toHaveText(String(searchable - chunks));
    await expect(stat(page, "Sources ready").locator(".num")).toHaveText(String(ready - 1));
    await page.goto(agent);
    await page.getByLabel("Test message").fill(name);
    await page.getByLabel("Test message").press("Enter");
    await expect(page.getByRole("complementary", { name: "Test console" }).getByText("No source needed")).toBeVisible();

    await page.goto("/knowledge");
    await page.getByRole("button", { name: `Enable ${name}` }).click();
    await expect(row(page, name).locator(".stt")).toHaveText("Ready");
    await expect(stat(page, "Chunks searchable").locator(".num")).toHaveText(String(searchable));
    await page.goto(agent);
    await page.getByLabel("Test message").fill(name);
    await page.getByLabel("Test message").press("Enter");
    await expect(page.getByRole("complementary", { name: "Test console" }).getByText(/· chunk 1 ·/)).toBeVisible();
  });

  test("AC-KNO-001-09: Delete confirms with the source name, removes it and its chunks, and past conversations keep their citations", async ({ browser }) => {
    const { page } = owner;
    const { key } = await readyWorkspaceFor(page);
    const visitor = await openWidget(browser, key);
    await say(visitor, "Do you have a kids menu?");
    await expect(visitor.widget.getByRole("log")).toContainText("Yes, kids eat free on Mondays.");

    await page.goto("/knowledge");
    await page.getByRole("button", { name: "Delete Do you have a kids menu?" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Do you have a kids menu??" });
    await expect(dialog).toContainText("Past conversations keep their citations.");
    await dialog.getByRole("button", { name: "Delete source" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Removed" })).toHaveText("Removed Do you have a kids menu? and its chunks. Past conversations keep their citations.");
    await expect(row(page, "Do you have a kids menu?")).toHaveCount(0);
    const thread = await openConversation(page, "ai", "Do you have a kids menu?");
    await expect(thread.getByText("Source: Do you have a kids menu?")).toBeVisible();
  });

  test.fixme("AC-KNO-001-11: a file that would exceed the plan's knowledge storage is refused with the limit and an Upgrade link (needs a storage limit small enough to reach with 25 MB uploads, such as an operator plan override)", async () => {});
});

/** A kids-menu FAQ, the agent and a live deployment of this organization (one deployment on the trial). */
async function readyWorkspaceFor(page: Page): Promise<{ key: string }> {
  await addFaq(page, "Do you have a kids menu?", "Yes, kids eat free on Mondays.");
  const { key } = await createLiveDeployment(page, "Order site", "Layla");
  return { key };
}

