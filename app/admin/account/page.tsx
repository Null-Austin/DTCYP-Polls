import AccountPanel from "@/components/admin/account-panel"

export const metadata = { title: "Account" }

export default function AccountPage() {
  return (
    <>
      <h1>Account</h1>
      <p className="admin__sub">Your password and sessions.</p>
      <AccountPanel />
    </>
  )
}
