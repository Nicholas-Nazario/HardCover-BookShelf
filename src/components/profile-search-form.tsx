"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import {
  InvalidUsernameError,
  normalizeHardcoverUsername,
} from "../shared/usernames";

export function ProfileSearchForm() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const username = normalizeHardcoverUsername(input);
      setError(null);
      setIsNavigating(true);
      router.push(`/shelf/${encodeURIComponent(username)}`);
    } catch (caught) {
      setError(
        caught instanceof InvalidUsernameError
          ? caught.message
          : "The shelf page could not be opened.",
      );
    }
  }

  return (
    <section className="search-page" aria-labelledby="search-heading">
      <div className="intro">
        <p className="eyebrow">Checkpoint 3c</p>
        <h1 id="search-heading">Hardcover Shelf</h1>
        <p>
          Enter a public Hardcover username to open its Read and Want to Read
          shelves. A first visit synchronizes the profile before displaying it.
        </p>
      </div>

      <form className="profile-form" onSubmit={handleSubmit}>
        <label htmlFor="hardcover-username">Hardcover username</label>
        <div className="form-row">
          <input
            id="hardcover-username"
            name="username"
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="adam, @adam, or a profile URL"
            autoComplete="off"
            disabled={isNavigating}
            required
          />
          <button type="submit" disabled={isNavigating}>
            {isNavigating ? "Opening…" : "View shelf"}
          </button>
        </div>
        <p className="form-note">Only public Hardcover profiles are supported.</p>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
