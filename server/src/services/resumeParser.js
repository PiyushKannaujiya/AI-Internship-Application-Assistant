import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { ApiError } from "../utils/ApiError.js";
import {
  extractEducationMentions,
  extractExperienceYears,
  extractSkills,
} from "../utils/skills.js";
import { buildExtractionProposals } from "./resumeExtraction.js";

const MAX_TEXT_CHARS = 200000;

export function assertFileSignature(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    throw ApiError.badRequest("The uploaded file is empty or unreadable");
  }

  if (mimeType === "application/pdf") {
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw ApiError.badRequest("The uploaded file is not a valid PDF");
    }
    return;
  }

  // DOCX files are ZIP containers; "PK" is the ZIP magic number.
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw ApiError.badRequest("The uploaded file is not a valid DOCX document");
  }
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocxText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

function normalizeText(text) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

export async function parseResumeBuffer(buffer, mimeType) {
  assertFileSignature(buffer, mimeType);

  let rawText;
  try {
    rawText =
      mimeType === "application/pdf"
        ? await extractPdfText(buffer)
        : await extractDocxText(buffer);
  } catch {
    throw ApiError.unprocessable(
      "Could not read this resume. Make sure it is a valid, non-password-protected PDF or DOCX file."
    );
  }

  const text = normalizeText(rawText);

  if (text.length < 30) {
    throw ApiError.unprocessable(
      "No readable text was found. Scanned/image-only PDFs cannot be parsed; upload a text-based PDF or DOCX."
    );
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    parsed: {
      skills: extractSkills(text),
      experienceYears: extractExperienceYears(text),
      educationMentions: extractEducationMentions(text),
      proposals: buildExtractionProposals(text),
      wordCount,
      extractionWarning:
        wordCount < 80
          ? "Very little text was extracted. The resume may be mostly graphical."
          : "",
    },
  };
}
