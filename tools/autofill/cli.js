#!/usr/bin/env node
/**
 * ApplyPilot local autofill helper.
 *
 * Visible, human-supervised, and deliberately incapable of submitting: this
 * file never calls click(), submit(), or requestSubmit(), and it refuses to run
 * when a plan does not carry the no-submit policy.
 *
 * Usage:
 *   node tools/autofill/cli.js --plan plan.json --resume-pdf ./resume.pdf
 *   node tools/autofill/cli.js --api http://localhost:5000/api --token $TOKEN \
 *     --application <applicationId>
 *
 * Options:
 *   --plan <file>        Plan JSON saved from the application preview.
 *   --application <id>   Fetch the plan and resumes from your local API.
 *   --token <jwt>        API token (only needed with --application).
 *   --api <url>          API base URL, default http://localhost:5000/api.
 *   --resume-pdf <file>  Local PDF to attach (downloaded automatically when an
 *                        API token is supplied).
 *   --resume-docx <file> Local DOCX fallback.
 *   --url <url>          Override the application URL.
 *   --profile-dir <dir>  Persistent Chromium profile, default .autofill-profile.
 *   --report <file>      Write the run report as JSON.
 *   --headless           Only for automated tests; normal runs are visible.
 *   --no-wait            Close the browser after filling instead of waiting.
 */
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PlanError,
  selectResumeFile,
  validatePlanSafety,
} from "./lib/plan.js";
import { launchSession } from "./lib/session.js";

const DEFAULT_API = "http://localhost:5000/api";
const DEFAULT_PROFILE_DIR = ".autofill-profile";

