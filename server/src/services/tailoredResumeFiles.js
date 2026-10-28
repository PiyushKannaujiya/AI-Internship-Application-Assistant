import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

const PDF_MIME =
  "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function clean(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}

function safeSlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function fileBaseName({ job, revision }) {
  const company = safeSlug(job.company) || "company";
  const title = safeSlug(job.title) || "role";
  return `tailored-${company}-${title}-r${revision}`;
}

function contactLine(contact) {
  return [
    contact.location,
    contact.phone,
    contact.email,
    contact.linkedinUrl,
    contact.githubUrl,
    contact.portfolioUrl,
  ]
    .map(clean)
    .filter(Boolean)
    .join(" · ");
}

function experienceDates(entry) {
  if (!entry.startDate && !entry.endDate && !entry.current) return "";
  return `${entry.startDate || ""} – ${entry.current ? "Present" : entry.endDate || ""}`.trim();
}

function buildPdfBuffer({ content, user, job }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: `${clean(user.name)} – Tailored for ${clean(job.title)}`,
        Author: clean(user.name),
        Subject: "Tailored resume",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const heading = (text) => {
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#1f2937").text(text.toUpperCase());
      doc.moveDown(0.2);
      doc
        .strokeColor("#d1d5db")
        .lineWidth(0.6)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.4);
      doc.font("Helvetica").fontSize(10).fillColor("#111827");
    };

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827").text(clean(user.name));
    if (content.headline) {
      doc.font("Helvetica").fontSize(11).fillColor("#374151").text(clean(content.headline));
    }
    const contact = contactLine(content.contact || {});
    if (contact) {
      doc.fontSize(9).fillColor("#4b5563").text(contact);
    }

    if (content.summary) {
      heading("Summary");
      doc.text(clean(content.summary), { lineGap: 2 });
    }

    if (content.skills?.length) {
      heading("Skills");
      doc.text(content.skills.map(clean).filter(Boolean).join(" · "), { lineGap: 2 });
    }

    if (content.experience?.length) {
      heading("Experience");
      for (const entry of content.experience) {
        const title = [clean(entry.title), clean(entry.company)].filter(Boolean).join(" — ");
        if (title) doc.font("Helvetica-Bold").fontSize(10).text(title);
        const dates = experienceDates(entry);
        if (dates) doc.font("Helvetica-Oblique").fontSize(9).text(dates);
        if (entry.description) {
          doc.font("Helvetica").fontSize(10).text(clean(entry.description), { lineGap: 2 });
        }
        doc.moveDown(0.5);
      }
    }

    if (content.projects?.length) {
      heading("Projects");
      for (const project of content.projects) {
        const technologies = (project.technologies || []).map(clean).filter(Boolean);
        const name = clean(project.name);
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .text(technologies.length ? `${name} (${technologies.join(", ")})` : name);
        if (project.description) {
          doc.font("Helvetica").fontSize(10).text(clean(project.description), { lineGap: 2 });
        }
        for (const accomplishment of project.accomplishments || []) {
          doc.font("Helvetica").fontSize(10).text(`• ${clean(accomplishment.text)}`, {
            indent: 8,
            lineGap: 2,
          });
        }
        if (project.url) {
          doc.fontSize(8).fillColor("#4b5563").text(clean(project.url));
          doc.fillColor("#111827");
        }
        doc.moveDown(0.5);
      }
    }

    if (content.education?.length) {
      heading("Education");
      for (const entry of content.education) {
        const line = [clean(entry.degree), clean(entry.field), clean(entry.institution)]
          .filter(Boolean)
          .join(", ");
        if (line) doc.font("Helvetica-Bold").fontSize(10).text(line);
        const years = [entry.startYear, entry.endYear].filter(Boolean).join(" – ");
        if (years || entry.grade) {
          doc
            .font("Helvetica")
            .fontSize(9)
            .text([years, entry.grade].filter(Boolean).join(" · "));
        }
        doc.moveDown(0.4);
      }
    }

    if (content.certifications?.length) {
      heading("Certifications");
      for (const entry of content.certifications) {
        const line = [clean(entry.name), clean(entry.issuer), clean(entry.issueDate)]
          .filter(Boolean)
          .join(" · ");
        if (line) doc.font("Helvetica").fontSize(10).text(`• ${line}`, { indent: 8 });
      }
    }

    if (content.achievements?.length) {
      heading("Achievements");
      for (const entry of content.achievements) {
        const line = [clean(entry.title), clean(entry.issuer), clean(entry.date)]
          .filter(Boolean)
          .join(" · ");
        if (line) doc.font("Helvetica").fontSize(10).text(`• ${line}`, { indent: 8 });
      }
    }

    doc.end();
  });
}

