export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.replace(/[._-]/g, " ").trim() || email;
}
