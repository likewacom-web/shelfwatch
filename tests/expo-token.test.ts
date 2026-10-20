import { describe, expect, it } from "vitest";

describe("Expo token", () => {
  it("authenticates with Expo without exposing the token", async () => {
    const token = process.env.EXPO_TOKEN;

    expect(token, "EXPO_TOKEN must be configured for Android builds").toBeTruthy();

    const response = await fetch("https://api.expo.dev/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "query TokenValidation { viewer { id } }" }),
    });

    expect(response.ok, `Expo authentication returned HTTP ${response.status}`).toBe(true);

    const result = (await response.json()) as { data?: { viewer?: { id?: string } }; errors?: unknown[] };
    expect(result.errors, "Expo authentication returned GraphQL errors").toBeUndefined();
    expect(result.data?.viewer?.id, "Expo authentication did not return a viewer").toBeTruthy();
  }, 20_000);
});
