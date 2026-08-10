import { describe, expect, it } from "vitest";
import css from "../../index.css?raw";

describe("profile writing workflow CSS contract", () => {
  it("keeps requirements flat with the same bounded Markdown rhythm as content and notes", () => {
    expect(css).toMatch(
      /\.snippet-writing-requirements-field\s*\{[^}]*display:\s*grid[^}]*gap:\s*8px/s,
    );
    expect(css).toMatch(
      /\.snippet-writing-requirements-field \.markdown-textarea\s*\{[^}]*--markdown-editor-min-height:\s*118px[^}]*--markdown-editor-content-min-height:\s*102px/s,
    );
  });

  it("lays authored sections out in two columns while full-width sections span the grid", () => {
    expect(css).toMatch(
      /\.snippet-writing-section-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
    );
    expect(css).toMatch(
      /\.snippet-writing-section\.width-full\s*\{[^}]*grid-column:\s*1 \/ -1/s,
    );
  });

  it("uses bounded compositor motion with reduced-motion and forced-color fallbacks", () => {
    expect(css).toMatch(
      /@keyframes snippet-writing-section-in[\s\S]*translate3d/,
    );
    expect(css).toMatch(/@keyframes snippet-export-complete[\s\S]*transform:/);
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.snippet-writing-section-layout[\s\S]*\.snippet-advanced-design-trigger\.is-open/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.snippet-writing-section[\s\S]*\.snippet-advanced-design-trigger > svg:last-child/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.snippet-export-action\.is-complete/,
    );
  });

  it("forces every section into one readable column on phones", () => {
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*\.snippet-writing-section-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*\.snippet-writing-section\.width-full,\s*\.snippet-writing-section\.width-half\s*\{[^}]*grid-column:\s*1/s,
    );
  });

  it("keeps Advanced settings on the left and submit actions on the right", () => {
    expect(css).toMatch(
      /\.new-dialog\.snippet-editor-dialog \.snippet-editor-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    );
    expect(css).toMatch(
      /\.new-dialog\.snippet-editor-dialog \.snippet-editor-form\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto[^}]*overflow:\s*hidden/s,
    );
    expect(css).toMatch(
      /\.snippet-editor-scroll\s*\{[^}]*padding:\s*18px 24px 24px[^}]*overflow:\s*auto/s,
    );
    expect(css).toMatch(
      /\.snippet-editor-form \.dialog-actions\s*\{[^}]*justify-content:\s*space-between[^}]*align-items:\s*center/s,
    );
    expect(css).toMatch(
      /\.snippet-editor-form \.dialog-actions\s*\{[^}]*position:\s*relative[^}]*margin:\s*0/s,
    );
    expect(css).toMatch(
      /\.snippet-advanced-design-trigger\s*\{[^}]*flex:\s*0 0 auto/s,
    );
    expect(css).toMatch(
      /\.snippet-dialog-submit-actions\s*\{[^}]*margin-left:\s*auto/s,
    );
  });

  it("keeps the section layout picker compact and precise", () => {
    expect(css).toMatch(
      /\.snippet-writing-section-layout-options\s*\{[^}]*gap:\s*2px[^}]*padding:\s*3px[^}]*border-radius:\s*var\(--radius\)/s,
    );
    expect(css).toMatch(
      /\.snippet-writing-section-layout-options button\s*\{[^}]*min-height:\s*26px[^}]*gap:\s*5px[^}]*padding:\s*0 8px[^}]*font-size:\s*11px[^}]*line-height:\s*1/s,
    );
  });

  it("reserves a scroll-safe reveal boundary for Advanced settings", () => {
    expect(css).toMatch(
      /\.snippet-advanced-design-collapse\s*\{[^}]*scroll-margin-block:\s*18px[^}]*--collapsible-panel-y:\s*-6px/s,
    );
    expect(css).toMatch(
      /\.snippet-advanced-design-collapse:not\(\.open\)\s*\{[^}]*overflow:\s*hidden[^}]*clip-path:\s*none/s,
    );
    expect(css).toMatch(
      /\.snippet-writing-section\.is-layout-animating\s*\{[^}]*will-change:\s*transform/s,
    );
  });
});
