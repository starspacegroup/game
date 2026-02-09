import { SUPER_ADMIN_IDS } from '$lib/shared/protocol';

/** Reactive auth state for Discord login */
class AuthStore {
  isLoggedIn = $state(false);
  userId = $state<string | null>(null);
  username = $state<string | null>(null);
  avatar = $state<string | null>(null);
  accessToken = $state<string | null>(null);

  setUser(user: { id: string; username: string; avatar: string | null; accessToken: string; }): void {
    this.isLoggedIn = true;
    this.userId = user.id;
    this.username = user.username;
    this.avatar = user.avatar;
    this.accessToken = user.accessToken;

    // Persist to localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('discord_auth', JSON.stringify(user));
    }
  }

  logout(): void {
    this.isLoggedIn = false;
    this.userId = null;
    this.username = null;
    this.avatar = null;
    this.accessToken = null;

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('discord_auth');
    }
  }

  loadFromStorage(): void {
    if (typeof localStorage === 'undefined') return;

    const stored = localStorage.getItem('discord_auth');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        this.isLoggedIn = true;
        this.userId = user.id;
        this.username = user.username;
        this.avatar = user.avatar;
        this.accessToken = user.accessToken;
      } catch {
        localStorage.removeItem('discord_auth');
      }
    }
  }

  get isSuperAdmin(): boolean {
    return this.isLoggedIn && this.userId !== null && SUPER_ADMIN_IDS.includes(this.userId);
  }

  get avatarUrl(): string | null {
    if (!this.userId || !this.avatar) return null;
    return `https://cdn.discordapp.com/avatars/${this.userId}/${this.avatar}.png`;
  }
}

export const authState = new AuthStore();
