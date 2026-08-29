"use client";

import { useActionState } from "react";
import { loginAdmin, type LoginState } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: LoginState = {};

export function AdminLoginForm() {
  const [state, action, pending] = useActionState(loginAdmin, initialState);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="loginId">Admin ID</Label>
        <Input id="loginId" name="loginId" autoComplete="username" defaultValue="admin" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="off" defaultValue="admin" required />
      </div>
      <p className="text-sm text-muted-foreground">
        Demo instance &mdash; sign in with the pre-filled credentials.
      </p>
      {state.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
      <Button className="w-full" type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
