/**
 * In-memory account/session lease registry for a single server process.
 *
 * This is a concurrency primitive, not authentication or persistence. Call
 * claim() only after the existing account system has verified credentials.
 * It prevents duplicate browser sessions in this process; it does not yet
 * coordinate browser sessions with native ENet sessions or multiple servers.
 */

export type SessionClaim =
  | { ok: true; accountKey: string; sessionId: string }
  | { ok: false; reason: "account_already_in_use" | "invalid_claim" };

export class BrowserSessionRegistry {
  private readonly accountBySession = new Map<string, string>();
  private readonly sessionByAccount = new Map<string, string>();

  /**
   * Account keys should be stable database IDs, normalized server-side.
   * Neither accountKey nor sessionId should come from an untrusted client.
   */
  claim(accountKey: string, sessionId: string): SessionClaim {
    if (
      typeof accountKey !== "string" ||
      accountKey.trim().length === 0 ||
      typeof sessionId !== "string" ||
      sessionId.trim().length === 0
    ) {
      return { ok: false, reason: "invalid_claim" };
    }

    const account = accountKey.trim();
    const session = sessionId.trim();
    const existingSession = this.sessionByAccount.get(account);

    if (existingSession && existingSession !== session) {
      return { ok: false, reason: "account_already_in_use" };
    }

    const existingAccount = this.accountBySession.get(session);
    if (existingAccount && existingAccount !== account) {
      return { ok: false, reason: "invalid_claim" };
    }

    this.sessionByAccount.set(account, session);
    this.accountBySession.set(session, account);
    return { ok: true, accountKey: account, sessionId: session };
  }

  /** Release only the lease owned by this exact session. */
  release(sessionId: string): boolean {
    const account = this.accountBySession.get(sessionId);
    if (!account) return false;

    this.accountBySession.delete(sessionId);
    if (this.sessionByAccount.get(account) === sessionId) {
      this.sessionByAccount.delete(account);
    }
    return true;
  }

  isAccountInUse(accountKey: string): boolean {
    return this.sessionByAccount.has(accountKey.trim());
  }

  getSessionForAccount(accountKey: string): string | undefined {
    return this.sessionByAccount.get(accountKey.trim());
  }

  get size(): number {
    return this.accountBySession.size;
  }
}
