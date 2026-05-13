export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Returns true if the Firebase user has a linked (non-anonymous) email account. */
export function isLinkedAccount(user) {
  if (!user) return false;
  return !user.isAnonymous && Boolean(user.email);
}
