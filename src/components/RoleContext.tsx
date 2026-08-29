"use client";

import { createContext, useContext } from "react";

export type SessionRole = "admin" | "viewer";

const RoleContext = createContext<SessionRole>("admin");

export function RoleProvider({ role, children }: { role: SessionRole; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole() {
  return useContext(RoleContext);
}

export function useIsViewer() {
  return useContext(RoleContext) === "viewer";
}
