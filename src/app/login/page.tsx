import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LoginClient from "@/components/login-client";
import { LOGIN_GATE_COOKIE } from "@/lib/auth-constants";

export default async function LoginPage() {
  const jar = await cookies();
  if (jar.get(LOGIN_GATE_COOKIE)?.value !== "ok") {
    redirect("/login-gate");
  }

  return <LoginClient />;
}
