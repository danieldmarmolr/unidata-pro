"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const TOKEN_KEY = "unidata.token";
const USER_KEY = "unidata.user";

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user" | "gerencia" | "analista" | "lector";
  is_admin: boolean;
  /** Slug del area asignada al user (poblado via /api/users/me · usado por RBAC sidebar). */
  area_slug?: string | null;
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setUser(user: AuthUser): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new Error("No autorizado");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      // FastAPI devuelve `detail` como string o como array de errores ({type,loc,msg,...}).
      // Manejamos ambos casos para no mostrar [object Object].
      if (typeof data?.detail === "string") {
        detail = data.detail;
      } else if (Array.isArray(data?.detail)) {
        detail = data.detail
          .map((e: any) => {
            const loc = Array.isArray(e?.loc) ? e.loc.join(".") : "";
            return loc ? `${loc}: ${e?.msg ?? "error"}` : e?.msg ?? JSON.stringify(e);
          })
          .join("; ");
      } else {
        detail = data?.message ?? JSON.stringify(data);
      }
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? "Credenciales invalidas");
  }
  const data = (await res.json()) as { access_token: string; user: AuthUser };
  setToken(data.access_token);
  setUser(data.user);
  return data;
}

// ----- Self-registration (US-02) -----

export type EmailStatus = {
  email: string;
  valid_domain: boolean;
  exists: boolean;
  needs_password: boolean;
  is_active: boolean;
};

export async function checkEmailStatus(email: string): Promise<EmailStatus> {
  const res = await fetch(`${API_URL}/api/auth/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error("No se pudo verificar el email");
  return (await res.json()) as EmailStatus;
}

export async function registerSelf(email: string, name: string) {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? "No se pudo registrar el email");
  }
  return (await res.json()) as { user: AuthUser; requires_password_setup: boolean };
}

export async function setInitialPassword(email: string, new_password: string) {
  const res = await fetch(`${API_URL}/api/auth/set-initial-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, new_password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail ?? "No se pudo setear la password");
  }
  const data = (await res.json()) as { access_token: string; user: AuthUser };
  setToken(data.access_token);
  setUser(data.user);
  return data;
}
