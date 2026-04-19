/**
 * Normalize WhatsApp peer ids (@c.us, @lid) to digits-only keys for DB + inbox.
 */

/** Digits-only peer key for threading (matches outbound Message.phone / Lead.phone style). */
function canonicalPeerDigits(fromSerialized) {
  const s = String(fromSerialized || '').trim();
  if (!s) return '';
  const local = s.includes('@') ? s.split('@')[0] : s;
  return String(local).replace(/^\+/, '').replace(/\D/g, '');
}

/**
 * Build MongoDB $in array so ?phone=9415… matches legacy rows stored as …@lid or …@c.us.
 */
function expandPeerQueryVariants(param) {
  const raw = String(param || '').trim();
  const digits = canonicalPeerDigits(raw.includes('@') ? raw : raw.replace(/\s/g, ''));
  const set = new Set();
  if (raw) set.add(raw);
  if (digits) {
    set.add(digits);
    set.add(`${digits}@lid`);
    set.add(`${digits}@c.us`);
    set.add(`+${digits}@lid`);
    set.add(`+${digits}@c.us`);
  }
  return [...set].filter(Boolean);
}

/**
 * Resolve inbound message sender to digits-only thread key + display name.
 * Multi-device chats may use …@lid instead of …@c.us — contact may expose real number.
 */
async function resolveInboundSender(msg) {
  const rawFrom = String(msg?.from || '');
  const body = msg.body || '';

  let contact = null;
  try {
    contact = await msg.getContact();
  } catch (_) {}

  const contactName =
    contact?.pushname ||
    contact?.name ||
    contact?.shortName ||
    '';

  if (rawFrom.endsWith('@c.us')) {
    const digits = canonicalPeerDigits(rawFrom);
    return { threadPhone: digits || canonicalPeerDigits(rawFrom.split('@')[0]), contactName, rawFrom };
  }

  if (rawFrom.endsWith('@lid')) {
    let digits = '';

    const num = contact?.number;
    if (num) digits = String(num).replace(/\D/g, '');

    if (!digits || digits.length < 8) {
      const idUser =
        contact?.id?.user ||
        contact?.wid?.user ||
        (contact?.id && typeof contact.id === 'object' ? contact.id.user : null);
      if (idUser && String(idUser).replace(/\D/g, '').length >= 8) {
        digits = String(idUser).replace(/\D/g, '');
      }
    }

    if (!digits || digits.length < 8) {
      digits = canonicalPeerDigits(rawFrom);
    }

    return {
      threadPhone: digits || 'unknown',
      contactName,
      rawFrom,
    };
  }

  const fallback = canonicalPeerDigits(rawFrom) || 'unknown';
  return { threadPhone: fallback, contactName, rawFrom };
}

/** E.164-style line for UI — digits only, never raw @lid / @c.us. */
function formatPeerDigitsLine(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d || d === 'unknown') return '';
  return d.length <= 15 ? `+${d}` : `+${d.slice(0, 14)}…`;
}

module.exports = {
  canonicalPeerDigits,
  expandPeerQueryVariants,
  resolveInboundSender,
  formatPeerDigitsLine,
};
