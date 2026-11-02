/* Pure lookup. Stable authoring IDs compile to indexed ranges during build. */
(function (scope) {
  "use strict";
  function createLookup(paper) {
    const offsets = [];
    let count = 0;
    for (const page of paper.pages) { offsets.push(count); count += page.words.length; }
    const words = paper.pages.flatMap(p => p.words);
    const bounds = a => [offsets[a.page - 1] + a.start, offsets[a.page - 1] + a.end];
    const indices = ranges => ranges.flatMap(a => {
      const [start, end] = bounds(a);
      return Array.from({length: end-start}, (_, i) => start+i);
    });
    const positioned = (item, ranges) => {
      const keys = indices(ranges);
      return {...item, indices: keys, start: keys[0], end: keys.at(-1)+1};
    };
    const units = paper.content.units.map(u => positioned(u, u.ranges));
    const vocabulary = paper.content.vocabulary.flatMap(v => v.occurrences.map(a => positioned(v, [a])));
    const terms = paper.content.terms.flatMap(t => t.occurrences.map(a => positioned(t, [a])));
    const running = i => ["header", "footer", "page-number"].includes(words[i].role);
    const source = keys => keys.map(i => words[i].text).join(" ");
    const matches = (entry, selected, cursor) => entry.indices.every((key, i) => selected[cursor+i] === key);

    function translate(start, end) {
      if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= words.length)) {
        throw new RangeError("Invalid selection bounds");
      }
      let selected = Array.from({length: end-start}, (_, i) => start+i);
      // Only explicitly tagged running matter between non-running endpoints is skipped.
      // Selecting a header itself still provides its own prepared translation.
      if (!running(start) && !running(end-1)) selected = selected.filter(i => !running(i));
      const exact = units.find(u => u.indices.length === selected.length && matches(u, selected, 0));
      if (exact) return {mode: exact.kind, entries: [exact], source: source(selected)};
      const complete = [];
      let cursor = 0;
      while (cursor < selected.length) {
        const next = units.filter(u => ["sentence", "clause"].includes(u.kind) && matches(u, selected, cursor))
          .sort((a, b) => b.indices.length-a.indices.length)[0];
        if (!next) break;
        complete.push(next);
        cursor += next.indices.length;
      }
      if (cursor === selected.length) return {mode: "sentences", entries: complete, source: source(selected)};
      const entries = [];
      cursor = 0;
      const candidates = [...units.filter(u => ["word", "phrase"].includes(u.kind)), ...vocabulary,
        ...terms.map(t => ({...t, zh: t.summary}))];
      while (cursor < selected.length) {
        const next = candidates.filter(v => matches(v, selected, cursor)).sort((a, b) => b.indices.length-a.indices.length)[0];
        if (next) { entries.push(next); cursor += next.indices.length; }
        else {
          if (/[A-Za-z]/.test(words[selected[cursor]].text)) entries.push({source: words[selected[cursor]].text, zh: "此位置缺少预制释义。"});
          cursor += 1;
        }
      }
      return {mode: "words", entries, source: source(selected)};
    }
    return {offsets, bounds, terms, translate};
  }
  scope.createPaperLookup = createLookup;
  if (typeof module !== "undefined") module.exports = createLookup;
})(typeof window === "undefined" ? globalThis : window);
