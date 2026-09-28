import { expect, test, type Page } from "@playwright/test";

async function waitForApp(page: Page) {
  await expect(page.locator("[data-hydrated='true']")).toBeVisible();
}

/** On phones, nothing may make the page wider than the screen (it causes sideways wobble). */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page is wider than the screen").toBeLessThanOrEqual(1);
}

test("marketing page explains the product without clinical claims", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Prior Authorization Workflows, Powered by AI" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start Free" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "View Demo" }).first()).toBeVisible();
});

test("demo login opens a populated dashboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "View Demo" }).first().click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  await expect(page.getByText("Payer decisions overdue")).toBeVisible();
  await expect(page.getByText("Work to do first")).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expect(page.getByText("Synthetic demo data").first()).toBeVisible();
});

test("create a patient and an authorization, then move status and run mock AI", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("specialist@northstar.demo");
  await page.getByLabel("Password").fill("Northstar-demo-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await waitForApp(page);

  const mrn = `NS-E2E-${Date.now().toString().slice(-6)}`;
  await page.goto("/patients/new");
  await waitForApp(page);
  await page.getByLabel("MRN").fill(mrn);
  await page.getByLabel("First name").fill("Eden");
  await page.getByLabel("Last name").fill("Case");
  await page.getByLabel("Date of birth").fill("1988-04-12");
  await page.getByLabel("Phone").fill("(555) 010-0144");
  await page.getByLabel("Email").fill("eden.case@example.com");
  await page.getByRole("button", { name: "Create patient" }).click();
  await expect(page.getByRole("heading", { name: "Case, Eden" })).toBeVisible();

  await page.goto("/authorizations/new");
  await waitForApp(page);
  await page.getByLabel("Patient").selectOption({ label: `Case, Eden · ${mrn}` });
  // A commercial payer: no extra payer-required documents, so one clinical note completes the packet.
  await page.getByLabel("Payer", { exact: true }).selectOption({ label: "Northwind Health Plan" });
  await page.getByLabel("Member ID").fill("MEM-44001");
  await page.getByLabel("Ordering provider").selectOption({ index: 1 });
  await page.getByLabel("Place of service").selectOption("24");
  await page.getByLabel("Requested service date").fill("2026-10-20");
  await page.getByLabel("Request summary").fill("Diagnostic colonoscopy");
  await page.getByLabel("Line 1 code").fill("45378");
  await page.getByLabel("Line 1 description").fill("Colonoscopy, diagnostic");
  await page.getByLabel("Diagnosis 1 code").fill("Z86.010");
  await page.getByLabel("Diagnosis 1 description").fill("Personal history of colonic polyps");
  await page.getByRole("button", { name: "Create authorization" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("PA-");
  await waitForApp(page);
  await expectNoSidewaysScroll(page);

  // The packet checklist blocks review until clinical support is attached.
  await expect(page.getByLabel("Packet checklist")).toContainText("Clinical support attached");
  await expect(page.getByLabel("Packet checklist")).toContainText("6 of 7 ready");
  await expect(page.getByRole("button", { name: "Finish packet" })).toBeVisible();
  await page.getByRole("button", { name: "Change status" }).click();
  await page.getByLabel("Next status").selectOption("READY_FOR_REVIEW");
  await page.getByLabel("Reason").fill("Ready for internal review");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The packet is not ready" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Upload document" }).click();
  await page.locator('input[name="file"]').setInputFiles({
    name: "clinical-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic note. Symptoms for 8 weeks; conservative therapy failed."),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByLabel("Packet checklist")).toContainText("7 of 7 ready");
  await expect(page.getByRole("button", { name: "Mark ready for review" })).toBeVisible();

  await page.getByRole("button", { name: "Change status" }).click();
  await page.getByLabel("Next status").selectOption("READY_FOR_REVIEW");
  await page.getByLabel("Reason").fill("Ready for internal review");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText("Ready for review").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit to payer" })).toBeVisible();

  await page.getByRole("button", { name: "Change status" }).click();
  await page.getByLabel("Next status").selectOption("SUBMITTED");
  await page.getByLabel("Reason").fill("Submitted on the payer portal");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText("Submitted").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByLabel("Case progress")).toContainText("With payer");

  // Approvals go through the decision form, which records the reference and approved window.
  await page.getByRole("button", { name: "Record decision" }).click();
  await page.getByLabel("Payer reference").fill("NW-55012");
  await page.getByLabel("Approved from").fill("2026-10-01");
  await page.getByLabel("Approved through").fill("2026-12-31");
  await page.getByLabel("Note for the history").fill("Approved by phone; letter to follow");
  await page.getByRole("button", { name: "Save decision" }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();
  await expect(page.getByText("Attach the payer determination letter.")).toBeVisible();

  await page.getByRole("tab", { name: "tasks" }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByPlaceholder("Title").fill("Confirm member ID");
  await page.getByRole("button", { name: "Create task" }).click();
  await page.getByRole("tab", { name: "tasks" }).click();
  await expect(page.getByText("Confirm member ID")).toBeVisible();

  await page.getByRole("tab", { name: "notes" }).click();
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Reviewed the administrative packet.");
  await page.getByRole("button", { name: "Save note" }).click();
  await page.getByRole("tab", { name: "notes" }).click();
  await expect(page.getByText("Reviewed the administrative packet.")).toBeVisible();

  await page.getByRole("tab", { name: "AI analysis" }).click();
  await page.getByRole("button", { name: "Run AI analysis" }).click();
  await expect(page.getByText("AI-generated — review before use.").first()).toBeVisible();
});

test("search and analytics stay inside the shell", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@northstar.demo");
  await page.getByLabel("Password").fill("Northstar-demo-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await waitForApp(page);
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search patients, authorization numbers, procedures, tasks").fill("PA-2026");
  await expect(page.getByText("PA-2026").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByText("Approval rate").first()).toBeVisible();
});
