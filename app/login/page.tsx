import { redirect } from "next/navigation"
import { currentSession } from "@/lib/server/page-auth"
import LoginForm from "./login-form"

export const metadata = { title: "Sign in" }

export default async function LoginPage() {
  if (await currentSession()) redirect("/admin")
  return <LoginForm />
}