function paragraph(text, options = {}) {
  return new Paragraph({
    alignment: options.alignment,
    heading: options.heading,
    spacing: { after: options.after ?? 80 },
    children: [
      new TextRun({
        text: clean(text),
        bold: Boolean(options.bold),
        italics: Boolean(options.italics),
        size: options.size ?? 21,
        color: options.color ?? "111827",
      }),
    ],
  });
}

function sectionHeading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 80 },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22, color: "1F2937" })],
  });
}

function buildDocxBuffer({ content, user, job }) {
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: clean(user.name), bold: true, size: 40 })],
    }),
  ];

  if (content.headline) {
    children.push(paragraph(content.headline, { size: 22, color: "374151" }));
  }

  const contact = contactLine(content.contact || {});
  if (contact) {
    children.push(paragraph(contact, { size: 18, color: "4B5563" }));
  }

  if (content.summary) {
    children.push(sectionHeading("Summary"), paragraph(content.summary));
  }

  if (content.skills?.length) {
    children.push(
      sectionHeading("Skills"),
      paragraph(content.skills.map(clean).filter(Boolean).join(" · "))
    );
  }

  if (content.experience?.length) {
    children.push(sectionHeading("Experience"));
    for (const entry of content.experience) {
      const title = [clean(entry.title), clean(entry.company)].filter(Boolean).join(" — ");
      if (title) children.push(paragraph(title, { bold: true }));
      const dates = experienceDates(entry);
      if (dates) children.push(paragraph(dates, { italics: true, size: 18, color: "4B5563" }));
      if (entry.description) children.push(paragraph(entry.description));
    }
  }

  if (content.projects?.length) {
    children.push(sectionHeading("Projects"));
    for (const project of content.projects) {
      const technologies = (project.technologies || []).map(clean).filter(Boolean);
      const name = clean(project.name);
      children.push(
        paragraph(
          technologies.length ? `${name} (${technologies.join(", ")})` : name,
          { bold: true }
        )
      );
      if (project.description) children.push(paragraph(project.description));
      for (const accomplishment of project.accomplishments || []) {
        children.push(
          paragraph(`• ${accomplishment.text}`, { after: 40 })
        );
      }
      if (project.url) {
        children.push(paragraph(project.url, { size: 18, color: "4B5563" }));
      }
    }
  }

  if (content.education?.length) {
    children.push(sectionHeading("Education"));
    for (const entry of content.education) {
      const line = [clean(entry.degree), clean(entry.field), clean(entry.institution)]
        .filter(Boolean)
        .join(", ");
      if (line) children.push(paragraph(line, { bold: true }));
      const years = [entry.startYear, entry.endYear].filter(Boolean).join(" – ");
      if (years || entry.grade) {
        children.push(paragraph([years, entry.grade].filter(Boolean).join(" · "), { size: 18 }));
      }
    }
  }

  if (content.certifications?.length) {
    children.push(sectionHeading("Certifications"));
    for (const entry of content.certifications) {
      const line = [clean(entry.name), clean(entry.issuer), clean(entry.issueDate)]
        .filter(Boolean)
        .join(" · ");
      if (line) children.push(paragraph(`• ${line}`, { after: 40 }));
    }
  }

  if (content.achievements?.length) {
    children.push(sectionHeading("Achievements"));
    for (const entry of content.achievements) {
      const line = [clean(entry.title), clean(entry.issuer), clean(entry.date)]
        .filter(Boolean)
        .join(" · ");
      if (line) children.push(paragraph(`• ${line}`, { after: 40 }));
    }
  }

  const document = new Document({
    creator: clean(user.name),
    title: `${clean(user.name)} – Tailored for ${clean(job.title)}`,
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

function metadata(buffer) {
  return {
    size: buffer.length,
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
}

export async function buildTailoredFiles({ content, user, job, revision }) {
  const baseName = fileBaseName({ job, revision });

  const [pdfBuffer, docxBuffer] = await Promise.all([
    buildPdfBuffer({ content, user, job }),
    buildDocxBuffer({ content, user, job }),
  ]);

  return [
    {
      format: "pdf",
      fileName: `${baseName}.pdf`,
      mimeType: PDF_MIME,
      ...metadata(pdfBuffer),
      data: pdfBuffer,
    },
    {
      format: "docx",
      fileName: `${baseName}.docx`,
      mimeType: DOCX_MIME,
      ...metadata(docxBuffer),
      data: docxBuffer,
    },
  ];
}

export const TAILORED_FILE_META = {
  pdf: { extension: "pdf", mimeType: PDF_MIME },
  docx: { extension: "docx", mimeType: DOCX_MIME },
};
