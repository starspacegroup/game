export function canDeleteRoom(
  authenticatedUserId: string | undefined,
  creatorId: string | undefined,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true;
  return !!authenticatedUserId && authenticatedUserId === creatorId;
}
