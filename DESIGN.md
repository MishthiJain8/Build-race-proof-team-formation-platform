# TeamForge — One-page technical design

**Problem.** Support reliable team formation for 10,000 participants, including 50 people attempting to claim the final team seat simultaneously.

**Architecture.** Responsive React/Vite UI → Express JSON API → PostgreSQL. PostgreSQL's transactional row locking provides correctness. Server-Sent Events, fed by database LISTEN/NOTIFY, tell active clients when to refetch data.

**Data model.** `users` store profiles and hashed passwords. `hackathons` defines allowed team sizes. `teams` stores leader, maximum size and transactional member count. `memberships` has a unique `(hackathon_id,user_id)` primary key, preventing participation in multiple teams in the same hackathon. `invites` holds expiring hashed codes. `join_requests` records leader approvals. `idempotency_keys` holds completed mutation responses. `audit_log` records who changed a team and when.

**Race prevention.** Each join begins a database transaction and locks the target team with `SELECT ... FOR UPDATE`. Under that lock, the API verifies available capacity, inserts membership, increments `member_count`, logs the change and commits atomically. A competing join must wait; after the winning commit it sees the full count and receives HTTP 409. The membership uniqueness constraint independently blocks duplicate team membership. The 50-client test checks exactly one success and verifies database invariants.

**Retries.** Each authenticated mutation uses a unique client-supplied idempotency key. Duplicate submissions use a unique database key `(actor_id,route,key)` and replay the committed response. Failed transactions roll back.

**Security.** Authentication uses hashed passwords and signed JWTs. Leaders alone issue invitations, accept/decline requests and remove teammates. Invite tokens contain 192 bits of randomness, are stored only as SHA-256 digests, expire after one hour and are rate-limited. Zod validates inputs.

**Matching.** A candidate receives 5 points for each new complementary skill, 2 points for each overlapping skill, and up to 4 points for timezone compatibility.

**Trade-offs.** The frontend keeps JWTs in local storage for simplicity; production should use hardened session handling. SSE broadcasts generic refresh events instead of private team data. The board query is paginated and indexed. PostgreSQL notifications may require a non-pooled database connection in some managed hosting setups.

**Next week.** Add full multi-instance event delivery, distributed tracing, deployment health alerts, database migration tooling, advanced performance tuning and an automated chaos test.
