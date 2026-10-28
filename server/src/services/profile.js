export function profileCompleteness(profile = {}) {
  const checks = [
    { key: "name", done: Boolean(profile.name), weight: 10 },
    { key: "headline", done: Boolean(profile.headline), weight: 10 },
    { key: "summary", done: Boolean(profile.summary), weight: 15 },
    { key: "location", done: Boolean(profile.location), weight: 5 },
    { key: "skills", done: (profile.skills || []).length >= 3, weight: 20 },
    { key: "education", done: (profile.education || []).length > 0, weight: 10 },
    { key: "experience", done: (profile.experience || []).length > 0, weight: 15 },
    {
      key: "projects",
      done: (profile.projects || []).some(
        (project) => project.name && project.description
      ),
      weight: 10,
    },
    {
      key: "certifications",
      done:
        (profile.certifications || []).length > 0 ||
        (profile.achievements || []).length > 0,
      weight: 5,
    },
    {
      key: "workAuthorization",
      done:
        Boolean(profile.workAuthorization?.status) &&
        profile.workAuthorization.status !== "prefer_not_to_say",
      weight: 5,
    },
    {
      key: "preferredRoles",
      done: (profile.preferredRoles || []).length > 0,
      weight: 10,
    },
    {
      key: "preferredLocations",
      done: (profile.preferredLocations || []).length > 0,
      weight: 5,
    },
  ];

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks
    .filter((check) => check.done)
    .reduce((sum, check) => sum + check.weight, 0);

  return {
    percent: Math.round((earned / totalWeight) * 100),
    missing: checks.filter((check) => !check.done).map((check) => check.key),
  };
}

export function serializeUser(user, hasResume) {
  const safe = user.toSafeJSON();
  return {
    id: safe.id,
    name: safe.name,
    email: safe.email,
    profile: safe.profile || {},
    createdAt: safe.createdAt,
    updatedAt: safe.updatedAt,
    profileCompleteness: profileCompleteness({
      ...(safe.profile || {}),
      name: safe.name,
    }),
    hasResume,
  };
}
