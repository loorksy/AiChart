import { redirect } from "next/navigation";

/** OAuth DCR uses POST /register — user signup is at /signup. */
export default function RegisterPage() {
  redirect("/signup");
}
