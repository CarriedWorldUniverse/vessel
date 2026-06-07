const DIRECT_ADDRESS_PREFIXES = [
  'hey',
  'hi',
  'hello',
  'ok',
  'okay',
  'yo',
  'ask',
];

const ROUTE_PREFIXES = [
  'at',
  'to',
  'talk to',
  'speak to',
  'send to',
];

const BARE_ADDRESS_FOLLOWERS = [
  'can',
  'could',
  'would',
  'will',
  'please',
  'get',
  'run',
  'check',
  'tell',
  'show',
  'find',
  'look',
  'what',
  'where',
  'why',
  'how',
  'when',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function orderedNames(aspects = {}) {
  return Object.keys(aspects)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function compactLeadingPunctuation(value) {
  return value.replace(/^[\s,.:;!?-]+/, '').trim();
}

function mention(name, body) {
  const cleanBody = compactLeadingPunctuation(body || '');
  return cleanBody ? `@${name} ${cleanBody}` : `@${name}`;
}

function matchPrefixAddress(trimmed, names, prefixes) {
  for (const name of names) {
    const escapedName = escapeRegExp(name);
    for (const prefix of prefixes) {
      const escapedPrefix = escapeRegExp(prefix);
      const re = new RegExp(`^${escapedPrefix}\\s+${escapedName}(?:\\b|\\s|[,.:;!?-])(.*)$`, 'i');
      const match = trimmed.match(re);
      if (match) {
        return {
          target: name,
          content: mention(name, match[1] || ''),
        };
      }
    }
  }
  return null;
}

function matchBareAddress(trimmed, names) {
  for (const name of names) {
    const follower = BARE_ADDRESS_FOLLOWERS.map(escapeRegExp).join('|');
    const re = new RegExp(
      `^${escapeRegExp(name)}(?:(?:[,.:;!?-]|\\s{2,})(.*)|\\s+((?:${follower})\\b.*))$`,
      'i',
    );
    const match = trimmed.match(re);
    if (match) {
      return {
        target: name,
        content: mention(name, match[1] || match[2] || ''),
      };
    }
  }
  return null;
}

export function normalizeAddress(text, { aspects = {}, activeSpeaker = null } = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { content: '', target: null, addressed: false };

  const explicit = trimmed.match(/^@([a-z0-9_-]+)\b(.*)$/i);
  if (explicit) {
    return {
      content: `@${explicit[1].toLowerCase()}${explicit[2] || ''}`.trim(),
      target: explicit[1].toLowerCase(),
      addressed: true,
    };
  }

  const names = orderedNames(aspects);
  const natural =
    matchPrefixAddress(trimmed, names, DIRECT_ADDRESS_PREFIXES) ||
    matchPrefixAddress(trimmed, names, ROUTE_PREFIXES) ||
    matchBareAddress(trimmed, names);

  if (natural) {
    return { ...natural, addressed: true };
  }

  if (activeSpeaker) {
    return {
      content: mention(activeSpeaker, trimmed),
      target: activeSpeaker,
      addressed: true,
    };
  }

  return { content: trimmed, target: null, addressed: false };
}
