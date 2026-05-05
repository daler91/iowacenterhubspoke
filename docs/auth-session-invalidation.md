# Auth session invalidation strategy (token versioning)

We use **token-version claims checked at auth boundaries**.

## Strategy chosen

- Access JWTs now include a `pwdv` claim (`password version`).
- User documents carry a monotonic `pwd_version` integer.
- Every authenticated request compares token `pwdv` to current `pwd_version`.
- If token version is older, request is rejected with 401 and the user must re-authenticate.

## Pipeline integration

- Session issuance (`/auth/login`, `/auth/refresh`, post-change-password re-issue) stamps current `pwd_version` into new access tokens.
- Auth boundary (`core/auth.py::get_current_user`) enforces `token_pwdv >= current_pwd_version`.
- Password reset + change-password flows increment `pwd_version` and broadcast via Redis-backed invalidation cache.

## Multi-worker cache behavior

- L1 in-process cache keeps per-user invalidation reads hot for a short TTL.
- Redis key `auth:pwdv:<user_id>` is treated as cross-worker invalidation channel/state.
- On invalidation, writers publish latest `pwd_version`; sibling workers consume on next cache miss.
- This caps stale-auth windows to the L1 TTL when Redis is healthy.

## Operational requirements

1. **Redis availability/config**
   - Redis must be reachable by API workers for optimal cross-worker invalidation.
   - Key TTL for `auth:pwdv:<user_id>` should exceed expected worker-cache lifetimes.
2. **Version field migration**
   - Add `pwd_version` integer field to `users` collection.
   - Default/migrate existing rows to `0`.
   - Ensure password reset/change flows atomically bump this value.
3. **Rollback compatibility**
   - Tokens without `pwdv` are treated as version `0`; users with `pwd_version>0` will be forced to log in again, which is safe.
