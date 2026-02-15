"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  async function onLogout() {
    setIsLoading(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
    } finally {
      router.replace("/login");
      router.refresh();
      setIsLoading(false);
    }
  }

  return (
    <button type="button" onClick={onLogout} disabled={isLoading}>
      {isLoading ? "Uitloggen..." : "Log uit"}
    </button>
  );
}
