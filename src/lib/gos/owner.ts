export function isOwner(user: { role: string } | null): boolean {
  return user !== null && user.role === "owner";
}
