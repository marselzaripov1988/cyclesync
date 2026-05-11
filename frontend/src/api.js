const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export function apiUrl(path) {
  return `${API_URL}${path}`;
}

export async function apiRequest(path, options = {}, token) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const hasJson = response.headers.get("content-type")?.includes("application/json");
  const data = hasJson ? await response.json() : null;
  if (!response.ok) {
    throw new Error(data?.error || "Request failed");
  }
  return data;
}

