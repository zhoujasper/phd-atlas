import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const indexCss = readFileSync(join(__dirname, "../../index.css"), "utf-8");
const mobileCss = readFileSync(join(__dirname, "../../styles/mobile.css"), "utf-8");
const dossierSource = readFileSync(join(__dirname, "DossierView.tsx"), "utf-8");

describe("Dossier timeline visual hierarchy", () => {
  test("models event meaning separately from its data source", () => {
    expect(dossierSource).toContain("timeline-event-title-row");
    expect(dossierSource).toMatch(
      /timeline-event-title-row[\s\S]*?<strong>\{localize\(event\.title\)\}<\/strong>[\s\S]*?timeline-source-chip/,
    );
    for (const kind of [
      "manual",
      "deadline",
      "reminder",
      "update",
      "task",
      "message",
      "funding",
      "fee",
    ]) {
      expect(dossierSource).toContain(`'${kind}'`);
      expect(indexCss).toMatch(
        new RegExp(`\\.timeline-event-type-${kind}\\s*\\{[^}]+\\}`),
      );
    }
    expect(dossierSource).toContain("<TimelineEventGlyph kind={event.eventKind} />");
    expect(dossierSource).toContain("data-timeline-event-kind={event.eventKind}");
  });

  test("uses a flat event row instead of a card inside a card", () => {
    const cardBlock = indexCss.match(/\.timeline-event-card\s*\{[^}]+\}/s)?.[0];
    expect(cardBlock).toBeDefined();
    expect(cardBlock).toMatch(/border:\s*0/);
    expect(cardBlock).toMatch(/border-bottom:\s*1px\s+solid\s+var\(--border\)/);
    expect(cardBlock).toMatch(/border-radius:\s*0/);
    expect(cardBlock).toMatch(/background:\s*transparent/);

    const noteBlock = indexCss.match(
      /\.timeline-event-note p,[\s\S]*?\.timeline-event-note \.markdown-content\s*\{[^}]+\}/s,
    )?.[0];
    expect(noteBlock).toBeDefined();
    expect(noteBlock).toMatch(/padding:\s*0/);
    expect(noteBlock).toMatch(/background:\s*transparent/);
    expect(noteBlock).toMatch(/border:\s*0/);
  });

  test("keeps the editor flat with the date owned by the lower-right footer", () => {
    expect(dossierSource).toMatch(
      /timeline-edit-input[\s\S]*?timeline-edit-textarea[\s\S]*?timeline-edit-footer[\s\S]*?timeline-edit-date[\s\S]*?<DatePicker[\s\S]*?timeline-edit-actions/,
    );

    const editCardBlock = indexCss.match(/\.timeline-event-card-edit\s*\{[^}]+\}/s)?.[0];
    expect(editCardBlock).toBeDefined();
    expect(editCardBlock).toMatch(/border:\s*0/);
    expect(editCardBlock).toMatch(/border-bottom:\s*1px\s+solid\s+var\(--border\)/);
    expect(editCardBlock).toMatch(/border-radius:\s*0/);
    expect(editCardBlock).toMatch(/box-shadow:\s*none/);
    expect(editCardBlock).toMatch(/background:\s*transparent/);

    const titleBlock = indexCss.match(/\.timeline-edit-input\s*\{[^}]+\}/s)?.[0];
    expect(titleBlock).toBeDefined();
    expect(titleBlock).toMatch(/border:\s*0/);
    expect(titleBlock).toMatch(/border-bottom:\s*1px\s+solid\s+var\(--border\)/);
    expect(titleBlock).toMatch(/border-radius:\s*0/);
    expect(titleBlock).toMatch(/background:\s*transparent/);
    expect(titleBlock).toMatch(/box-shadow:\s*none/);
    expect(indexCss).toMatch(
      /\.timeline-edit-input:focus,[\s\S]*?\.timeline-edit-input:focus-visible\s*\{[^}]+border-bottom-color:\s*var\(--accent\)[^}]+box-shadow:\s*none/,
    );

    const noteEditorBlock = indexCss.match(/\.timeline-edit-textarea\s*\{[^}]+\}/s)?.[0];
    expect(noteEditorBlock).toBeDefined();
    expect(noteEditorBlock).toMatch(/border:\s*0/);
    expect(noteEditorBlock).toMatch(/border-left:\s*2px\s+solid\s+var\(--border\)/);
    expect(noteEditorBlock).toMatch(/border-radius:\s*0/);
    expect(noteEditorBlock).toMatch(/background:\s*transparent/);
    expect(noteEditorBlock).toMatch(/box-shadow:\s*none/);

    const footerBlock = indexCss.match(/\.timeline-edit-footer\s*\{[^}]+\}/s)?.[0];
    expect(footerBlock).toBeDefined();
    expect(footerBlock).toMatch(/display:\s*grid/);
    expect(footerBlock).toMatch(/grid-template-areas:\s*"actions date"/);
    expect(footerBlock).toMatch(/align-items:\s*end/);

    const dateBlock = indexCss.match(/\.timeline-edit-date\s*\{[^}]+\}/s)?.[0];
    expect(dateBlock).toMatch(/grid-area:\s*date/);
    expect(dateBlock).toMatch(/justify-self:\s*end/);
    expect(indexCss).toMatch(
      /\.timeline-edit-date \.date-picker-input-wrap:focus-within,[\s\S]*?aria-expanded="true"\]\)\s*\{[^}]+border-bottom-color:\s*var\(--accent\)[^}]+box-shadow:\s*none/,
    );
    expect(mobileCss).toMatch(
      /\.timeline-edit-footer\s*\{[^}]+grid-template-areas:\s*\n\s*"actions"\s*\n\s*"date"/,
    );
    expect(mobileCss).toMatch(/\.timeline-edit-date\s*\{[^}]+width:\s*min\(100%,\s*184px\)/);
  });

  test("keeps source metadata flat and uses focused hover feedback", () => {
    const sourceChipBlock = indexCss.match(
      /\.timeline-event-title-row \.timeline-source-chip\s*\{[^}]+\}/s,
    )?.[0];
    expect(sourceChipBlock).toBeDefined();
    expect(sourceChipBlock).toMatch(/margin:\s*0/);
    expect(sourceChipBlock).toMatch(/padding:\s*0/);
    expect(sourceChipBlock).toMatch(/background:\s*transparent/);

    const hoverBlock = indexCss.match(/\.timeline-event-card:hover\s*\{[^}]+\}/s)?.[0];
    expect(hoverBlock).toBeDefined();
    expect(hoverBlock).toMatch(/background:\s*transparent/);
    expect(hoverBlock).toMatch(/box-shadow:\s*none/);
    expect(hoverBlock).not.toMatch(/inset\s+3px/);
    const markerBlock = indexCss.match(/(?:^|\n)\.timeline-event-dot\s*\{[^}]+\}/s)?.[0];
    expect(markerBlock).toBeDefined();
    expect(markerBlock).toMatch(/overflow:\s*visible/);
    expect(markerBlock).toMatch(/border:\s*0/);
    expect(markerBlock).toMatch(/background:\s*transparent/);
    expect(markerBlock).toMatch(/box-shadow:\s*none/);
    expect(indexCss).toMatch(/\.timeline-event-first \.timeline-event-rail\s*\{[^}]+padding-top:\s*4px/);

    const markerHoverBlock = indexCss.match(
      /\.timeline-event:hover \.timeline-event-dot,[\s\S]*?\.timeline-event:focus-within \.timeline-event-dot\s*\{[^}]+\}/,
    )?.[0];
    expect(markerHoverBlock).toBeDefined();
    expect(markerHoverBlock).toMatch(/background:\s*transparent/);
    expect(markerHoverBlock).toMatch(/box-shadow:\s*none/);
    expect(indexCss).toMatch(
      /\.timeline-event-card:hover \.timeline-event-title-row strong\s*\{[^}]+color:\s*var\(--timeline-kind-color/,
    );
  });

  test("aligns every source in one stable metadata column", () => {
    const titleRowBlock = indexCss.match(/\.timeline-event-title-row\s*\{[^}]+\}/s)?.[0];
    expect(titleRowBlock).toBeDefined();
    expect(titleRowBlock).toMatch(/display:\s*grid/);
    expect(titleRowBlock).toMatch(/grid-template-columns:\s*minmax\(0,\s*280px\)\s+max-content/);
    expect(titleRowBlock).toMatch(/width:\s*min\(100%,\s*620px\)/);

    const sourceChipBlock = indexCss.match(
      /\.timeline-event-title-row \.timeline-source-chip\s*\{[^}]+\}/s,
    )?.[0];
    expect(sourceChipBlock).toMatch(/justify-self:\s*start/);
    expect(sourceChipBlock).toMatch(/white-space:\s*nowrap/);
  });

  test("renders fee facts and variant-specific supporting surfaces", () => {
    expect(dossierSource).toContain("...(application.fees ?? []).map((fee) =>");
    expect(dossierSource).toContain("id: `auto-fee-${fee.id}`");
    expect(dossierSource).toContain("value: formatFeeAmount(fee.amount, fee.currency, lang)");
    expect(dossierSource).toContain("nav: { tab: 'funding', feeId: fee.id }");
    expect(dossierSource).toContain("targetId: `fee-${nav.feeId}`");
    expect(dossierSource).toContain('className="timeline-event-facts"');
    expect(dossierSource).toContain('className="timeline-event-value"');
    expect(dossierSource).toContain("timeline-event-support-${event.eventKind}");
    expect(dossierSource).toContain("timeline-event-status is-${event.statusTone ?? 'neutral'}");

    expect(indexCss).toMatch(
      /\.timeline-event-type-reminder \.timeline-event-note\s*\{[^}]+background:\s*color-mix/,
    );
    expect(indexCss).toMatch(
      /\.timeline-event-type-update \.timeline-event-note\s*\{[^}]+width:\s*fit-content/,
    );
    expect(indexCss).toMatch(
      /\.timeline-event-type-message \.timeline-event-note\s*\{[^}]+border-left:/,
    );
    expect(indexCss).toMatch(
      /\.timeline-event-support-update,[\s\S]*?\.timeline-event-support-funding\s*\{[^}]+display:\s*flex/,
    );
    expect(indexCss).toMatch(
      /\.timeline-event-type-manual \.timeline-event-note\s*\{[^}]+background:\s*transparent/,
    );
    expect(indexCss).toMatch(
      /\.timeline-event-type-funding \.timeline-event-value,[\s\S]*?font-size:\s*18px/,
    );
  });
});
