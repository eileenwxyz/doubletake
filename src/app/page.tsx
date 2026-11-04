import { SITE_NAME, TAGLINE } from "@/lib/copy";
import CheckForm from "./check-form";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-24 text-center">
      <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
        {SITE_NAME}
      </h1>
      <p className="mt-4 text-lg text-foreground/70 sm:text-xl">
        {TAGLINE}
      </p>
      <CheckForm />
    </main>
  );
}
