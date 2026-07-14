# JWT Secret Rotation

The backend signs both admin and portal session tokens with `JWT_SECRET`
(`server/.env`). A weak/short secret can be brute-forced offline, letting an
attacker forge valid tokens for **either** realm and bypass all authentication.
Rotate to a long, random value and re-rotate periodically.

## Why this matters

Every `authMiddleware` / `requireAnyAuth` check only proves a token was signed
with `JWT_SECRET`. If that secret is guessable, the auth checks are worthless.
The minimum safe length is 32 bytes of randomness (64 hex chars); 48 bytes is
better.

## Generate a strong secret

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# or
openssl rand -hex 48
```

## Rotate (production)

Rotating invalidates every currently-issued token, so **all admin and portal
users are logged out** and must sign in again. Schedule it during a low-traffic
window.

1. Generate a new secret (above).
2. On the server, set `JWT_SECRET=<new value>` in `server/.env`.
3. Restart the Node process (`pm2 restart <app>` / `systemctl restart <svc>`).
4. Confirm `GET /api/health` returns `ok`, then sign in on both the admin and
   portal sides to confirm new tokens are accepted.

Existing tokens fail verification immediately after step 3 — that is expected;
clients will be prompted to log in again.

## Notes

- Never commit the real secret. `server/.env` is gitignored; keep it that way.
- If the secret may have been exposed (shared, logged, committed), treat it as
  compromised and rotate immediately rather than waiting for a window.
