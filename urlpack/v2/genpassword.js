/**
 * genpassword — a password generator, reimplementing Bitwarden's own
 * generation algorithm natively.
 *
 * Bitwarden's generator (@bitwarden/generator-core) is not a portable npm
 * package — it lives inside their Angular client monorepo, wired into their
 * DI and state-provider framework, and can't be imported standalone into a
 * static page. What's reproduced here is the algorithm itself, which is
 * documented and open source (bitwarden/clients, libs/tools/generator):
 *
 *   1. Build a character pool per selected class (lowercase/uppercase/
 *      numbers/special), optionally stripping visually ambiguous glyphs.
 *   2. Guarantee the requested minimum count from each class.
 *   3. Fill the remaining length from the combined pool.
 *   4. Fisher-Yates shuffle, so the guaranteed characters aren't clustered
 *      at the front.
 *
 * The one deliberate deviation: every random choice is drawn via
 * crypto.getRandomValues with rejection sampling against the uint32
 * boundary, never Math.random. That's what Bitwarden's own SecureRandom
 * wrapper does internally, and it's what "natively, in an https context"
 * means for randomness — Math.random is not a CSPRNG and must never be used
 * for secrets.
 */

const SETS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numbers: '0123456789',
  special: '!@#$%^&*',
};

/** Characters that look alike in most fonts: I, l, O, 0, 1. */
const AMBIGUOUS = new Set(['I', 'l', 'O', '0', '1']);

function pool(chars, avoidAmbiguous) {
  return avoidAmbiguous ? [...chars].filter((c) => !AMBIGUOUS.has(c)).join('') : chars;
}

/**
 * Uniform random integer in [0, maxExclusive), via rejection sampling —
 * unlike `crypto.getRandomValues() % n`, this has zero modulo bias.
 */
function secureRandomInt(maxExclusive) {
  if (!(maxExclusive > 0)) throw new Error('maxExclusive must be > 0');
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % maxExclusive;
}

/**
 * @param {object} [options]
 * @param {number} [options.length=20]
 * @param {boolean} [options.lowercase=true]
 * @param {boolean} [options.uppercase=true]
 * @param {boolean} [options.numbers=true]
 * @param {boolean} [options.special=true]
 * @param {number} [options.minNumber=1]   minimum digits, if numbers is on
 * @param {number} [options.minSpecial=1]  minimum special chars, if special is on
 * @param {boolean} [options.avoidAmbiguous=false] strip I/l/O/0/1
 * @returns {string}
 */
export function generatePassword(options = {}) {
  const {
    length = 20,
    lowercase = true,
    uppercase = true,
    numbers = true,
    special = true,
    minNumber = numbers ? 1 : 0,
    minSpecial = special ? 1 : 0,
    avoidAmbiguous = false,
  } = options;

  const classes = [];
  if (lowercase) classes.push({ chars: pool(SETS.lowercase, avoidAmbiguous), min: 1 });
  if (uppercase) classes.push({ chars: pool(SETS.uppercase, avoidAmbiguous), min: 1 });
  if (numbers) classes.push({ chars: pool(SETS.numbers, avoidAmbiguous), min: minNumber });
  if (special) classes.push({ chars: pool(SETS.special, avoidAmbiguous), min: minSpecial });

  if (classes.length === 0) throw new Error('select at least one character type');
  const requiredMin = classes.reduce((sum, c) => sum + c.min, 0);
  if (requiredMin > length) throw new Error('length too short for the requested minimums');

  const all = classes.map((c) => c.chars).join('');
  const result = [];
  for (const c of classes) {
    for (let i = 0; i < c.min; i++) result.push(c.chars[secureRandomInt(c.chars.length)]);
  }
  while (result.length < length) result.push(all[secureRandomInt(all.length)]);

  for (let i = result.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.join('');
}
