import { redirect } from "next/navigation";

export default function DevelopmentRedirectPage() {
  redirect("/settings");
}
