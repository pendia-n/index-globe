"use client";

import { useState } from "react";

export function SignOut() {
  const [failed, setFailed] = useState(false);
  async function signOut() {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error();
      window.location.assign("/");
    } catch {
      setFailed(true);
    }
  }
  return <div className="sign-out"><button className="text-button" onClick={signOut}>Sign out</button>
    {failed && <small role="alert">Sign-out failed. Try again.</small>}</div>;
}