function parseArgs(argv) {
  const args = {
    api: DEFAULT_API,
    profileDir: DEFAULT_PROFILE_DIR,
    headless: false,
    wait: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    switch (arg) {
      case "--plan":
        args.plan = next();
        break;
      case "--application":
        args.application = next();
        break;
      case "--token":
        args.token = next();
        break;
      case "--api":
        args.api = next().replace(/\/+$/, "");
        break;
      case "--resume-pdf":
        args.resumePdf = next();
        break;
      case "--resume-docx":
        args.resumeDocx = next();
        break;
      case "--url":
        args.url = next();
        break;
      case "--profile-dir":
        args.profileDir = next();
        break;
      case "--report":
        args.report = next();
        break;
      case "--headless":
        args.headless = true;
        break;
      case "--no-wait":
        args.wait = false;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return `ApplyPilot autofill helper (local, visible, never submits)

  node tools/autofill/cli.js --plan <plan.json> --resume-pdf <file>
  node tools/autofill/cli.js --application <id> --token <jwt>

Read docs/AUTOFILL.md before the first run.`;
}

async function apiRequest(args, routePath, options = {}) {
  if (!args.token) throw new Error("This action needs --token with your API token.");

  const response = await fetch(`${args.api}${routePath}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${args.token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `API returned HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }

  return response;
}

async function fetchPlan(args) {
  const response = await apiRequest(
    args,
    `/applications/${encodeURIComponent(args.application)}/autofill-plan`
  );
  const body = await response.json();
  return body.data.plan;
}

function safeFileName(name, fallback) {
  const base = path.basename(String(name || "")).replace(/[^\w.\- ]+/g, "_");
  return base || fallback;
}

async function downloadResumes(args, plan) {
  if (!args.token || !args.application || !plan.resume?.files?.length) {
    return {};
  }

  const directory = await mkdtemp(path.join(tmpdir(), "applypilot-resume-"));
  const paths = {};

  for (const file of plan.resume.files) {
    const response = await apiRequest(
      args,
      `/tailored-resumes/${encodeURIComponent(plan.resume.tailoredResumeId)}/download/${file.format}`
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    const target = path.join(
      directory,
      safeFileName(file.fileName, `resume.${file.format}`)
    );
    await writeFile(target, buffer, { mode: 0o600 });
    paths[file.format] = target;
  }

  return paths;
}

function waitForUser() {
  if (!process.stdin.isTTY) return Promise.resolve();

  return new Promise((resolve) => {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readline.question(
      "\nThe form is filled and the browser is open. Review it and submit yourself if you choose.\nPress Enter to close the helper (nothing will be submitted): ",
      () => {
        readline.close();
        resolve();
      }
    );
  });
}

function printManualFallback(plan, error) {
  console.log(`\nManual fallback for this portal:\n`);
  console.log(`  ${error.message}\n`);
  for (const instruction of plan?.manualFallback?.instructions || [
    "Open the employer's application page and paste verified values yourself.",
  ]) {
    console.log(`  - ${instruction}`);
  }
  console.log(
    "\nNo browser was opened and nothing was submitted. This helper never fills unsupported forms."
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return 0;
  }

  if (!args.plan && !args.application) {
    console.error(usage());
    return 1;
  }

  let plan;
  try {
    plan = args.plan
      ? JSON.parse(await readFile(args.plan, "utf8"))
      : await fetchPlan(args);
  } catch (error) {
    console.error(`Could not load the plan: ${error.message}`);
    return 1;
  }

  try {
    validatePlanSafety(plan);
  } catch (error) {
    if (error instanceof PlanError && error.code === "PLAN_BLOCKED") {
      printManualFallback(plan, error);
      return 2;
    }
    console.error(`Refusing to run: ${error.message}`);
    return 2;
  }

  if (!plan.adapter?.autofillSupported) {
    printManualFallback(
      plan,
      new PlanError("This portal has no maintained adapter.", "PLAN_BLOCKED")
    );
    return 2;
  }

  const downloaded = await downloadResumes(args, plan).catch((error) => {
    console.error(`Could not download the approved resume: ${error.message}`);
    return {};
  });

  const resumeFile = selectResumeFile(plan, {
    pdf: args.resumePdf || downloaded.pdf,
    docx: args.resumeDocx || downloaded.docx,
  });

  if (!resumeFile) {
    console.error(
      "No approved resume file is available. Approve a tailored resume (or pass --resume-pdf) before running autofill."
    );
    return 2;
  }

  await mkdir(args.profileDir, { recursive: true });

  let session;
  try {
    session = await launchSession({
      plan,
      resumeFile,
      url: args.url,
      headless: args.headless,
      profileDir: args.profileDir,
      log: (message) => console.log(message),
    });
  } catch (error) {
    console.error(`Autofill stopped: ${error.message}`);
    return 1;
  }

  const { context, report } = session;

  console.log(`\nRun status: ${report.status}`);
  console.log(`  Fields filled:        ${report.filledFields.length}`);
  console.log(`  Missing fields:       ${report.missingFields.length}`);
  console.log(`  Validation messages:  ${report.validationErrors.length}`);
  console.log(`  Resume attached:      ${report.resumeUploaded ? "yes" : "no"}`);
  console.log(`  Saved answers filled: ${report.answersFilled.length}`);
  console.log(
    `  Final controls left untouched: ${report.finalSubmissionControls.length}`
  );
  console.log("  Submitted:            no (this helper cannot submit)");

  if (args.report) {
    await writeFile(args.report, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nReport written to ${args.report}`);
  }

  if (args.application && args.token) {
    try {
      const { finalSubmissionControls, ...payload } = report;
      void finalSubmissionControls;
      await apiRequest(args, `/applications/${encodeURIComponent(args.application)}/autofill-runs`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      console.log("Run report saved to your application timeline.");
    } catch (error) {
      console.error(`Could not save the run report: ${error.message}`);
    }
  }

  if (args.headless || !args.wait) {
    await context.close().catch(() => {});
    return 0;
  }

  await waitForUser();
  await context.close().catch(() => {});
  console.log(
    "Browser closed. Nothing was submitted. Record the application yourself after you submit on the employer's site."
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
