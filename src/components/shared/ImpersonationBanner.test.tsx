import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImpersonationBanner } from "./ImpersonationBanner";

function renderBanner(onReturn = vi.fn()) {
  const view = render(
    <ImpersonationBanner
      targetLabel="Viewing as Dr. Mei Chen"
      actorLabel="Operator: Jasper"
      returnLabel="Return to Jasper"
      onReturn={onReturn}
    />,
  );
  return { view, onReturn };
}

describe("ImpersonationBanner", () => {
  it("shows the account context briefly, then keeps only the return action", () => {
    vi.useFakeTimers();
    try {
      renderBanner();

      const status = screen.getByRole("status");
      const banner = status.closest(".impersonation-banner");
      expect(banner?.getAttribute("data-state")).toBe("expanded");
      expect(status.textContent).toContain("Viewing as Dr. Mei Chen");
      expect(status.getAttribute("aria-hidden")).toBe("false");

      act(() => vi.advanceTimersByTime(2799));
      expect(banner?.getAttribute("data-state")).toBe("expanded");

      act(() => vi.advanceTimersByTime(1));
      expect(banner?.getAttribute("data-state")).toBe("compact");
      expect(status.getAttribute("aria-hidden")).toBe("true");
      expect(
        screen.getByRole("button", { name: "Return to Jasper" }),
      ).toBeTruthy();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("returns through the one resident action and restarts the presentation for a new context", () => {
    vi.useFakeTimers();
    try {
      const onReturn = vi.fn();
      const { view } = renderBanner(onReturn);

      fireEvent.click(screen.getByRole("button", { name: "Return to Jasper" }));
      expect(onReturn).toHaveBeenCalledOnce();

      act(() => vi.advanceTimersByTime(2800));
      const status = view.container.querySelector('[role="status"]');
      expect(status?.getAttribute("aria-hidden")).toBe("true");

      view.rerender(
        <ImpersonationBanner
          targetLabel="Viewing as Omar Patel"
          actorLabel="Operator: Jasper"
          returnLabel="Return to Jasper"
          onReturn={onReturn}
        />,
      );
      const nextStatus = view.container.querySelector('[role="status"]');
      expect(nextStatus?.getAttribute("aria-hidden")).toBe("false");
      expect(nextStatus?.textContent).toContain("Viewing as Omar Patel");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
