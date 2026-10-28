import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import Icon from "../components/Icon.jsx";
import { Notice } from "../components/Feedback.jsx";
import { ScoreRing } from "../components/Score.jsx";

const JOB_TYPES = [
  ["internship", "Internship"],
  ["full-time", "Full-time"],
  ["part-time", "Part-time"],
  ["contract", "Contract"],
  ["temporary", "Temporary"],
];

const WORK_MODES = [
  ["onsite", "On-site"],
  ["hybrid", "Hybrid"],
  ["remote", "Remote"],
];

const WORK_AUTHORIZATION_STATUSES = [
  ["prefer_not_to_say", "Prefer not to say"],
  ["citizen", "Citizen"],
  ["permanent_resident", "Permanent resident"],
  ["work_visa", "Work visa"],
  ["student_visa", "Student visa"],
  ["requires_sponsorship", "Requires sponsorship"],
  ["other", "Other"],
];

function blankEducation() {
  return {
    institution: "",
    degree: "",
    field: "",
    startYear: "",
    endYear: "",
    grade: "",
  };
}

function blankExperience() {
  return {
    company: "",
    title: "",
    startDate: "",
    endDate: "",
    current: false,
    description: "",
  };
}

function blankProject() {
  return {
    name: "",
    description: "",
    technologiesText: "",
    url: "",
    accomplishments: [],
  };
}

function blankAccomplishment() {
  return { text: "", verified: false };
}

function blankCertification() {
  return {
    name: "",
    issuer: "",
    issueDate: "",
    expiryDate: "",
    credentialId: "",
    url: "",
  };
}

function blankAchievement() {
  return { title: "", issuer: "", date: "", description: "" };
}

function blankAnswer() {
  return { question: "", answer: "", approved: false };
}

function toForm(user) {
  const profile = user?.profile || {};
  return {
    name: user?.name || "",
    headline: profile.headline || "",
    summary: profile.summary || "",
    phone: profile.phone || "",
    location: profile.location || "",
    portfolioUrl: profile.portfolioUrl || "",
    linkedinUrl: profile.linkedinUrl || "",
    githubUrl: profile.githubUrl || "",
    skillsText: (profile.skills || []).join(", "),
    preferredRolesText: (profile.preferredRoles || []).join(", "),
    preferredLocationsText: (profile.preferredLocations || []).join(", "),
    education: (profile.education || []).map((entry) => ({
      ...blankEducation(),
      ...entry,
      startYear: entry.startYear ?? "",
      endYear: entry.endYear ?? "",
    })),
    experience: (profile.experience || []).map((entry) => ({
      ...blankExperience(),
      ...entry,
    })),
    projects: (profile.projects || []).map((project) => ({
      ...blankProject(),
      ...project,
      technologiesText: (project.technologies || []).join(", "),
      accomplishments: (project.accomplishments || []).map((entry) => ({
        ...blankAccomplishment(),
        ...entry,
      })),
    })),
    certifications: (profile.certifications || []).map((entry) => ({
      ...blankCertification(),
      ...entry,
    })),
    achievements: (profile.achievements || []).map((entry) => ({
      ...blankAchievement(),
      ...entry,
    })),
    answerBank: (profile.answerBank || []).map((entry) => ({
      ...blankAnswer(),
      ...entry,
    })),
    workAuthorization: {
      status: profile.workAuthorization?.status || "prefer_not_to_say",
      requiresSponsorship: Boolean(
        profile.workAuthorization?.requiresSponsorship
      ),
      note: profile.workAuthorization?.note || "",
    },
    jobPreferences: {
      jobTypes: profile.jobPreferences?.jobTypes || [],
      remoteOnly: Boolean(profile.jobPreferences?.remoteOnly),
      workModes: profile.jobPreferences?.workModes || [],
      willRelocate: Boolean(profile.jobPreferences?.willRelocate),
      availability: profile.jobPreferences?.availability || "",
      noticePeriod: profile.jobPreferences?.noticePeriod || "",
      minimumStipend: profile.jobPreferences?.minimumStipend || "",
    },
  };
}

