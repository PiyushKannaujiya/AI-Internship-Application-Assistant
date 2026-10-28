/**
 * Launches a visible Chromium session, navigates to the application page, and
 * fills it. The session is handed back so the CLI can leave it open for review.
 */
import { fillApplication } from "./fill.js";

export async function launchSession({
  plan,
  resumeFile,
  url,
  headless = false,
  profileDir,
  log = () => {},
}) {
  const { chromium } = await import("playwright");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: null,
    args: headless ? [] : ["--start-maximized"],
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    const targetUrl = url || plan.job?.applicationUrl;

    log(`Opening ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const report = await fillApplication({ page, plan, resumeFile, log });
    return { context, page, report };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}
