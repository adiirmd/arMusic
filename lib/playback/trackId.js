/* Track ids as the browser sees them.
 *
 * The id is the upstream video id, run through strict validation. It is not a
 * secret (the same id is already in every search result and share link), and
 * it carries no hostname, no URL and no signature, so it reveals nothing about
 * where the audio actually comes from. Anything that does not look exactly
 * like an 11 character video id is refused before any network call is made. */

const TRACK_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function isValidTrackId(id) {
  return typeof id === 'string' && TRACK_ID_RE.test(id);
}

module.exports = { isValidTrackId, TRACK_ID_RE };