function splitList(value) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function optionalUrl(value) {
  if (!value.trim()) return true;
  try {
    return ["http:", "https:"].includes(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [form, setForm] = useState(() => toForm(user));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (user) setForm(toForm(user));
  }, [user?.id, user?.updatedAt]);

  const skills = useMemo(() => splitList(form.skillsText), [form.skillsText]);
  const completion = user?.profileCompleteness || { percent: 0, missing: [] };

  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const setPref = (field) => (event) =>
    setForm((current) => ({
      ...current,
      jobPreferences: { ...current.jobPreferences, [field]: event.target.value },
    }));

  function toggleJobType(type) {
    setForm((current) => {
      const currentTypes = current.jobPreferences.jobTypes;
      return {
        ...current,
        jobPreferences: {
          ...current.jobPreferences,
          jobTypes: currentTypes.includes(type)
            ? currentTypes.filter((item) => item !== type)
            : [...currentTypes, type],
        },
      };
    });
  }

  function updateEducation(index, field, value) {
    setForm((current) => ({
      ...current,
      education: current.education.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      ),
    }));
  }

  function updateExperience(index, field, value) {
    setForm((current) => ({
      ...current,
      experience: current.experience.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      ),
    }));
  }

  function removeEducation(index) {
    setForm((current) => ({
      ...current,
      education: current.education.filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function removeExperience(index) {
    setForm((current) => ({
      ...current,
      experience: current.experience.filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function addEntry(listKey, entry) {
    setForm((current) => ({
      ...current,
      [listKey]: [...current[listKey], entry],
    }));
  }

  function updateEntry(listKey, index, field, value) {
    setForm((current) => ({
      ...current,
      [listKey]: current[listKey].map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      ),
    }));
  }

  function removeEntry(listKey, index) {
    setForm((current) => ({
      ...current,
      [listKey]: current[listKey].filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function toggleWorkMode(mode) {
    setForm((current) => {
      const modes = current.jobPreferences.workModes;
      return {
        ...current,
        jobPreferences: {
          ...current.jobPreferences,
          workModes: modes.includes(mode)
            ? modes.filter((item) => item !== mode)
            : [...modes, mode],
        },
      };
    });
  }

  function updateAccomplishment(projectIndex, accomplishmentIndex, field, value) {
    setForm((current) => ({
      ...current,
      projects: current.projects.map((project, index) =>
        index === projectIndex
          ? {
              ...project,
              accomplishments: project.accomplishments.map((entry, entryIndex) =>
                entryIndex === accomplishmentIndex
                  ? { ...entry, [field]: value }
                  : entry
              ),
            }
          : project
      ),
    }));
  }

  function addAccomplishment(projectIndex) {
    setForm((current) => ({
      ...current,
      projects: current.projects.map((project, index) =>
        index === projectIndex
          ? { ...project, accomplishments: [...project.accomplishments, blankAccomplishment()] }
          : project
      ),
    }));
  }

  function removeAccomplishment(projectIndex, accomplishmentIndex) {
    setForm((current) => ({
      ...current,
      projects: current.projects.map((project, index) =>
        index === projectIndex
          ? {
              ...project,
              accomplishments: project.accomplishments.filter(
                (_, entryIndex) => entryIndex !== accomplishmentIndex
              ),
            }
          : project
      ),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setNotice(null);

    const nextErrors = {};
    if (form.name.trim().length < 2) nextErrors.name = "Enter your full name";
    if (!optionalUrl(form.portfolioUrl)) nextErrors.portfolioUrl = "Enter a valid http(s) URL";
    if (!optionalUrl(form.linkedinUrl)) nextErrors.linkedinUrl = "Enter a valid http(s) URL";
    if (!optionalUrl(form.githubUrl)) nextErrors.githubUrl = "Enter a valid http(s) URL";
    if (skills.length > 50) nextErrors.skills = "List at most 50 skills";
    if (
      form.projects.some(
        (project) => project.name.trim() && !optionalUrl(project.url)
      )
    ) {
      nextErrors.projects = "Project links must be valid http(s) URLs";
    }
    if (
      form.certifications.some(
        (entry) => entry.name.trim() && !optionalUrl(entry.url)
      )
    ) {
      nextErrors.certifications = "Certification links must be valid http(s) URLs";
    }
    if (form.answerBank.some((entry) => entry.approved && !entry.answer.trim())) {
      nextErrors.answerBank =
        "Approved answers need an answer. Uncheck approval or write the answer.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      await api.users.update({
        name: form.name.trim(),
        profile: {
          headline: form.headline.trim(),
          summary: form.summary.trim(),
          phone: form.phone.trim(),
          location: form.location.trim(),
          portfolioUrl: form.portfolioUrl.trim(),
          linkedinUrl: form.linkedinUrl.trim(),
          githubUrl: form.githubUrl.trim(),
          skills,
          preferredRoles: splitList(form.preferredRolesText),
          preferredLocations: splitList(form.preferredLocationsText),
          education: form.education.map((entry) => ({
            ...entry,
            startYear: entry.startYear ? Number(entry.startYear) : undefined,
            endYear: entry.endYear ? Number(entry.endYear) : undefined,
          })),
          experience: form.experience,
          projects: form.projects
            .filter((project) => project.name.trim())
            .map((project) => ({
              name: project.name.trim(),
              description: project.description.trim(),
              technologies: splitList(project.technologiesText),
              url: project.url.trim(),
              accomplishments: project.accomplishments
                .filter((entry) => entry.text.trim())
                .map((entry) => ({
                  text: entry.text.trim(),
                  verified: Boolean(entry.verified),
                })),
            })),
          certifications: form.certifications
            .filter((entry) => entry.name.trim())
            .map((entry) => ({
              name: entry.name.trim(),
              issuer: entry.issuer.trim(),
              issueDate: entry.issueDate.trim(),
              expiryDate: entry.expiryDate.trim(),
              credentialId: entry.credentialId.trim(),
              url: entry.url.trim(),
            })),
          achievements: form.achievements
            .filter((entry) => entry.title.trim())
            .map((entry) => ({
              title: entry.title.trim(),
              issuer: entry.issuer.trim(),
              date: entry.date.trim(),
              description: entry.description.trim(),
            })),
          answerBank: form.answerBank
            .filter((entry) => entry.question.trim() && entry.answer.trim())
            .map((entry) => ({
              question: entry.question.trim(),
              answer: entry.answer.trim(),
              approved: Boolean(entry.approved),
            })),
          workAuthorization: {
            status: form.workAuthorization.status,
            requiresSponsorship: Boolean(
              form.workAuthorization.requiresSponsorship
            ),
            note: form.workAuthorization.note.trim(),
          },
          jobPreferences: {
            ...form.jobPreferences,
            willRelocate: Boolean(form.jobPreferences.willRelocate),
          },
        },
      });
      await refreshUser();
      setNotice({ variant: "success", text: "Profile saved. Matching and drafts now use these details." });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setNotice({ variant: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Your verified details</span>
          <h2>Build a profile worth reusing</h2>
          <p>
            Only add information that is accurate. Matching and generated drafts
            rely on these facts.
          </p>
        </div>
        <div className="completion-card">
          <ScoreRing score={completion.percent} size={64} label="complete" />
          <div>
            <strong>{completion.percent}% complete</strong>
            <span>
              {completion.missing.length
                ? `${completion.missing.length} field${completion.missing.length === 1 ? "" : "s"} left`
                : "Everything looks good"}
            </span>
          </div>
        </div>
      </section>

      {notice && (
        <Notice variant={notice.variant} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      <form id="profile-form" onSubmit={handleSubmit} noValidate className="page-stack">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>Basics</h3>
              <p>How employers will identify you.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Full name</span>
              <input value={form.name} onChange={set("name")} autoComplete="name" />
              {errors.name && <small className="field-error">{errors.name}</small>}
            </label>
            <label className="field">
              <span>Email (account)</span>
              <input value={user?.email || ""} disabled />
              <small className="field-hint">Email changes are not supported yet.</small>
            </label>
            <label className="field">
              <span>Phone</span>
              <input
                value={form.phone}
                onChange={set("phone")}
                autoComplete="tel"
                placeholder="+91 98765 43210"
              />
            </label>
            <label className="field">
              <span>Location</span>
              <input
                value={form.location}
                onChange={set("location")}
                placeholder="Bengaluru, India"
              />
            </label>
            <label className="field field--full">
              <span>Headline</span>
              <input
                value={form.headline}
                onChange={set("headline")}
                maxLength={160}
                placeholder="Backend engineering student focused on Node.js and MongoDB"
              />
            </label>
            <label className="field field--full">
              <span>Professional summary</span>
              <textarea
                rows={4}
                value={form.summary}
                onChange={set("summary")}
                maxLength={3000}
                placeholder="Two or three sentences about your focus, strongest projects, and what you want to learn next."
              />
              <small className="field-hint">{form.summary.length}/3000</small>
            </label>
            <label className="field">
              <span>Portfolio URL</span>
              <input
                value={form.portfolioUrl}
                onChange={set("portfolioUrl")}
                placeholder="https://your-portfolio.dev"
              />
              {errors.portfolioUrl && <small className="field-error">{errors.portfolioUrl}</small>}
            </label>
            <label className="field">
              <span>LinkedIn URL</span>
              <input
                value={form.linkedinUrl}
                onChange={set("linkedinUrl")}
                placeholder="https://linkedin.com/in/you"
              />
              {errors.linkedinUrl && <small className="field-error">{errors.linkedinUrl}</small>}
            </label>
            <label className="field">
              <span>GitHub URL</span>
              <input
                value={form.githubUrl}
                onChange={set("githubUrl")}
                placeholder="https://github.com/you"
              />
              {errors.githubUrl && <small className="field-error">{errors.githubUrl}</small>}
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Skills and preferences</h3>
              <p>Used for match scoring and role recommendations.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field field--full">
              <span>Skills</span>
              <input
                value={form.skillsText}
                onChange={set("skillsText")}
                placeholder="JavaScript, Node.js, Express, MongoDB, React"
              />
              <small className="field-hint">
                Comma-separated. {skills.length} skill{skills.length === 1 ? "" : "s"} added.
              </small>
              {errors.skills && <small className="field-error">{errors.skills}</small>}
              {skills.length > 0 && (
                <span className="chip-row chip-row--wrap">
                  {skills.map((skill) => (
                    <span className="chip" key={skill}>
                      {skill}
                    </span>
                  ))}
                </span>
              )}
            </label>
            <label className="field">
              <span>Preferred roles</span>
              <input
                value={form.preferredRolesText}
                onChange={set("preferredRolesText")}
                placeholder="Backend Engineer, Software Intern"
              />
              <small className="field-hint">Comma-separated</small>
            </label>
            <label className="field">
              <span>Preferred locations</span>
              <input
                value={form.preferredLocationsText}
                onChange={set("preferredLocationsText")}
                placeholder="Remote, Bengaluru"
              />
              <small className="field-hint">Comma-separated</small>
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Education</h3>
              <p>Most recent first.</p>
            </div>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  education: [...current.education, blankEducation()],
                }))
              }
            >
              <Icon name="plus" size={15} /> Add education
            </button>
          </div>

          {form.education.length === 0 ? (
            <p className="soft-empty">No education added yet.</p>
          ) : (
            <div className="repeat-list">
              {form.education.map((entry, index) => (
                <div className="repeat-item" key={`education-${index}`}>
                  <div className="repeat-head">
                    <strong>Education {index + 1}</strong>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => removeEducation(index)}
                      aria-label="Remove education entry"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="form-grid">
                    <label className="field">
                      <span>Institution</span>
                      <input
                        value={entry.institution}
                        onChange={(event) => updateEducation(index, "institution", event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Degree</span>
                      <input
                        value={entry.degree}
                        onChange={(event) => updateEducation(index, "degree", event.target.value)}
                        placeholder="B.Tech"
                      />
                    </label>
                    <label className="field">
                      <span>Field of study</span>
                      <input
                        value={entry.field}
                        onChange={(event) => updateEducation(index, "field", event.target.value)}
                        placeholder="Computer Science"
                      />
                    </label>
                    <label className="field">
                      <span>Grade / GPA</span>
                      <input
                        value={entry.grade}
                        onChange={(event) => updateEducation(index, "grade", event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Start year</span>
                      <input
                        type="number"
                        min="1950"
                        max="2100"
                        value={entry.startYear}
                        onChange={(event) => updateEducation(index, "startYear", event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>End year</span>
                      <input
                        type="number"
                        min="1950"
                        max="2100"
                        value={entry.endYear}
                        onChange={(event) => updateEducation(index, "endYear", event.target.value)}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Experience</h3>
              <p>Internships, freelance work, and relevant projects.</p>
            </div>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  experience: [...current.experience, blankExperience()],
                }))
              }
            >
              <Icon name="plus" size={15} /> Add experience
            </button>
          </div>

          {form.experience.length === 0 ? (
            <p className="soft-empty">No experience added yet.</p>
          ) : (
            <div className="repeat-list">
              {form.experience.map((entry, index) => (
                <div className="repeat-item" key={`experience-${index}`}>
                  <div className="repeat-head">
                    <strong>Experience {index + 1}</strong>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => removeExperience(index)}
                      aria-label="Remove experience entry"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="form-grid">
                    <label className="field">
                      <span>Company</span>
                      <input
                        value={entry.company}
                        onChange={(event) => updateExperience(index, "company", event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Title</span>
                      <input
                        value={entry.title}
                        onChange={(event) => updateExperience(index, "title", event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Start date</span>
                      <input
                        value={entry.startDate}
                        onChange={(event) => updateExperience(index, "startDate", event.target.value)}
                        placeholder="Jun 2025"
                      />
                    </label>
                    <label className="field">
                      <span>End date</span>
                      <input
                        value={entry.endDate}
                        onChange={(event) => updateExperience(index, "endDate", event.target.value)}
                        placeholder="Aug 2025"
                        disabled={entry.current}
                      />
                    </label>
                    <label className="checkbox-field field--full">
                      <input
                        type="checkbox"
                        checked={entry.current}
                        onChange={(event) => updateExperience(index, "current", event.target.checked)}
                      />
                      <span>I currently work here</span>
                    </label>
                    <label className="field field--full">
                      <span>Description</span>
                      <textarea
                        rows={3}
                        value={entry.description}
                        onChange={(event) =>
                          updateExperience(index, "description", event.target.value)
                        }
                        placeholder="What did you build, and what was the measurable outcome?"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Projects</h3>
              <p>
                Technologies and measurable outcomes you can defend in an
                interview. Tick only accomplishments you can verify.
              </p>
            </div>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => addEntry("projects", blankProject())}
            >
              <Icon name="plus" size={15} /> Add project
            </button>
          </div>

          {errors.projects && <small className="field-error">{errors.projects}</small>}

          {form.projects.length === 0 ? (
            <p className="soft-empty">No projects added yet.</p>
          ) : (
            <div className="repeat-list">
              {form.projects.map((project, index) => (
                <div className="repeat-item" key={`project-${index}`}>
                  <div className="repeat-head">
                    <strong>Project {index + 1}</strong>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove project"
                      onClick={() => removeEntry("projects", index)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="form-grid">
                    <label className="field">
                      <span>Project name</span>
                      <input
                        value={project.name}
                        onChange={(event) =>
                          updateEntry("projects", index, "name", event.target.value)
                        }
                        placeholder="Internship Tracker"
                      />
                    </label>
                    <label className="field">
                      <span>Project link</span>
                      <input
                        value={project.url}
                        onChange={(event) =>
                          updateEntry("projects", index, "url", event.target.value)
                        }
                        placeholder="https://github.com/you/project"
                      />
                    </label>
                    <label className="field field--full">
                      <span>Description</span>
                      <textarea
                        rows={3}
                        value={project.description}
                        onChange={(event) =>
                          updateEntry(
                            "projects",
                            index,
                            "description",
                            event.target.value
                          )
                        }
                        placeholder="What it does, who uses it, and the outcome."
                      />
                    </label>
                    <label className="field field--full">
                      <span>Technologies</span>
                      <input
                        value={project.technologiesText}
                        onChange={(event) =>
                          updateEntry(
                            "projects",
                            index,
                            "technologiesText",
                            event.target.value
                          )
                        }
                        placeholder="Node.js, Express, MongoDB"
                      />
                      <small className="field-hint">Comma-separated</small>
                    </label>
                    <div className="field field--full">
                      <span>Accomplishments</span>
                      <div className="repeat-list">
                        {project.accomplishments.map((entry, entryIndex) => (
                          <div
                            className="repeat-item"
                            key={`accomplishment-${index}-${entryIndex}`}
                          >
                            <div className="form-grid">
                              <label className="field field--full">
                                <span>Accomplishment {entryIndex + 1}</span>
                                <input
                                  value={entry.text}
                                  onChange={(event) =>
                                    updateAccomplishment(
                                      index,
                                      entryIndex,
                                      "text",
                                      event.target.value
                                    )
                                  }
                                  placeholder="Reduced duplicate entries by 40%"
                                />
                              </label>
                              <label className="checkbox-field">
                                <input
                                  type="checkbox"
                                  checked={Boolean(entry.verified)}
                                  onChange={(event) =>
                                    updateAccomplishment(
                                      index,
                                      entryIndex,
                                      "verified",
                                      event.target.checked
                                    )
                                  }
                                />
                                <span>I can verify this</span>
                              </label>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="Remove accomplishment"
                                onClick={() =>
                                  removeAccomplishment(index, entryIndex)
                                }
                              >
                                <Icon name="trash" size={15} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() => addAccomplishment(index)}
                        >
                          <Icon name="plus" size={14} /> Add accomplishment
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Certifications</h3>
              <p>Courses and credentials with a verifiable source.</p>
            </div>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => addEntry("certifications", blankCertification())}
            >
              <Icon name="plus" size={15} /> Add certification
            </button>
          </div>

          {errors.certifications && (
            <small className="field-error">{errors.certifications}</small>
          )}

          {form.certifications.length === 0 ? (
            <p className="soft-empty">No certifications added yet.</p>
          ) : (
            <div className="repeat-list">
              {form.certifications.map((entry, index) => (
                <div className="repeat-item" key={`certification-${index}`}>
                  <div className="repeat-head">
                    <strong>Certification {index + 1}</strong>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove certification"
                      onClick={() => removeEntry("certifications", index)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="form-grid">
                    <label className="field field--full">
                      <span>Certification name</span>
                      <input
                        value={entry.name}
                        onChange={(event) =>
                          updateEntry(
                            "certifications",
                            index,
                            "name",
                            event.target.value
                          )
                        }
                        placeholder="AWS Certified Cloud Practitioner"
                      />
                    </label>
                    <label className="field">
                      <span>Issuer</span>
                      <input
                        value={entry.issuer}
                        onChange={(event) =>
                          updateEntry(
                            "certifications",
                            index,
                            "issuer",
                            event.target.value
                          )
                        }
                        placeholder="Amazon Web Services"
                      />
                    </label>
                    <label className="field">
                      <span>Issue date</span>
                      <input
                        value={entry.issueDate}
                        onChange={(event) =>
                          updateEntry(
                            "certifications",
                            index,
                            "issueDate",
                            event.target.value
                          )
                        }
                        placeholder="2025"
                      />
                    </label>
                    <label className="field">
                      <span>Expiry date</span>
                      <input
                        value={entry.expiryDate}
                        onChange={(event) =>
                          updateEntry(
                            "certifications",
                            index,
                            "expiryDate",
                            event.target.value
                          )
                        }
                        placeholder="Optional"
                      />
                    </label>
                    <label className="field">
                      <span>Credential ID</span>
                      <input
                        value={entry.credentialId}
                        onChange={(event) =>
                          updateEntry(
                            "certifications",
                            index,
                            "credentialId",
                            event.target.value
                          )
                        }
                      />
                    </label>
                    <label className="field field--full">
                      <span>Verification link</span>
                      <input
                        value={entry.url}
                        onChange={(event) =>
                          updateEntry(
                            "certifications",
                            index,
                            "url",
                            event.target.value
                          )
                        }
                        placeholder="https://…"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Achievements</h3>
              <p>Awards, rankings, scholarships, and other recognitions.</p>
            </div>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => addEntry("achievements", blankAchievement())}
            >
              <Icon name="plus" size={15} /> Add achievement
            </button>
          </div>

          {form.achievements.length === 0 ? (
            <p className="soft-empty">No achievements added yet.</p>
          ) : (
            <div className="repeat-list">
              {form.achievements.map((entry, index) => (
                <div className="repeat-item" key={`achievement-${index}`}>
                  <div className="repeat-head">
                    <strong>Achievement {index + 1}</strong>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove achievement"
                      onClick={() => removeEntry("achievements", index)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="form-grid">
                    <label className="field field--full">
                      <span>Achievement title</span>
                      <input
                        value={entry.title}
                        onChange={(event) =>
                          updateEntry(
                            "achievements",
                            index,
                            "title",
                            event.target.value
                          )
                        }
                        placeholder="Winner, Smart India Hackathon"
                      />
                    </label>
                    <label className="field">
                      <span>Issuer</span>
                      <input
                        value={entry.issuer}
                        onChange={(event) =>
                          updateEntry(
                            "achievements",
                            index,
                            "issuer",
                            event.target.value
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Date</span>
                      <input
                        value={entry.date}
                        onChange={(event) =>
                          updateEntry(
                            "achievements",
                            index,
                            "date",
                            event.target.value
                          )
                        }
                        placeholder="2025"
                      />
                    </label>
                    <label className="field field--full">
                      <span>Details</span>
                      <textarea
                        rows={2}
                        value={entry.description}
                        onChange={(event) =>
                          updateEntry(
                            "achievements",
                            index,
                            "description",
                            event.target.value
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Saved application answers</h3>
              <p>
                Reusable answers for common questions. Only answers you approve
                are offered in the application preview.
              </p>
            </div>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => addEntry("answerBank", blankAnswer())}
            >
              <Icon name="plus" size={15} /> Add answer
            </button>
          </div>

          {errors.answerBank && (
            <small className="field-error">{errors.answerBank}</small>
          )}

          {form.answerBank.length === 0 ? (
            <p className="soft-empty">No saved answers yet.</p>
          ) : (
            <div className="repeat-list">
              {form.answerBank.map((entry, index) => (
                <div className="repeat-item" key={`answer-${index}`}>
                  <div className="repeat-head">
                    <strong>Answer {index + 1}</strong>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove saved answer"
                      onClick={() => removeEntry("answerBank", index)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="form-grid">
                    <label className="field field--full">
                      <span>Question</span>
                      <input
                        value={entry.question}
                        onChange={(event) =>
                          updateEntry(
                            "answerBank",
                            index,
                            "question",
                            event.target.value
                          )
                        }
                        placeholder="Why do you want this role?"
                      />
                    </label>
                    <label className="field field--full">
                      <span>Answer</span>
                      <textarea
                        rows={3}
                        value={entry.answer}
                        onChange={(event) =>
                          updateEntry(
                            "answerBank",
                            index,
                            "answer",
                            event.target.value
                          )
                        }
                        placeholder="A specific, honest answer you can defend."
                      />
                    </label>
                    <label className="checkbox-field field--full">
                      <input
                        type="checkbox"
                        checked={Boolean(entry.approved)}
                        onChange={(event) =>
                          updateEntry(
                            "answerBank",
                            index,
                            "approved",
                            event.target.checked
                          )
                        }
                      />
                      <span>Approved for reuse in application previews</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Work authorization</h3>
              <p>
                Used only to prefill your own applications. Nothing is shared
                with employers by this app.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Work authorization status</span>
              <select
                value={form.workAuthorization.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    workAuthorization: {
                      ...current.workAuthorization,
                      status: event.target.value,
                    },
                  }))
                }
              >
                {WORK_AUTHORIZATION_STATUSES.map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Authorization note</span>
              <input
                value={form.workAuthorization.note}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    workAuthorization: {
                      ...current.workAuthorization,
                      note: event.target.value,
                    },
                  }))
                }
                placeholder="Valid until 2028"
              />
            </label>
            <label className="checkbox-field field--full">
              <input
                type="checkbox"
                checked={Boolean(form.workAuthorization.requiresSponsorship)}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    workAuthorization: {
                      ...current.workAuthorization,
                      requiresSponsorship: event.target.checked,
                    },
                  }))
                }
              />
              <span>I will need visa sponsorship</span>
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h3>Job preferences</h3>
              <p>Helps the matcher weigh role and location fit.</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field field--full">
              <span>Job types</span>
              <div className="checkbox-grid">
                {JOB_TYPES.map(([value, label]) => (
                  <label className="checkbox-field" key={value}>
                    <input
                      type="checkbox"
                      checked={form.jobPreferences.jobTypes.includes(value)}
                      onChange={() => toggleJobType(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="field field--full">
              <span>Work modes</span>
              <div className="checkbox-grid">
                {WORK_MODES.map(([value, label]) => (
                  <label className="checkbox-field" key={value}>
                    <input
                      type="checkbox"
                      checked={form.jobPreferences.workModes.includes(value)}
                      onChange={() => toggleWorkMode(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="checkbox-field field--full">
              <input
                type="checkbox"
                checked={form.jobPreferences.remoteOnly}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    jobPreferences: {
                      ...current.jobPreferences,
                      remoteOnly: event.target.checked,
                    },
                  }))
                }
              />
              <span>I only want remote roles</span>
            </label>
            <label className="checkbox-field field--full">
              <input
                type="checkbox"
                checked={Boolean(form.jobPreferences.willRelocate)}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    jobPreferences: {
                      ...current.jobPreferences,
                      willRelocate: event.target.checked,
                    },
                  }))
                }
              />
              <span>I am open to relocating</span>
            </label>
            <label className="field">
              <span>Availability</span>
              <input
                value={form.jobPreferences.availability}
                onChange={setPref("availability")}
                placeholder="Immediately / June 2027"
              />
            </label>
            <label className="field">
              <span>Notice period</span>
              <input
                value={form.jobPreferences.noticePeriod}
                onChange={setPref("noticePeriod")}
                placeholder="30 days"
              />
            </label>
            <label className="field">
              <span>Minimum stipend</span>
              <input
                value={form.jobPreferences.minimumStipend}
                onChange={setPref("minimumStipend")}
                placeholder="₹25,000 / month"
              />
            </label>
          </div>
        </section>

        <div className="sticky-actions">
          <p>
            <Icon name="shield" size={15} /> These details are used only for your own matches and drafts.
          </p>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? <span className="spinner spinner--small" /> : <Icon name="check" size={17} />}
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
