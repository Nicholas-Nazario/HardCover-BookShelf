// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSearchForm } from "./profile-search-form";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

afterEach(() => {
  cleanup();
  routerPush.mockClear();
});

describe("ProfileSearchForm", () => {
  it.each([
    ["Adam", "/shelf/adam"],
    ["@Adam", "/shelf/adam"],
    ["https://hardcover.app/@Adam", "/shelf/adam"],
  ])("navigates %s to the normalized shelf route", async (input, route) => {
    const user = userEvent.setup();
    render(<ProfileSearchForm />);

    await user.type(screen.getByLabelText("Hardcover username"), input);
    await user.click(screen.getByRole("button", { name: "View shelf" }));

    expect(routerPush).toHaveBeenCalledWith(route);
    expect(screen.getByRole("button", { name: "Opening…" })).toBeTruthy();
  });

  it("shows an inline error instead of navigating malformed input", async () => {
    const user = userEvent.setup();
    render(<ProfileSearchForm />);

    await user.type(screen.getByLabelText("Hardcover username"), "not valid");
    await user.click(screen.getByRole("button", { name: "View shelf" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Enter a valid Hardcover username or profile URL.",
    );
    expect(routerPush).not.toHaveBeenCalled();
  });
});
