/**
 * Crypto / auth posture — adversarial security tests.
 *
 * Failing tests that document concrete crypto-posture gaps surfaced by
 * the 2026-05-09 identity audit. Each test is RED today and exercises
 * a specific finding. As fixes land, individual tests flip to GREEN.
 *
 * Findings audit reference (cited per-test):
 *   F-CRYPTO-1 CSRF middleware defined but never mounted
 *   F-CRYPTO-2 `Math.random()` in security-relevant ID generation
 *   F-CRYPTO-3 scrypt params below current OWASP floor (N=2^14 vs 2^17)
 *   F-CRYPTO-4 Password complexity allows trivially-guessable patterns
 *   F-CRYPTO-9 Spec/comment drift — claim Argon2id where code uses scrypt
 *
 * Some tests use static-source inspection rather than runtime calls.
 * That's intentional: a Math.random call in a security path is a
 * source-level violation; we want CI to fire on the bytes that ship,
 * not just on whatever sample of behavior a runtime test happened to
 * exercise.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, validatePasswordComplexity } from '../../src/index.ts';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
function readSrc(rel: string): string {
    return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}
/* -------------------------------------------------------------------------- */
/* F-CRYPTO-3  scrypt params below OWASP floor                                */
/*                                                                            */
/* `password.ts` ships with N=16384 (2^14), r=8, p=1. OWASP's current        */
/* recommended-configurations table starts at N=2^17, r=8, p=1 (top tier)    */
/* down to N=2^13, r=8, p=10 — pairings that all keep the work-factor at     */
/* roughly the same level. The current Atlas params are NOT on that table:   */
/* p=1 with N=2^14 is roughly 1/8 the recommended top-tier work.             */
/*                                                                            */
/* Expected: produced PHC envelope encodes N >= 131072.                       */
/* Today:    encodes N=16384 — RED.                                          */
/* -------------------------------------------------------------------------- */
describe('F-CRYPTO-3 scrypt parameters', function () {
    it('uses N >= 2^17 (131072) per OWASP 2024 guidance', async function () {
        const phc = await hashPassword('correct-horse-Battery-staple');
        const match = /\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$/.exec(phc);
        if (match === null) {
            throw new Error(`unexpected PHC envelope: ${phc}`);
        }
        const N = Number(match[1]);
        const r = Number(match[2]);
        const p = Number(match[3]);
        // Sanity: r and p match the OWASP shape (r=8 is fixed; p is the
        // tunable that compensates when N is dialed down, so we want either
        // N≥2^17 with p=1, or a documented N/p combination from the OWASP
        // table). Anything outside that envelope is below floor.
        expect(r).toBe(8);
        if (p === 1) {
            expect(N, 'with p=1 the OWASP minimum is N=2^17 (131072)').toBeGreaterThanOrEqual(131072);
        }
        else {
            // If somebody bumps p instead, the work-factor still has to land
            // near OWASP's recommended product. A loose lower bound covers
            // all rows on the OWASP table.
            expect(N * p, 'N * p below OWASP work-factor floor').toBeGreaterThanOrEqual(131072);
        }
    });
});
/* -------------------------------------------------------------------------- */
/* F-CRYPTO-4  Password complexity allows trivially-weak shapes              */
/*                                                                            */
/* The 12-char + 2-of-3 character classes rule rejects "correct horse        */
/* battery staple" (good) but accepts "Password1234" (bad). Modern guidance  */
/* (NIST SP 800-63B, OWASP) deprecates composition rules in favor of length  */
/* and breach-list checks.                                                    */
/*                                                                            */
/* Expected: "Password1234" is rejected (either by a longer minimum, a       */
/*           top-N breached-passwords check, or both).                        */
/* Today:    accepted — RED.                                                 */
/* -------------------------------------------------------------------------- */
describe('F-CRYPTO-4 password complexity', function () {
    it('rejects "Password1234" — common breached pattern', function () {
        expect(function () {
            return validatePasswordComplexity('Password1234');
        }).toThrow();
    });
    it('rejects "Aaaaaaaa1111" — pattern matches policy but is trivially guessable', function () {
        expect(function () {
            return validatePasswordComplexity('Aaaaaaaa1111');
        }).toThrow();
    });
});
/* -------------------------------------------------------------------------- */
/* F-CRYPTO-2  Math.random() in security-relevant ID generation              */
/*                                                                            */
/* Three call sites surfaced in the audit:                                    */
/*   - saml/sp-key.ts:40     (SAML SP cert serial number)                    */
/*   - saml/authn-request.ts:49 (SAML AuthnRequest ID — anti-replay anchor)  */
/*   - handlers/webauthn-{register,assert}.ts:29 (challenge entity IDs)      */
/*                                                                            */
/* Math.random is NOT a CSPRNG; predictable IDs weaken the SP↔IdP binding   */
/* and let attackers collide WebAuthn challenge rows.                         */
/*                                                                            */
/* Expected: every call site uses `crypto.randomBytes(...)`.                  */
/* Today:    all four still call Math.random — RED.                          */
/* -------------------------------------------------------------------------- */
describe('F-CRYPTO-2 randomness sources in identity', function () {
    const SECURITY_PATHS = [
        'modules/identity/src/saml/sp-key.ts',
        'modules/identity/src/saml/authn-request.ts',
        'modules/identity/src/handlers/webauthn-register.ts',
        'modules/identity/src/handlers/webauthn-assert.ts',
    ];
    for (const rel of SECURITY_PATHS) {
        it(`${rel} uses no Math.random`, function () {
            const src = readSrc(rel);
            // Strip line-comments so accidental "// don't use Math.random" notes
            // don't trip the check.
            const stripped = src.replace(/\/\/.*$/gm, '');
            expect(stripped.includes('Math.random'), `Math.random found in ${rel} — replace with crypto.randomBytes`).toBe(false);
        });
    }
});
/* -------------------------------------------------------------------------- */
/* F-CRYPTO-1  CSRF middleware defined but never mounted                     */
/*                                                                            */
/* `apps/server/src/middleware/csrf.ts` exports `csrfMiddleware`. No         */
/* file outside csrf.ts itself imports it. Cookie-bound mutating requests    */
/* therefore have no CSRF protection beyond SameSite. Several flows fall     */
/* back to SameSite=Lax (signup-confirm cross-host redirect), opening the    */
/* gap.                                                                       */
/*                                                                            */
/* Expected: `apps/server/src/main.ts` (or another bootstrap file) wires    */
/*           `csrfMiddleware` onto authed routes.                             */
/* Today:    no caller — RED.                                                */
/* -------------------------------------------------------------------------- */
describe('F-CRYPTO-1 CSRF middleware mounting', function () {
    it('csrfMiddleware is wired into the server bootstrap', function () {
        // The `csrfMiddleware` symbol is exported from csrf.ts and should be
        // referenced by main.ts (or wherever route groups are composed).
        const candidates = [
            'apps/server/src/main.ts',
            'apps/server/src/bootstrap.ts',
        ];
        const found = candidates.some(function (p) {
            return readSrc(p).includes('csrfMiddleware');
        });
        expect(found, 'csrfMiddleware is exported but never imported by main.ts/bootstrap.ts').toBe(true);
    });
});
/* -------------------------------------------------------------------------- */
/* F-CRYPTO-9  Spec/comment drift                                             */
/*                                                                            */
/* `specs/domains/identity/authn.md`, `password-set.ts`, `password-login.ts`,*/
/* and `recovery-code.ts` all claim Argon2id. The actual implementation      */
/* swapped to scrypt. Stale crypto-claim docs are a documentation security   */
/* issue: the next person to debug the auth path will assume protection      */
/* the code does not actually provide.                                        */
/*                                                                            */
/* Expected: no Argon2 mentions in identity sources/specs that describe     */
/*           current behavior.                                                */
/* Today:    multiple still say Argon2id — RED.                             */
/* -------------------------------------------------------------------------- */
describe('F-CRYPTO-9 stale Argon2 references', function () {
    const PATHS = [
        'specs/domains/identity/authn.md',
        'modules/identity/src/handlers/password-set.ts',
        'modules/identity/src/handlers/password-login.ts',
        'modules/identity/src/handlers/recovery-code.ts',
    ];
    for (const rel of PATHS) {
        it(`${rel} does not falsely claim Argon2`, function () {
            const src = readSrc(rel);
            // Match `Argon2`, `argon2id`, etc. — case-insensitive.
            const m = /argon[\s-]?2/i.exec(src);
            expect(m === null, `${rel} mentions "${m?.[0]}" — code uses scrypt; update the doc/comment`).toBe(true);
        });
    }
});
